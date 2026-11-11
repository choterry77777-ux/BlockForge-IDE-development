import { type BlockDef, C, D, Nu, S, Tx } from './schema';

export const A64_REGS = Array.from({ length: 29 }, (_, i) => `x${i}`);
export const X64_REGS = ['rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'rbp'];

const A = (name: string) => D(name, ...A64_REGS);
const X = (name: string) => D(name, ...X64_REGS);
const ins = (d: Omit<BlockDef, 'domain' | 'prev' | 'style'> & { style?: string }): BlockDef => ({ domain: 'asm', prev: 'Asm', style: 'asm_blocks', ...d });
const a64 = (d: Omit<BlockDef, 'domain' | 'prev' | 'style' | 'category'>): BlockDef => ins({ category: 'arm64', style: 'asm_a64_blocks', ...d });
const x64 = (d: Omit<BlockDef, 'domain' | 'prev' | 'style' | 'category'>): BlockDef => ins({ category: 'x86_64', style: 'asm_x64_blocks', ...d });

export const ASM_BLOCKS: BlockDef[] = [
  { type: 'asm_program', domain: 'asm', category: 'asm', style: 'start_blocks', hat: true, rows: [['assembly program for %1 on %2', D('ARCH', ['ARM64', 'arm64'], ['x86-64', 'x86_64']), D('PLATFORM', ['macOS', 'macos'], ['Linux', 'linux'])], ['%1', S('BODY', 'Asm')]], tip: 'Entry point. Instruction blocks must match the selected architecture.' },
  { type: 'asm_routine', domain: 'asm', category: 'asm', style: 'procedure_blocks', hat: true, rows: [['routine %1', Tx('NAME', 'helper')], ['%1', S('BODY', 'Asm')]], tip: 'A labelled routine. Call it with a call block and end it with a return block.' },

  // ----- portable blocks: each expands to real instructions for the program architecture -----
  ins({ type: 'asm_print_text', category: 'asm', rows: [['print text %1 newline %2', Tx('TEXT', 'Hello'), C('NEWLINE', true)]], tip: 'Writes text to standard output with the write system call. Overwrites the argument registers.' }),
  ins({ type: 'asm_exit', category: 'asm', rows: [['exit with code %1', Nu('CODE', 0, { min: 0, max: 255, int: true })]], next: false }),
  ins({ type: 'asm_label', category: 'asm', rows: [['label %1', Tx('NAME', 'loop')]] }),
  ins({ type: 'asm_comment', category: 'asm', style: 'raw_blocks', rows: [['comment %1', Tx('TEXT', 'note')]] }),
  ins({ type: 'asm_raw', category: 'asm', style: 'raw_blocks', rows: [['instruction %1', Tx('CODE', 'nop')]], tip: 'Inserted verbatim. The assembler reports any error.' }),

  // ----- ARM64 -----
  a64({ type: 'a64_mov_imm', rows: [['%1 = %2', A('DST'), Nu('IMM', 0, { int: true })]], tip: 'mov / movz / movk sequence for a 64-bit immediate.' }),
  a64({ type: 'a64_mov_reg', rows: [['%1 = %2', A('DST'), A('SRC')]] }),
  a64({ type: 'a64_arith', rows: [['%1 = %2 %3 %4', A('DST'), A('A'), D('OP', ['+', 'add'], ['-', 'sub'], ['*', 'mul'], ['/ signed', 'sdiv'], ['/ unsigned', 'udiv'], ['and', 'and'], ['or', 'orr'], ['xor', 'eor'], ['<<', 'lsl'], ['>>', 'lsr']), A('B')]] }),
  a64({ type: 'a64_arith_imm', rows: [['%1 = %2 %3 %4', A('DST'), A('A'), D('OP', ['+', 'add'], ['-', 'sub']), Nu('IMM', 1, { min: 0, max: 4095, int: true })]], tip: 'Immediate must be between 0 and 4095.' }),
  a64({ type: 'a64_cmp', rows: [['compare %1 with %2', A('A'), A('B')]] }),
  a64({ type: 'a64_cmp_imm', rows: [['compare %1 with %2', A('A'), Nu('IMM', 0, { min: 0, max: 4095, int: true })]] }),
  a64({ type: 'a64_branch', rows: [['branch %1 to %2', D('COND', ['always', 'b'], ['if equal', 'b.eq'], ['if not equal', 'b.ne'], ['if less', 'b.lt'], ['if less or equal', 'b.le'], ['if greater', 'b.gt'], ['if greater or equal', 'b.ge']), Tx('LABEL', 'loop')]] }),
  a64({ type: 'a64_cbz', rows: [['branch to %3 if %1 is %2', A('REG'), D('MODE', ['zero', 'cbz'], ['not zero', 'cbnz']), Tx('LABEL', 'done')]] }),
  a64({ type: 'a64_call', rows: [['call routine %1', Tx('LABEL', 'helper')]], tip: 'bl: the return address goes to x30.' }),
  a64({ type: 'a64_ret', rows: [['return']], next: false }),
  a64({ type: 'a64_push', rows: [['push %1', A('REG')]], tip: 'Keeps the stack 16-byte aligned.' }),
  a64({ type: 'a64_pop', rows: [['pop %1', A('REG')]] }),
  a64({ type: 'a64_save_lr', rows: [['%1 frame and link registers', D('MODE', ['save', 'save'], ['restore', 'restore'])]], tip: 'stp/ldp x29, x30. Needed in routines that call other routines.' }),
  a64({ type: 'a64_print_reg', rows: [['print number in %1', A('REG')]], tip: 'Prints the signed decimal value followed by a newline. Preserves x19-x28.' }),

  // ----- x86-64 -----
  x64({ type: 'x64_mov_imm', rows: [['%1 = %2', X('DST'), Nu('IMM', 0, { int: true })]] }),
  x64({ type: 'x64_mov_reg', rows: [['%1 = %2', X('DST'), X('SRC')]] }),
  x64({ type: 'x64_arith', rows: [['%1 %2 %3', X('DST'), D('OP', ['+=', 'add'], ['-=', 'sub'], ['*=', 'imul'], ['and=', 'and'], ['or=', 'or'], ['xor=', 'xor']), X('SRC')]], tip: 'Two-operand form: the destination is also the first operand.' }),
  x64({ type: 'x64_arith_imm', rows: [['%1 %2 %3', X('DST'), D('OP', ['+=', 'add'], ['-=', 'sub'], ['*=', 'imul'], ['and=', 'and'], ['or=', 'or'], ['xor=', 'xor']), Nu('IMM', 1, { int: true })]] }),
  x64({ type: 'x64_incdec', rows: [['%2 %1', X('REG'), D('OP', ['increment', 'inc'], ['decrement', 'dec'])]] }),
  x64({ type: 'x64_cmp', rows: [['compare %1 with %2', X('A'), X('B')]] }),
  x64({ type: 'x64_cmp_imm', rows: [['compare %1 with %2', X('A'), Nu('IMM', 0, { int: true })]] }),
  x64({ type: 'x64_jump', rows: [['jump %1 to %2', D('COND', ['always', 'jmp'], ['if equal', 'je'], ['if not equal', 'jne'], ['if less', 'jl'], ['if less or equal', 'jle'], ['if greater', 'jg'], ['if greater or equal', 'jge']), Tx('LABEL', 'loop')]] }),
  x64({ type: 'x64_call', rows: [['call routine %1', Tx('LABEL', 'helper')]] }),
  x64({ type: 'x64_ret', rows: [['return']], next: false }),
  x64({ type: 'x64_push', rows: [['push %1', X('REG')]] }),
  x64({ type: 'x64_pop', rows: [['pop %1', X('REG')]] }),
  x64({ type: 'x64_print_reg', rows: [['print number in %1', X('REG')]], tip: 'Prints the signed decimal value followed by a newline. Preserves rbx, rbp and r12-r15.' }),
];
