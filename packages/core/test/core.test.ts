import { describe, expect, it } from 'vitest';
import * as b from '../src/blocks/dsl';
import { BLOCKS, CUSTOM_BLOCK_DEFS } from '../src/blocks/registry';
import { toBlocklyJson } from '../src/blocks/schema';
import { blockToSpec, countBlocks, specsToWorkspace, workspaceToSpecs } from '../src/blocks/state';
import { blockTypesFor, buildToolbox } from '../src/blocks/toolbox';
import { validateWorkspace } from '../src/blocks/validate';
import { buildPlan } from '../src/build/recipes';
import { ALLOWED_EXECUTABLES, TOOLCHAINS } from '../src/build/toolchains';
import { semanticNotes, TYPE_NAMES } from '../src/compare';
import { manifestsFor, managersFor, PACKAGE_MANAGER_BY_ID, PACKAGE_MANAGERS, validDependency } from '../src/deps/managers';
import { IMPERATIVE_EXAMPLES } from '../src/examples/imperative';
import { examplesFor } from '../src/examples';
import { importJavaScript } from '../src/importJs';
import { analyze } from '../src/ir/analyze';
import { imperativeFromBlocks } from '../src/ir/fromBlocks';
import { T, typeToString, unify } from '../src/ir/types';
import { IMPERATIVE_LANGUAGES, LANGUAGES, languageByExtension } from '../src/langs';
import { blockAtLine, generate, generateMany, linesOfBlock } from '../src/pipeline';
import { createProject, duplicateProject, parseProject, serializeProject, uniqueFileName } from '../src/project/format';
import { computeSupport, unsupportedBlocks } from '../src/support';
import { LANGUAGE_IDS } from '../src/types';

describe('language registry', () => {
  it('defines all 19 languages with distinct extensions', () => {
    expect(LANGUAGE_IDS).toHaveLength(19);
    expect(new Set(Object.values(LANGUAGES).map((l) => l.ext)).size).toBe(19);
    expect(IMPERATIVE_LANGUAGES).toHaveLength(15);
    expect(languageByExtension('.kt')).toBe('kotlin');
    expect(languageByExtension('asm')).toBe('assembly');
  });

  it('offers at least one example for every language', () => {
    for (const lang of LANGUAGE_IDS) expect(examplesFor(lang).length, lang).toBeGreaterThan(0);
  });
});

describe('block definitions', () => {
  it('produce well-formed Blockly JSON with matching placeholders', () => {
    for (const def of CUSTOM_BLOCK_DEFS) {
      const json = toBlocklyJson(def) as Record<string, unknown>;
      def.rows.forEach((row, i) => {
        const args = json[`args${i}`] as unknown[];
        const used = new Set([...String(json[`message${i}`]).matchAll(/%(\d+)/g)].map((m) => Number(m[1])));
        expect(used.size, `${def.type} row ${i}`).toBe(args.length);
        for (let n = 1; n <= args.length; n++) expect(used.has(n), `${def.type} row ${i} %${n}`).toBe(true);
      });
    }
  });

  it('have unique types and a registry entry each', () => {
    const types = CUSTOM_BLOCK_DEFS.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    for (const t of types) expect(BLOCKS[t]).toBeDefined();
  });

  it('builds a toolbox per language with only blocks valid for it', () => {
    const label = (id: string) => id;
    const c = JSON.stringify(buildToolbox({ lang: 'c', label }));
    const py = JSON.stringify(buildToolbox({ lang: 'python', label }));
    expect(c).toContain('bf_alloc');
    expect(py).not.toContain('bf_alloc');
    expect(py).not.toContain('bf_dom_set');
    expect(JSON.stringify(buildToolbox({ lang: 'javascript', label }))).toContain('bf_dom_set');
    expect(blockTypesFor('sql')).toContain('sql_select');
    expect(blockTypesFor('sql')).not.toContain('text_print');
    expect(blockTypesFor('assembly').every((t) => BLOCKS[t].domain === 'asm')).toBe(true);
    const disabled = JSON.stringify(buildToolbox({ lang: 'c', label, unsupported: new Set(['bf_try']) }));
    expect(disabled).toContain('"type":"bf_try","enabled":false');
  });
});

