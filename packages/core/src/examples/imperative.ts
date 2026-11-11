import * as b from '../blocks/dsl';
import type { WorkspaceState } from '../blocks/state';

export interface Example {
  id: string;
  /** English title; the app localises by id. */
  title: string;
  description: string;
  build: () => WorkspaceState;
  /** Expected standard output when run, identical across languages. */
  expected?: string;
  stdin?: string;
}

const v = b.getv;
const n = b.num;
const t = b.text;
const lines = (...l: (string | number)[]) => l.join('\n') + '\n';

export const IMPERATIVE_EXAMPLES: Example[] = [
  {
    id: 'hello',
    title: 'Hello, World',
    description: 'Print a line of text.',
    build: () => b.workspace(b.start(b.print(t('Hello, World!')))),
    expected: lines('Hello, World!'),
  },
  {
    id: 'arithmetic',
    title: 'Arithmetic',
    description: 'Variables and operator precedence.',
    build: () =>
      b.workspace(
        b.start(
          b.setv('x', n(7)),
          b.setv('y', n(3)),
          b.print(b.add(v('x'), v('y'))),
          b.print(b.sub(v('x'), v('y'))),
          b.print(b.mul(v('x'), v('y'))),
          b.print(b.mod(v('x'), v('y'))),
          b.print(b.add(b.mul(v('x'), n(2)), n(1))),
          b.print(b.mul(b.add(v('x'), v('y')), n(2))),
          b.print(b.sub(v('x'), b.sub(v('y'), n(1)))),
          b.print(b.neg(v('x'))),
        ),
      ),
    expected: lines(10, 4, 21, 1, 15, 20, 5, -7),
  },
  {
    id: 'sum',
    title: 'Sum 1 to 100',
    description: 'A counting loop that accumulates a total.',
    build: () => b.workspace(b.start(b.setv('total', n(0)), b.count('i', 1, 100, [b.change('total', v('i'))]), b.print(v('total')))),
    expected: lines(5050),
  },
  {
    id: 'fizzbuzz',
    title: 'FizzBuzz',
    description: 'Conditions with else-if branches.',
    build: () =>
      b.workspace(
        b.start(
          b.count('i', 1, 15, [
            b.ifs(
              [
                [b.cmp('EQ', b.mod(v('i'), n(15)), n(0)), [b.print(t('FizzBuzz'))]],
                [b.cmp('EQ', b.mod(v('i'), n(3)), n(0)), [b.print(t('Fizz'))]],
                [b.cmp('EQ', b.mod(v('i'), n(5)), n(0)), [b.print(t('Buzz'))]],
              ],
              [b.print(v('i'))],
            ),
          ]),
        ),
      ),
    expected: lines(1, 2, 'Fizz', 4, 'Buzz', 'Fizz', 7, 8, 'Fizz', 'Buzz', 11, 'Fizz', 13, 14, 'FizzBuzz'),
  },
  {
    id: 'factorial',
    title: 'Factorial (recursion)',
    description: 'A function that calls itself.',
    build: () =>
      b.workspace(
        b.fnDef('factorial', ['n'], [b.ifReturn(b.cmp('LTE', v('n'), n(1)), n(1))], b.mul(v('n'), b.call('factorial', b.sub(v('n'), n(1))))),
        b.start(b.print(b.call('factorial', n(10)))),
      ),
    expected: lines(3628800),
  },
  {
    id: 'lists',
    title: 'Lists',
    description: 'Create, grow, change and walk a list.',
    build: () =>
      b.workspace(
        b.start(
          b.setv('numbers', b.list(n(3), n(1), n(4), n(1), n(5))),
          b.append(v('numbers'), n(9)),
          b.setItem(v('numbers'), n(0), n(10)),
          b.setv('total', n(0)),
          b.forEach('value', v('numbers'), [b.change('total', v('value'))]),
          b.print(b.len(v('numbers'))),
          b.print(v('total')),
          b.print(b.item(v('numbers'), n(2))),
          b.removeAt(v('numbers'), n(1)),
          b.print(b.len(v('numbers'))),
          b.print(b.item(v('numbers'), n(1))),
        ),
      ),
    expected: lines(6, 30, 4, 5, 4),
  },
  {
    id: 'strings',
    title: 'Text',
    description: 'Join, measure and transform text.',
    build: () =>
      b.workspace(
        b.start(
          b.setv('name', t('World')),
          b.setv('greeting', b.join(t('Hello, '), v('name'), t('!'))),
          b.print(v('greeting')),
          b.print(b.textLen(v('greeting'))),
          b.print(b.strOp('upper', v('name'))),
          b.print(b.strOp('lower', v('name'))),
          b.print(b.strOp('trim', t('  padded  '))),
          b.iff(b.contains(v('greeting'), t('World')), [b.print(t('found'))], [b.print(t('missing'))]),
          b.print(b.join(t('Total: '), n(42))),
          b.setv('copies', n(3)),
          b.print(b.join(v('name'), t(' x'), v('copies'))),
          b.iff(b.cmp('EQ', v('name'), t('World')), [b.print(t('same'))]),
        ),
      ),
    expected: lines('Hello, World!', 13, 'WORLD', 'world', 'padded', 'found', 'Total: 42', 'World x3', 'same'),
  },
  {
    id: 'while',
    title: 'While loops',
    description: 'Repeat while a condition holds, with break and continue.',
    build: () =>
      b.workspace(
        b.start(
          b.setv('value', n(1)),
          b.whileDo(b.cmp('LT', v('value'), n(100)), [b.setv('value', b.mul(v('value'), n(2)))]),
          b.print(v('value')),
          b.setv('i', n(0)),
          b.whileDo(b.bool(true), [b.change('i', n(1)), b.iff(b.cmp('EQ', b.mod(v('i'), n(2)), n(0)), [b.cont()]), b.iff(b.cmp('GT', v('i'), n(7)), [b.brk()]), b.print(v('i'))]),
          b.until(b.cmp('LTE', v('value'), n(100)), [b.setv('value', b.sub(v('value'), n(20)))]),
          b.print(v('value')),
        ),
      ),
    expected: lines(128, 1, 3, 5, 7, 88),
  },
  {
    id: 'logic',
    title: 'Logic',
    description: 'and, or, not and the conditional expression.',
    build: () =>
      b.workspace(
        b.start(
          b.setv('a', n(5)),
          b.setv('b', n(10)),
          b.iff(b.and(b.cmp('LT', v('a'), v('b')), b.cmp('GT', v('b'), n(0))), [b.print(t('both'))]),
          b.iff(b.or(b.cmp('GT', v('a'), v('b')), b.cmp('EQ', v('a'), n(5))), [b.print(t('either'))]),
          b.iff(b.not(b.cmp('EQ', v('a'), v('b'))), [b.print(t('different'))]),
          b.print(b.ternary(b.cmp('GT', v('a'), v('b')), t('a is larger'), t('b is larger'))),
          b.setv('ready', b.bool(true)),
          b.iff(b.and(v('ready'), b.not(b.cmp('GTE', v('a'), v('b')))), [b.print(t('ready'))]),
        ),
      ),
    expected: lines('both', 'either', 'different', 'b is larger', 'ready'),
  },
  {
    id: 'decimals',
    title: 'Decimal numbers',
    description: 'Division always produces a decimal number.',
    build: () =>
      b.workspace(
        b.start(
          b.setv('average', b.div(b.add(n(3), n(4)), n(2))),
          b.print(v('average')),
          b.setv('half', b.mul(n(0.5), n(5))),
          b.print(v('half')),
          b.print(b.sub(v('average'), n(0.25))),
          b.setv('count', n(3)),
          b.print(b.mul(v('count'), n(1.5))),
          b.print(b.div(v('count'), n(2))),
        ),
      ),
    expected: lines(3.5, 2.5, 3.25, 4.5, 1.5),
  },
  {
    id: 'countdown',
    title: 'Counting down and stepping',
    description: 'Counting loops that go backwards or skip.',
    build: () => b.workspace(b.start(b.forRange('i', n(5), n(1), n(1), [b.print(v('i'))]), b.forRange('j', n(0), n(10), n(5), [b.print(v('j'))]))),
    expected: lines(5, 4, 3, 2, 1, 0, 5, 10),
  },
  {
    id: 'functions',
    title: 'Functions',
    description: 'Parameters, return values and procedures.',
    build: () =>
      b.workspace(
        b.fnDef('greet', ['who'], [], b.join(t('Hi, '), v('who'))),
        b.fnDef('square', ['side'], [], b.mul(v('side'), v('side'))),
        b.fnDef('show', ['label', 'amount'], [b.print(b.join(v('label'), t(': '), v('amount')))]),
        b.start(b.print(b.call('greet', t('Ada'))), b.print(b.call('square', n(6))), b.callStmt('show', t('Area'), b.call('square', n(3)))),
      ),
    expected: lines('Hi, Ada', 36, 'Area: 9'),
  },
  {
    id: 'nested',
    title: 'Nested loops',
    description: 'A small multiplication table.',
    build: () =>
      b.workspace(b.start(b.count('row', 1, 3, [b.count('col', 1, 3, [b.print(b.join(v('row'), t(' x '), v('col'), t(' = '), b.mul(v('row'), v('col'))))])]), b.repeat(n(2), [b.print(t('again'))]))),
    expected: lines('1 x 1 = 1', '1 x 2 = 2', '1 x 3 = 3', '2 x 1 = 2', '2 x 2 = 4', '2 x 3 = 6', '3 x 1 = 3', '3 x 2 = 6', '3 x 3 = 9', 'again', 'again'),
  },
  {
    id: 'globals',
    title: 'Shared variables',
    description: 'A variable used by both the main program and a function.',
    build: () => b.workspace(b.fnDef('bump', [], [b.change('counter', n(1))]), b.start(b.setv('counter', n(0)), b.callStmt('bump'), b.callStmt('bump'), b.callStmt('bump'), b.print(v('counter')))),
    expected: lines(3),
  },
  {
    id: 'typed',
    title: 'Typed declarations and constants',
    description: 'Explicit types and values that cannot change.',
    build: () =>
      b.workspace(
        b.start(
          b.declare('LIMIT', 'int', n(3), true),
          b.declare('ratio', 'float', n(2)),
          b.print(b.mul(v('ratio'), n(1.25))),
          b.forRange('step', n(1), v('LIMIT'), n(1), [b.print(v('step'))]),
          b.declare('label', 'string', t('done')),
          b.print(v('label')),
        ),
      ),
    expected: lines(2.5, 1, 2, 3, 'done'),
  },
  {
    id: 'convert',
    title: 'Type conversion',
    description: 'Turn text into numbers and back.',
    build: () =>
      b.workspace(
        b.start(
          b.setv('raw', t('42')),
          b.setv('amount', b.convert(v('raw'), 'int')),
          b.print(b.add(v('amount'), n(1))),
          b.print(b.join(t('amount='), b.convert(v('amount'), 'string'))),
          b.setv('price', b.convert(t('2.5'), 'float')),
          b.print(b.add(v('price'), n(0.25))),
          b.print(b.convert(n(7.9), 'int')),
        ),
      ),
    expected: lines(43, 'amount=42', 2.75, 7),
  },
  {
    id: 'math',
    title: 'Math functions',
    description: 'Absolute value, rounding, roots and powers.',
    build: () =>
      b.workspace(
        b.start(
          b.print(b.mathFn('ABS', n(-7))),
          b.print(b.minmax('max', n(3), n(9))),
          b.print(b.minmax('min', n(3), n(9))),
          b.print(b.round('ROUNDDOWN', n(3.7))),
          b.print(b.round('ROUNDUP', n(3.2))),
          b.print(b.round('ROUND', n(2.6))),
          b.print(b.convert(b.mathFn('ROOT', n(16)), 'int')),
          b.print(b.convert(b.pow(n(2), n(10)), 'int')),
        ),
      ),
    expected: lines(7, 9, 3, 3, 4, 3, 4, 1024),
  },
  {
    id: 'input',
    title: 'Asking for input',
    description: 'Read text and a number from the user.',
    build: () => b.workspace(b.start(b.setv('name', b.ask('Name? ')), b.print(b.join(t('Hello, '), v('name'))), b.setv('age', b.ask('Age? ', true)), b.print(b.add(v('age'), n(0.5))))),
    stdin: 'Ada\n20\n',
    expected: 'Name? Hello, Ada\nAge? 20.5\n',
  },
  {
    id: 'dictionary',
    title: 'Dictionaries',
    description: 'Store and look up values by key.',
    build: () =>
      b.workspace(
        b.start(
          b.setv('ages', b.dict()),
          b.dictSet(v('ages'), t('ada'), n(36)),
          b.dictSet(v('ages'), t('alan'), n(41)),
          b.print(b.dictGet(v('ages'), t('ada'))),
          b.iff(b.dictHas(v('ages'), t('alan')), [b.print(t('has alan'))]),
          b.dictDelete(v('ages'), t('alan')),
          b.iff(b.not(b.dictHas(v('ages'), t('alan'))), [b.print(t('removed'))]),
        ),
      ),
    expected: lines(36, 'has alan', 'removed'),
  },
  {
    id: 'exceptions',
    title: 'Errors',
    description: 'Raise an error and handle it.',
    build: () => b.workspace(b.start(b.tryCatch([b.print(t('before')), b.iff(b.cmp('GT', b.textLen(t('boom')), n(0)), [b.raise(t('boom'))]), b.print(t('skipped'))], 'problem', [b.print(b.join(t('caught: '), v('problem')))]), b.print(t('after')))),
    expected: lines('before', 'caught: boom', 'after'),
  },
  {
    id: 'structs',
    title: 'Structs',
    description: 'Group related values into one record.',
    build: () =>
      b.workspace(
        b.structDef('Point', [['x', 'int'], ['y', 'int']]),
        b.start(b.setv('p', b.create('Point', n(3), n(4))), b.print(b.add(b.field(v('p'), 'x'), b.field(v('p'), 'y'))), b.setField(v('p'), 'x', n(10)), b.print(b.field(v('p'), 'x'))),
      ),
    expected: lines(7, 10),
  },
  {
    id: 'classes',
    title: 'Classes',
    description: 'Objects with fields and methods.',
    build: () =>
      b.workspace(
        b.classDef(
          'Counter',
          [['count', 'int']],
          [
            b.method('increment', 'amount:int', 'void', [b.setField(b.self(), 'count', b.add(b.field(b.self(), 'count'), v('amount')))]),
            b.method('doubled', '', 'int', [b.ret(b.mul(b.field(b.self(), 'count'), n(2)))]),
          ],
        ),
        b.start(b.setv('c', b.create('Counter', n(1))), b.callMethodStmt(v('c'), 'increment', n(4)), b.print(b.field(v('c'), 'count')), b.print(b.callMethod(v('c'), 'doubled'))),
      ),
    expected: lines(5, 10),
  },
];
