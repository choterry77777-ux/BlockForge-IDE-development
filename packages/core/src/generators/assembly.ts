import { A64_REGS, X64_REGS } from '../blocks/defs-asm';
import type { AsmInstr, AsmProgram, AsmRoutine } from '../ir/types';
import type { AsmArch, AsmPlatform, Diagnostic, GenOptions, GenResult } from '../types';
import { Emitter } from './emitter';

const LABEL_RE = /^[A-Za-z_.][A-Za-z0-9_.$]*$/;

interface Syscalls {
  write: number;
  exit: number;
}

const SYSCALLS: Record<AsmArch, Record<AsmPlatform, Syscalls>> = {
  arm64: { macos: { write: 4, exit: 1 }, linux: { write: 64, exit: 93 } },
  x86_64: { macos: { write: 0x2000004, exit: 0x2000001 }, linux: { write: 1, exit: 60 } },
};

/** Escape text for a .ascii directive, returning the literal and its byte length. */
function asciiLiteral(text: string): { lit: string; bytes: number } {
  const bytes = new TextEncoder().encode(text);
  let lit = '';
  for (const b of bytes) {
    if (b === 0x22) lit += '\\"';
    else if (b === 0x5c) lit += '\\\\';
    else if (b === 0x0a) lit += '\\n';
    else if (b === 0x09) lit += '\\t';
    else if (b >= 0x20 && b < 0x7f) lit += String.fromCharCode(b);
    else lit += '\\' + b.toString(8).padStart(3, '0');
  }
  return { lit, bytes: bytes.length };
}

class AsmWriter {
  readonly em = new Emitter('    ');
  readonly diags: Diagnostic[] = [];
  private data: string[] = [];
  private textCount = 0;
  private needsPrintInt = false;
  private defined = new Set<string>();
  private referenced: { label: string; id?: string }[] = [];

  constructor(
    readonly arch: AsmArch,
    readonly platform: AsmPlatform,
  ) {}

  private get sys(): Syscalls {
    return SYSCALLS[this.arch][this.platform];
  }

  report(severity: Diagnostic['severity'], code: string, message: string, blockId?: string, params?: Record<string, string | number>): void {
    this.diags.push({ severity, code, message, blockId, params: { arch: this.arch, platform: this.platform, ...params }, source: 'generator' });
  }

  private ins(text: string): void {
    this.em.line(text);
  }

  private label(name: string, id?: string): boolean {
    if (!LABEL_RE.test(name)) {
      this.report('error', 'asm.badLabel', `"${name}" is not a valid label name.`, id, { label: name });
      return false;
    }
    if (this.defined.has(name)) this.report('error', 'asm.duplicateLabel', `The label "${name}" is defined more than once.`, id, { label: name });
    this.defined.add(name);
    return true;
  }

  private ref(name: string, id?: string): string {
    if (!LABEL_RE.test(name)) this.report('error', 'asm.badLabel', `"${name}" is not a valid label name.`, id, { label: name });
    else this.referenced.push({ label: name, id });
    return name;
  }

  private reg(i: AsmInstr, field: string): string {
    const r = i.f[field] ?? '';
    const valid = this.arch === 'arm64' ? A64_REGS : X64_REGS;
    if (!valid.includes(r)) this.report('error', 'asm.badRegister', `"${r}" is not a ${this.arch} register.`, i.id, { register: r });
    return r;
  }

  private imm(i: AsmInstr, field: string, min?: number, max?: number): bigint {
    const raw = i.f[field] ?? '0';
    let v: bigint;
    try {
      v = BigInt(Math.trunc(Number(raw)));
    } catch {
      v = 0n;
      this.report('error', 'asm.badImmediate', `"${raw}" is not a whole number.`, i.id, { value: raw });
    }
    if ((min !== undefined && v < BigInt(min)) || (max !== undefined && v > BigInt(max))) {
      this.report('error', 'asm.immediateRange', `The value ${v} is outside the allowed range ${min}..${max} for this instruction.`, i.id, { value: String(v), min: min ?? 0, max: max ?? 0 });
    }
    return v;
  }

  // ---------- ARM64 ----------