describe('block serialization', () => {
  it('round-trips between compact specs and Blockly state', () => {
    for (const ex of IMPERATIVE_EXAMPLES) {
      const state = ex.build();
      const again = specsToWorkspace(workspaceToSpecs(state));
      expect(countBlocks(again), ex.id).toBe(countBlocks(state));
      expect(workspaceToSpecs(again).map((s) => s.map(strip))).toEqual(workspaceToSpecs(state).map((s) => s.map(strip)));
      expect(validateWorkspace(state, 'imperative'), ex.id).toEqual([]);
    }
  });

  it('derives dynamic input counts and resolves variables by name', () => {
    const ws = b.workspace(b.start(b.setv('x', b.list(b.num(1), b.num(2), b.num(3))), b.ifs([[b.bool(true), []], [b.bool(false), []]], [])));
    const top = ws.blocks!.blocks[0];
    const setX = top.next!.block!;
    expect(setX.inputs!.VALUE.block!.extraState).toEqual({ itemCount: 3 });
    expect(setX.next!.block!.extraState).toEqual({ elseIfCount: 1, hasElse: true });
    expect(ws.variables).toHaveLength(1);
    expect(blockToSpec(setX, ws.variables!).fields).toEqual({ VAR: 'x' });
  });
});

function strip(spec: unknown): unknown {
  if (Array.isArray(spec)) return spec.map(strip);
  if (spec && typeof spec === 'object') return Object.fromEntries(Object.entries(spec).filter(([k]) => k !== 'id').map(([k, v]) => [k, strip(v)]));
  return spec;
}

