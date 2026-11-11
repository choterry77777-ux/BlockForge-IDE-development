import type { ClassDecl, FuncDecl, InterfaceDecl, TypeRef } from '../ir/types';
import type { LanguageId } from '../types';
import type { Emitter } from './emitter';
import { JavaScriptGenerator } from './javascript';

/** TypeScript: the JavaScript generator plus explicit type annotations. */
export class TypeScriptGenerator extends JavaScriptGenerator {
  override readonly lang: LanguageId = 'typescript';
  protected override ts = true;

  protected override typeName(t: TypeRef): string {
    switch (t.k) {
      case 'int':
      case 'float':
        return 'number';
      case 'string':
        return 'string';
      case 'bool':
        return 'boolean';
      case 'void':
        return 'void';
      case 'list':
        return `${this.wrap(this.typeName(t.of))}[]`;
      case 'map':
        return `Record<string, ${this.typeName(t.value)}>`;
      case 'struct':
        return this.typeId(t.name);
      case 'func':
        return '(...args: any[]) => any';
      default:
        return 'any';
    }
  }

  private wrap(name: string): string {
    return /[ |&=]/.test(name) ? `(${name})` : name;
  }

  protected override ann(t: TypeRef | undefined): string {
    return `: ${this.typeName(t ?? { k: 'unknown' })}`;
  }

  protected override retAnn(f: FuncDecl, isAsync: boolean): string {
    const name = this.typeName(f.ret);
    return `: ${isAsync ? `Promise<${name}>` : name}`;
  }

  protected override preamble(out: Emitter): void {
    // A module keeps top-level names local, so they cannot clash with browser globals such as "name".
    out.line('export {};');
    if (this.usesNode) {
      // Keeps the file self-contained when @types/node is not installed.
      out.line('declare const require: any;');
      out.line('declare const process: any;');
      out.line('declare const Buffer: any;');
    }
    out.blank();
  }

  protected override implementsClause(c: ClassDecl): string {
    return c.implements ? ` implements ${this.typeId(c.implements)}` : '';
  }

  protected override emitInterface(i: InterfaceDecl): void {
    this.em.line(`interface ${this.typeId(i.name)} {`);
    this.em.indent();
    for (const m of i.methods) {
      this.em.line(`${this.member(m.name)}(${m.params.map((p) => `${this.member(p.name)}: ${this.typeName(p.type)}`).join(', ')}): ${this.typeName(m.ret)};`);
    }
    this.em.dedent();
    this.em.line('}');
  }
}

export default new TypeScriptGenerator();