  /** Load any 64-bit constant with mov/movz/movk. */
  private a64Const(dst: string, value: bigint): void {
    if (value >= -65536n && value <= 65535n) {
      this.ins(`mov ${dst}, #${value}`);
      return;
    }
    const u = BigInt.asUintN(64, value);
    let first = true;
    for (let shift = 0n; shift < 64n; shift += 16n) {
      const chunk = (u >> shift) & 0xffffn;
      if (chunk === 0n) continue;
      this.ins(`${first ? 'movz' : 'movk'} ${dst}, #0x${chunk.toString(16)}${shift ? `, lsl #${shift}` : ''}`);
      first = false;
    }
  }

  private a64Address(dst: string, label: string): void {
    if (this.platform === 'macos') {
      this.ins(`adrp ${dst}, ${label}@PAGE`);
      this.ins(`add ${dst}, ${dst}, ${label}@PAGEOFF`);
    } else {
      this.ins(`adrp ${dst}, ${label}`);
      this.ins(`add ${dst}, ${dst}, :lo12:${label}`);
    }
  }

  private a64Syscall(number: number): void {
    if (this.platform === 'macos') {
      this.ins(`mov x16, #${number}`);
      this.ins('svc #0x80');
    } else {
      this.ins(`mov x8, #${number}`);
      this.ins('svc #0');
    }
  }

  private x64Syscall(number: number): void {
    this.ins(`mov rax, ${number >= 0x10000 ? '0x' + number.toString(16) : number}`);
    this.ins('syscall');
  }

  private printText(i: AsmInstr): void {
    const text = (i.f.TEXT ?? '') + (i.f.NEWLINE === 'true' || i.f.NEWLINE === 'TRUE' ? '\n' : '');
    const { lit, bytes } = asciiLiteral(text);
    const name = `text_${++this.textCount}`;
    this.data.push(`${name}: .ascii "${lit}"`);
    if (this.arch === 'arm64') {
      this.ins('mov x0, #1');
      this.a64Address('x1', name);
      this.ins(`mov x2, #${bytes}`);
      this.a64Syscall(this.sys.write);
    } else {
      this.ins('mov rdi, 1');
      this.ins(`lea rsi, [rip + ${name}]`);
      this.ins(`mov rdx, ${bytes}`);
      this.x64Syscall(this.sys.write);
    }
  }

  private exit(code: bigint): void {
    if (this.arch === 'arm64') {
      this.ins(`mov x0, #${code}`);
      this.a64Syscall(this.sys.exit);
    } else {
      this.ins(`mov rdi, ${code}`);
      this.x64Syscall(this.sys.exit);
    }
  }

  private instr(i: AsmInstr): void {
    const start = this.em.count;
    if (i.arch !== 'any' && i.arch !== this.arch) {
      this.report('error', 'asm.wrongArch', `This is a ${i.arch} instruction block, but the program targets ${this.arch}.`, i.id, { blockArch: i.arch });
      this.ins(`// skipped ${i.arch} instruction`);
      this.em.mark(i.id, start);
      return;
    }
    const f = i.f;
    switch (i.op) {
      // ----- portable -----
      case 'asm_print_text':
        this.printText(i);
        break;
      case 'asm_exit':
        this.exit(this.imm(i, 'CODE', 0, 255));
        break;
      case 'asm_label': {
        const name = f.LABEL ?? f.NAME ?? '';
        if (this.label(name, i.id)) {
          this.em.dedent();
          this.em.line(`${name}:`);
          this.em.indent();
        }
        break;
      }
      case 'asm_comment':
        for (const l of (f.TEXT ?? '').split('\n')) this.ins(`// ${l}`.trimEnd());
        break;
      case 'asm_raw':
        this.ins(f.CODE ?? '');
        break;

      // ----- ARM64 -----
      case 'a64_mov_imm':
        this.a64Const(this.reg(i, 'DST'), this.imm(i, 'IMM'));
        break;
      case 'a64_mov_reg':
        this.ins(`mov ${this.reg(i, 'DST')}, ${this.reg(i, 'SRC')}`);
        break;
      case 'a64_arith':
        this.ins(`${f.OP} ${this.reg(i, 'DST')}, ${this.reg(i, 'A')}, ${this.reg(i, 'B')}`);
        break;
      case 'a64_arith_imm':
        this.ins(`${f.OP} ${this.reg(i, 'DST')}, ${this.reg(i, 'A')}, #${this.imm(i, 'IMM', 0, 4095)}`);
        break;
      case 'a64_cmp':
        this.ins(`cmp ${this.reg(i, 'A')}, ${this.reg(i, 'B')}`);
        break;
      case 'a64_cmp_imm':
        this.ins(`cmp ${this.reg(i, 'A')}, #${this.imm(i, 'IMM', 0, 4095)}`);
        break;
      case 'a64_branch':
        this.ins(`${f.COND} ${this.ref(f.LABEL ?? '', i.id)}`);
        break;
      case 'a64_cbz':
        this.ins(`${f.MODE} ${this.reg(i, 'REG')}, ${this.ref(f.LABEL ?? '', i.id)}`);
        break;
      case 'a64_call':
        this.ins(`bl ${this.ref(f.LABEL ?? '', i.id)}`);
        break;
      case 'a64_ret':
        this.ins('ret');
        break;
      case 'a64_push':
        this.ins(`str ${this.reg(i, 'REG')}, [sp, #-16]!`);
        break;
      case 'a64_pop':
        this.ins(`ldr ${this.reg(i, 'REG')}, [sp], #16`);
        break;
      case 'a64_save_lr':
        if (f.MODE === 'restore') this.ins('ldp x29, x30, [sp], #16');
        else {
          this.ins('stp x29, x30, [sp, #-16]!');
          this.ins('mov x29, sp');
        }
        break;
      case 'a64_print_reg': {
        const r = this.reg(i, 'REG');
        this.needsPrintInt = true;
        if (r !== 'x0') this.ins(`mov x0, ${r}`);
        this.ins('bl bf_print_int');
        break;
      }

      // ----- x86-64 -----
      case 'x64_mov_imm':
        this.ins(`mov ${this.reg(i, 'DST')}, ${this.imm(i, 'IMM')}`);
        break;
      case 'x64_mov_reg':
        this.ins(`mov ${this.reg(i, 'DST')}, ${this.reg(i, 'SRC')}`);
        break;
      case 'x64_arith':
        this.ins(`${f.OP} ${this.reg(i, 'DST')}, ${this.reg(i, 'SRC')}`);
        break;
      case 'x64_arith_imm': {
        const dst = this.reg(i, 'DST');
        const v = this.imm(i, 'IMM', -2147483648, 2147483647);
        this.ins(f.OP === 'imul' ? `imul ${dst}, ${dst}, ${v}` : `${f.OP} ${dst}, ${v}`);
        break;
      }
      case 'x64_incdec':
        this.ins(`${f.OP} ${this.reg(i, 'REG')}`);
        break;
      case 'x64_cmp':
        this.ins(`cmp ${this.reg(i, 'A')}, ${this.reg(i, 'B')}`);
        break;
      case 'x64_cmp_imm':
        this.ins(`cmp ${this.reg(i, 'A')}, ${this.imm(i, 'IMM', -2147483648, 2147483647)}`);
        break;
      case 'x64_jump':
        this.ins(`${f.COND} ${this.ref(f.LABEL ?? '', i.id)}`);
        break;
      case 'x64_call':
        this.ins(`call ${this.ref(f.LABEL ?? '', i.id)}`);
        break;
      case 'x64_ret':
        this.ins('ret');
        break;
      case 'x64_push':
        this.ins(`push ${this.reg(i, 'REG')}`);
        break;
      case 'x64_pop':
        this.ins(`pop ${this.reg(i, 'REG')}`);
        break;
      case 'x64_print_reg': {
        const r = this.reg(i, 'REG');
        this.needsPrintInt = true;
        if (r !== 'rdi') this.ins(`mov rdi, ${r}`);
        this.ins('call bf_print_int');
        break;
      }
      default:
        this.report('error', 'blocks.unknownType', `Unknown instruction block "${i.op}".`, i.id, { type: i.op });
    }
    this.em.mark(i.id, start);
  }

  private routine(r: AsmRoutine): void {
    const start = this.em.count;
    const entry = this.platform === 'macos' ? '_main' : 'main';
    const name = r.isEntry ? entry : r.name;
    if (!r.isEntry && !this.label(name, r.id)) return;
    if (r.isEntry) this.defined.add(name);
    this.em.line(`${name}:`);
    this.em.indent();
    for (const i of r.body) this.instr(i);
    const last = r.body[r.body.length - 1]?.op;
    if (r.isEntry) {
      if (last !== 'asm_exit') {
        this.report('info', 'asm.exitAdded', 'The program did not end with an exit block, so "exit with code 0" was added.', r.id);
        this.exit(0n);
      }
    } else {
      if (last !== 'a64_ret' && last !== 'x64_ret' && last !== 'asm_exit') {
        this.report('warning', 'asm.noReturn', `The routine "${r.name}" does not end with a return block, so execution falls through to whatever follows it.`, r.id, { name: r.name });
      }
      if (this.arch === 'arm64') {
        const calls = r.body.some((i) => i.op === 'a64_call' || i.op === 'a64_print_reg');
        const saves = r.body.some((i) => i.op === 'a64_save_lr');
        if (calls && !saves) this.report('warning', 'asm.linkRegister', `The routine "${r.name}" calls another routine without saving the link register, so its own return address is lost. Add "save frame and link registers" at the start and "restore" before returning.`, r.id, { name: r.name });
      }
    }
    this.em.dedent();
    this.em.mark(r.id, start);
    this.em.blank();
  }

  private printIntHelper(): void {
    const em = this.em;
    em.line('// Prints the signed number in the first argument register, followed by a newline.');
    em.line('bf_print_int:');
    em.indent();
    const lines =
      this.arch === 'arm64'
        ? [
            'stp x29, x30, [sp, #-48]!',
            'mov x29, sp',
            'add x9, sp, #47',
            'mov w10, #10',
            'strb w10, [x9]',
            'mov x11, #1',
            'mov x12, x0',
            'cmp x0, #0',
            'cneg x12, x12, lt',
            'mov x13, #10',
            '1:',
            'udiv x14, x12, x13',
            'msub x15, x14, x13, x12',
            'add w15, w15, #48',
            'sub x9, x9, #1',
            'strb w15, [x9]',
            'add x11, x11, #1',
            'mov x12, x14',
            'cbnz x12, 1b',
            'cmp x0, #0',
            'b.ge 2f',
            'sub x9, x9, #1',
            'mov w15, #45',
            'strb w15, [x9]',
            'add x11, x11, #1',
            '2:',
            'mov x0, #1',
            'mov x1, x9',
            'mov x2, x11',
            ...(this.platform === 'macos' ? [`mov x16, #${this.sys.write}`, 'svc #0x80'] : [`mov x8, #${this.sys.write}`, 'svc #0']),
            'ldp x29, x30, [sp], #48',
            'ret',
          ]
        : [
            'push rbp',
            'mov rbp, rsp',
            'sub rsp, 32',
            'lea r9, [rbp - 1]',
            'mov byte ptr [r9], 10',
            'mov r10, 1',
            'mov rax, rdi',
            'mov r8, rdi',
            'test rax, rax',
            'jns 1f',
            'neg rax',
            '1:',
            'mov rcx, 10',
            '2:',
            'xor edx, edx',
            'div rcx',
            'add dl, 48',
            'dec r9',
            'mov byte ptr [r9], dl',
            'inc r10',
            'test rax, rax',
            'jnz 2b',
            'test r8, r8',
            'jns 3f',
            'dec r9',
            'mov byte ptr [r9], 45',
            'inc r10',
            '3:',
            'mov rdi, 1',
            'mov rsi, r9',
            'mov rdx, r10',
            `mov rax, ${this.sys.write >= 0x10000 ? '0x' + this.sys.write.toString(16) : this.sys.write}`,
            'syscall',
            'mov rsp, rbp',
            'pop rbp',
            'ret',
          ];
    for (const l of lines) {
      if (/^\d+:$/.test(l)) {
        em.dedent();
        em.line(l);
        em.indent();
      } else em.line(l);
    }
    em.dedent();
    em.blank();
  }

  write(program: AsmProgram): void {
    const em = this.em;
    const entry = this.platform === 'macos' ? '_main' : 'main';
    em.line(`// ${this.arch === 'arm64' ? 'ARM64' : 'x86-64'} assembly for ${this.platform === 'macos' ? 'macOS' : 'Linux'}`);
    if (this.arch === 'x86_64') em.line('.intel_syntax noprefix');
    em.line(`.global ${entry}`);
    em.blank();
    em.line('.text');
    if (this.arch === 'arm64') em.line('.align 4');
    em.blank();
    for (const r of program.routines) this.routine(r);
    if (this.needsPrintInt) {
      this.defined.add('bf_print_int');
      this.printIntHelper();
    }
    if (this.data.length) {
      em.line('.data');
      for (const d of this.data) em.line(d);
    }
    for (const r of this.referenced) {
      if (!this.defined.has(r.label)) this.report('error', 'asm.undefinedLabel', `The label "${r.label}" is not defined anywhere.`, r.id, { label: r.label });
    }
  }
}

export const assemblyGenerator = {
  generate(program: AsmProgram, opts: GenOptions = {}): GenResult {
    const w = new AsmWriter(program.arch, program.platform);
    if (!program.hasProgram) w.report('error', 'asm.noProgram', 'Add an assembly program block to choose the architecture and hold the instructions.');
    else w.write(program);
    const file = opts.baseName ? `${opts.baseName}.s` : 'main.s';
    return {
      language: 'assembly',
      files: [{ path: file, content: w.em.toString(), role: 'main' }],
      mappings: w.em.mappings(file),
      dependencies: [],
      diagnostics: w.diags,
      meta: { entryFile: file, languageName: 'Assembly', variant: `${program.arch}-${program.platform}`, features: [] },
      requirements: {
        toolchains: ['cc'],
        notes: [`Targets ${program.arch} on ${program.platform}. It only runs on a matching CPU and operating system.`],
      },
    };
  },
};

export default assemblyGenerator;