describe('IR conversion and type analysis', () => {
  it('infers types through assignments, calls and recursion', () => {
    const ws = b.workspace(
      b.fnDef('fact', ['n'], [b.ifReturn(b.cmp('LTE', b.getv('n'), b.num(1)), b.num(1))], b.mul(b.getv('n'), b.call('fact', b.sub(b.getv('n'), b.num(1))))),
      b.fnDef('label', ['who'], [], b.join(b.text('Hi '), b.getv('who'))),
      b.start(b.setv('a', b.num(1)), b.setv('a', b.num(2.5)), b.setv('items', b.list()), b.append(b.getv('items'), b.text('x')), b.setv('r', b.call('fact', b.num(5))), b.print(b.call('label', b.text('you')))),
    );
    const { program, diagnostics } = imperativeFromBlocks(ws);
    expect(diagnostics).toEqual([]);
    const an = analyze(program);
    expect(typeToString(an.main.vars.get('a')!.type)).toBe('float');
    expect(typeToString(an.main.vars.get('items')!.type)).toBe('list<string>');
    expect(typeToString(an.main.vars.get('r')!.type)).toBe('int');
    expect(program.funcs[0].ret).toEqual(T.int);
    expect(program.funcs[0].params[0].type).toEqual(T.int);
    expect(program.funcs[1].params[0].type).toEqual(T.string);
    expect(an.features.has('recursion')).toBe(true);
  });

  it('unifies types conservatively', () => {
    expect(unify(T.int, T.float)).toEqual(T.float);
    expect(unify(T.unknown, T.string)).toEqual(T.string);
    expect(unify(T.list(T.int), T.list(T.float))).toEqual(T.list(T.float));
    expect(unify(T.int, T.string)).toEqual(T.any);
  });

  it('decides where variables are declared', () => {
    const ws = b.workspace(
      b.fnDef('bump', [], [b.change('shared', b.num(1))]),
      b.start(b.setv('shared', b.num(0)), b.setv('top', b.num(1)), b.iff(b.bool(true), [b.setv('late', b.num(2))]), b.print(b.getv('late')), b.count('i', 1, 3, [b.setv('inner', b.getv('i')), b.print(b.getv('inner'))]), b.callStmt('bump')),
    );
    const an = analyze(imperativeFromBlocks(ws).program);
    expect([...an.globals.keys()]).toEqual(['shared']);
    expect(an.main.vars.get('top')!.decl).toBe('atFirst');
    expect(an.main.vars.get('late')!.decl).toBe('hoist');
    expect(an.main.vars.get('i')!.decl).toBe('loop');
    expect(an.main.vars.get('inner')!.decl).toBe('atFirst');
    expect(an.main.vars.get('top')!.reassigned).toBe(false);
  });

  it('reports structural mistakes', async () => {
    const cases: [ReturnType<typeof b.workspace>, string][] = [
      [b.workspace(b.start(b.print({ type: 'math_arithmetic', fields: { OP: 'ADD' }, inputs: { A: b.num(1) } }))), 'blocks.emptyInput'],
      [b.workspace(b.start(b.brk())), 'analysis.breakOutsideLoop'],
      [b.workspace(b.start(b.ret(b.num(1)))), 'analysis.returnInMain'],
      [b.workspace([b.print(b.text('loose'))]), 'blocks.orphan'],
      [b.workspace(b.start(), b.start()), 'blocks.multipleStart'],
      [b.workspace(b.start(b.declare('K', 'int', b.num(1), true), b.setv('K', b.num(2)))), 'analysis.constReassigned'],
      [b.workspace(b.start(b.print(b.create('Missing')))), 'analysis.unknownClass'],
      [b.workspace(b.start({ type: 'sql_where', inputs: { COND: b.bool(true) } })), 'blocks.wrongDomain'],
    ];
    for (const [ws, code] of cases) {
      const r = await generate(ws, 'python');
      expect(r.diagnostics.map((d) => d.code), code).toContain(code);
    }
  });

  it('diagnoses mixed types in static languages instead of emitting wrong code', async () => {
    const ws = b.workspace(b.start(b.setv('v', b.num(1)), b.setv('v', b.text('now text')), b.print(b.getv('v'))));
    expect((await generate(ws, 'python')).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    for (const lang of ['c', 'java', 'go', 'rust'] as const) {
      expect((await generate(ws, lang)).diagnostics.some((d) => d.code === 'gen.mixedTypes' && d.severity === 'error'), lang).toBe(true);
    }
  });
});

describe('source mapping', () => {
  it('maps every statement block to lines and lines back to the innermost block', async () => {
    const ws = b.workspace(b.start(b.setv('total', b.num(0)), b.count('i', 1, 3, [b.change('total', b.getv('i'))]), b.print(b.getv('total'))));
    for (const lang of IMPERATIVE_LANGUAGES) {
      const r = await generate(ws, lang);
      const file = r.meta.entryFile;
      const lines = r.files[0].content.split('\n');
      // b3 and b6 are variable ids; b10 is the statement inside the loop.
      const ids = ['b2', 'b5', 'b10', 'b12'];
      for (const id of ids) expect(linesOfBlock(r, id), `${lang} ${id}`).toBeDefined();
      const loop = linesOfBlock(r, 'b5')!;
      const inner = linesOfBlock(r, 'b10')!;
      expect(inner.startLine).toBeGreaterThan(loop.startLine - 1);
      expect(inner.endLine).toBeLessThanOrEqual(loop.endLine);
      expect(blockAtLine(r, file, inner.startLine)).toBe('b10');
      expect(lines[linesOfBlock(r, 'b12')!.startLine - 1]).toMatch(/total/);
      for (const m of r.mappings) {
        expect(m.startLine).toBeGreaterThan(0);
        expect(m.endLine).toBeLessThanOrEqual(lines.length);
      }
    }
  });

  it('attaches lines to diagnostics that name a block', async () => {
    const ws = b.workspace(b.start(b.print(b.text('ok')), b.tryCatch([b.print(b.text('x'))], 'e', [])));
    const r = await generate(ws, 'c');
    const d = r.diagnostics.find((x) => x.code === 'gen.unsupported')!;
    expect(d.blockId).toBeDefined();
    expect(d.line).toBeGreaterThan(0);
    expect(d.file).toBe('main.c');
  });

  it('generates several languages from one conversion', async () => {
    const out = await generateMany(IMPERATIVE_EXAMPLES[0].build(), ['python', 'rust', 'bash']);
    expect(out.python!.files[0].content).toBe('print("Hello, World!")\n');
    expect(out.rust!.files[0].content).toContain('println!("Hello, World!");');
    expect(out.bash!.files[0].content).toContain('echo "Hello, World!"');
  });
});

describe('name handling', () => {
  it('renames reserved words and keeps or encodes non-ASCII names per language', async () => {
    const ws = b.workspace(b.start(b.setv('class', b.num(1)), b.setv('합계', b.num(2)), b.setv('my total', b.num(3)), b.print(b.add(b.add(b.getv('class'), b.getv('합계')), b.getv('my total')))));
    const py = (await generate(ws, 'python')).files[0].content;
    expect(py).toContain('class_ = 1');
    expect(py).toContain('합계 = 2');
    expect(py).toContain('my_total = 3');
    const lua = (await generate(ws, 'lua')).files[0].content;
    expect(lua).toMatch(/local ud569uacc4 = 2/);
    expect((await generate(ws, 'java')).files[0].content).toContain('int class_ = 1;');
  });

  it('escapes text literals safely in every language', async () => {
    const ws = b.workspace(b.start(b.print(b.text('quote " back\\slash $x #{y} %d {z} \'s'))));
    for (const lang of IMPERATIVE_LANGUAGES) {
      const r = await generate(ws, lang);
      expect(r.diagnostics.filter((d) => d.severity === 'error'), lang).toEqual([]);
    }
  });
});

describe('build plans', () => {
  it('distinguishes interpreting, compiling, transpiling, previewing and querying', () => {
    const mode = (lang: (typeof LANGUAGE_IDS)[number]) => buildPlan({ language: lang, entry: LANGUAGES[lang].entry }).mode;
    expect(mode('python')).toBe('interpret');
    expect(mode('typescript')).toBe('transpile');
    expect(mode('rust')).toBe('compile');
    expect(mode('html')).toBe('preview');
    expect(mode('sql')).toBe('query');
  });

  it('applies profiles, compilers, architectures and dependencies', () => {
    const c = buildPlan({ language: 'c', entry: 'main.c', config: { profile: 'release', optimization: '3', arch: 'x86_64', standard: 'c17' } });
    expect(c.build[0].args).toEqual(expect.arrayContaining(['-std=c17', '-O3', '-arch', 'x86_64', '-o', 'build/main']));
    expect(c.build[0].args).not.toContain('-g');
    expect(buildPlan({ language: 'c', entry: 'main.c', platform: 'windows' }).artifact).toBe('build/main.exe');
    const rust = buildPlan({ language: 'rust', entry: 'main.rs', dependencies: [{ manager: 'cargo', name: 'serde', version: '1' }] });
    expect(rust.requires).toEqual(['cargo']);
    expect(rust.configFiles.find((f) => f.path === 'Cargo.toml')!.content).toContain('serde = "1"');
    const py = buildPlan({ language: 'python', entry: 'main.py', dependencies: [{ manager: 'pip', name: 'requests' }] });
    expect(py.env).toEqual({ PYTHONPATH: 'packages' });
    expect(py.configFiles[0]).toMatchObject({ path: 'requirements.txt', content: 'requests\n' });
    expect(buildPlan({ language: 'csharp', entry: 'Program.cs', dependencies: [{ manager: 'nuget', name: 'Newtonsoft.Json', version: '13.0.3' }] }).configFiles[0].content).toContain('<PackageReference Include="Newtonsoft.Json" Version="13.0.3" />');
    expect(buildPlan({ language: 'assembly', entry: 'main.s', asmArch: 'x86_64' }).build[0].args).toEqual(['main.s', '-arch', 'x86_64', '-o', 'build/main']);
  });

  it('only ever launches known toolchain executables', () => {
    for (const lang of LANGUAGE_IDS) {
      const plan = buildPlan({ language: lang, entry: LANGUAGES[lang].entry });
      for (const step of [...plan.build, ...(plan.run ? [plan.run] : [])]) {
        expect(step.tool === 'artifact' || TOOLCHAINS.some((t) => t.id === step.tool), `${lang} ${step.tool}`).toBe(true);
      }
    }
    expect(ALLOWED_EXECUTABLES).toEqual(expect.arrayContaining(['python3', 'clang', 'cargo', 'dotnet', 'kotlinc']));
    expect(ALLOWED_EXECUTABLES).not.toContain('sh');
    expect(ALLOWED_EXECUTABLES).not.toContain('rm');
  });
});

describe('dependency management', () => {
  it('covers the required package managers', () => {
    expect(PACKAGE_MANAGERS.map((m) => m.id).sort()).toEqual(['cargo', 'composer', 'gem', 'gomod', 'maven', 'npm', 'nuget', 'pip', 'pub']);
    expect(managersFor('typescript').map((m) => m.id)).toEqual(['npm']);
    expect(managersFor('c')).toEqual([]);
  });

  it('builds safe install commands that skip scripts by default', () => {
    const npm = PACKAGE_MANAGER_BY_ID.npm;
    expect(npm.install({ manager: 'npm', name: 'left-pad', version: '1.3.0' }, { allowScripts: false })).toEqual({ tool: 'npm', args: ['install', '--no-audit', '--no-fund', '--ignore-scripts', 'left-pad@1.3.0'] });
    expect(npm.install({ manager: 'npm', name: 'x' }, { allowScripts: true }).args).not.toContain('--ignore-scripts');
    expect(PACKAGE_MANAGER_BY_ID.pip.install({ manager: 'pip', name: 'requests' }, { allowScripts: false }).args).toEqual(expect.arrayContaining(['--only-binary', ':all:', '--target', 'packages', 'requests']));
    expect(PACKAGE_MANAGER_BY_ID.composer.install({ manager: 'composer', name: 'a/b' }, { allowScripts: false }).args).toEqual(expect.arrayContaining(['--no-scripts', '--no-plugins']));
  });

  it('rejects names that could be read as command-line options', () => {
    expect(validDependency({ manager: 'npm', name: '@scope/pkg', version: '^1.2.3' })).toBe(true);
    expect(validDependency({ manager: 'pip', name: '--index-url=http://evil' })).toBe(false);
    expect(validDependency({ manager: 'npm', name: 'x; rm -rf ~' })).toBe(false);
    expect(validDependency({ manager: 'npm', name: 'x', version: '--registry=http://evil' })).toBe(false);
  });

  it('parses registry responses', () => {
    expect(PACKAGE_MANAGER_BY_ID.npm.parseSearch!({ objects: [{ package: { name: 'a', version: '1.0.0', description: 'd' } }] })).toEqual([{ name: 'a', version: '1.0.0', description: 'd' }]);
    expect(PACKAGE_MANAGER_BY_ID.pip.parseInfo!({ info: { name: 'requests', version: '2.0', summary: 's' }, releases: { '1.0': [], '2.0': [] } }, 'requests')).toEqual({ name: 'requests', latest: '2.0', versions: ['2.0', '1.0'], description: 's' });
    expect(PACKAGE_MANAGER_BY_ID.cargo.parseSearch!({ crates: [{ name: 'serde', max_stable_version: '1.0.0', description: ' x \n' }] })).toEqual([{ name: 'serde', version: '1.0.0', description: 'x' }]);
    expect(PACKAGE_MANAGER_BY_ID.pip.parseInfo!({ message: 'Not Found' }, 'nope')).toBeUndefined();
  });

  it('writes manifests', () => {
    const files = manifestsFor([{ manager: 'npm', name: 'a', version: '1.0.0' }, { manager: 'gem', name: 'rake' }, { manager: 'maven', name: 'org.x:lib', version: '2' }], 'My App');
    expect(files.map((f) => f.path).sort()).toEqual(['Gemfile', 'package.json', 'pom.xml']);
    expect(JSON.parse(files.find((f) => f.path === 'package.json')!.content)).toMatchObject({ name: 'my-app', dependencies: { a: '1.0.0' } });
    expect(files.find((f) => f.path === 'pom.xml')!.content).toContain('<groupId>org.x</groupId>\n      <artifactId>lib</artifactId>\n      <version>2</version>');
  });
});

describe('project format', () => {
  it('saves and reloads a project without loss', async () => {
    const p = createProject('Demo', 'python', IMPERATIVE_EXAMPLES[4].build());
    p.dependencies.push({ manager: 'pip', name: 'requests', version: '2.32.0' });
    p.build.profile = 'release';
    p.settings.stdin = '42\n';
    const text = serializeProject(p);
    const { project, errors, warnings } = parseProject(text);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(project).toEqual(p);
    expect((await generate(project!.files[0].blocks, 'python')).files[0].content).toBe((await generate(p.files[0].blocks, 'python')).files[0].content);
  });

  it('never writes credentials and drops them when reading', () => {
    const p = createProject('Demo', 'python');
    p.ui = { providers: [{ name: 'claude', apiKey: 'sk-ant-secret-value-123456' }] };
    expect(() => serializeProject(p)).toThrow(/API key or password/);
    const text = JSON.stringify({ ...p, ui: { token: 'abc123456' } });
    const read = parseProject(text);
    expect(read.project!.ui).toBeUndefined();
    expect(read.warnings.join(' ')).toMatch(/credentials/);
  });

  it('rejects foreign, broken and too-new files with clear errors', () => {
    expect(parseProject('{').errors[0]).toMatch(/not valid JSON/);
    expect(parseProject('{"hello":1}').errors[0]).toMatch(/not a BlockForge project/);
    expect(parseProject(JSON.stringify({ format: 'blockforge-project', version: 99, files: [{}] })).errors[0]).toMatch(/newer BlockForge/);
    expect(parseProject(JSON.stringify({ format: 'blockforge-project', version: 1, files: [{ language: 'cobol' }] })).errors[0]).toMatch(/unknown language/);
  });

  it('reports damaged block data instead of failing silently', () => {
    const p = createProject('Demo', 'python', b.workspace(b.start(b.print(b.text('x')))));
    (p.files[0].blocks.blocks!.blocks[0].next!.block as { type: string }).type = 'not_a_block';
    const read = parseProject(JSON.stringify(p));
    expect(read.project).toBeDefined();
    expect(read.warnings[0]).toMatch(/unknown block type "not_a_block"/);
  });

  it('duplicates with fresh ids and unique file names', () => {
    const p = createProject('Demo', 'go');
    const d = duplicateProject(p, 'Copy');
    expect(d.id).not.toBe(p.id);
    expect(d.files[0].id).not.toBe(p.files[0].id);
    expect(d.activeFileId).toBe(d.files[0].id);
    expect(uniqueFileName(p, 'main.go')).toBe('main2.go');
    expect(uniqueFileName(p, 'other.go')).toBe('other.go');
  });
});

describe('comparison notes', () => {
  it('selects notes by program features and languages', () => {
    const base = semanticNotes(['print'], ['python', 'javascript']).map((n) => n.id);
    expect(base).toEqual(expect.arrayContaining(['typing', 'intSize', 'decimalPrint']));
    expect(base).not.toContain('listValue');
    expect(semanticNotes(['lists', 'print'], ['python']).map((n) => n.id)).toEqual(expect.arrayContaining(['listValue', 'listPrint']));
    expect(semanticNotes(['conditions'], ['python']).map((n) => n.id)).not.toContain('ternary');
    expect(semanticNotes(['conditions'], ['go']).map((n) => n.id)).toContain('ternary');
    for (const row of Object.values(TYPE_NAMES)) for (const lang of IMPERATIVE_LANGUAGES) expect(row[lang], lang).toBeTruthy();
  });
});

describe('measured feature support', () => {
  it('matches what the generators really do', async () => {
    const m = await computeSupport();
    for (const core of ['print', 'input', 'conditions', 'loops', 'functions', 'strings', 'math', 'convert', 'random', 'typedDecl', 'lists']) {
      for (const lang of IMPERATIVE_LANGUAGES) expect(m[core][lang], `${core} ${lang}`).toBe(true);
    }
    expect(m.maps.c).toBe(false);
    expect(m.exceptions).toMatchObject({ python: true, c: false, rust: false, bash: false, go: true });
    expect(m.classes).toMatchObject({ c: false, bash: false, rust: true, lua: true });
    expect(m.pointers).toMatchObject({ c: true, cpp: true, go: true, rust: true, python: false, java: false });
    expect(m.manualMemory).toMatchObject({ c: true, cpp: true, go: false, python: false });
    expect(m.dom).toMatchObject({ javascript: true, typescript: true, python: false });
    expect(m.http).toMatchObject({ python: true, javascript: true, c: false, lua: false, rust: false, bash: true });
    expect(unsupportedBlocks(m, 'c')).toEqual(expect.objectContaining(new Set()));
    expect(unsupportedBlocks(m, 'c').has('bf_try')).toBe(true);
    expect(unsupportedBlocks(m, 'python').has('bf_try')).toBe(false);
  });
});

describe('JavaScript import', () => {
  it('turns supported code into blocks that regenerate equivalent code', async () => {
    const src = `function square(n) {\n  return n * n;\n}\nlet total = 0;\nfor (let i = 1; i <= 5; i++) {\n  if (i % 2 === 0) {\n    total += square(i);\n  } else {\n    continue;\n  }\n}\nconst names = ["a", "b"];\nnames.push("c");\nconsole.log("Total: " + total + " of " + names.length);\nwhile (total > 10) {\n  total -= 7;\n}\nconsole.log(total > 3 ? "big" : "small");\n`;
    const r = importJavaScript(src);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.raw).toBe(0);
    expect(validateWorkspace(r.state!, 'imperative')).toEqual([]);
    const js = (await generate(r.state!, 'javascript')).files[0].content;
    const run = (code: string) => {
      const out: string[] = [];
      new Function('console', code)({ log: (x: unknown) => out.push(String(x)) });
      return out;
    };
    expect(run(js)).toEqual(run(src));
    expect(run(js)).toEqual(['Total: 20 of 3', 'big']);
    // The same blocks now generate any other language.
    expect((await generate(r.state!, 'python')).files[0].content).toContain('def square(n):\n    return n * n');
  });

  it('keeps unsupported code verbatim and says so', async () => {
    const src = `const { a, b } = load();\nconsole.log(a);\nsetTimeout(() => console.log("later"), 10);\nswitch (a) { case 1: break; }\n`;
    const r = importJavaScript(src);
    expect(r.ok).toBe(true);
    expect(r.raw).toBe(3);
    expect(r.warnings.map((w) => w.line)).toEqual([1, 3, 4]);
    const js = (await generate(r.state!, 'javascript')).files[0].content;
    expect(js).toContain('const { a, b } = load();');
    expect(js).toContain('setTimeout(() => console.log("later"), 10);');
    expect(js).toContain('switch (a) { case 1: break; }');
    expect(js).toContain('console.log(a);');
  });

  it('reports syntax errors instead of producing blocks', () => {
    const r = importJavaScript('let = = 3;');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.state).toBeUndefined();
  });
});
