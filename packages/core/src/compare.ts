import { IMPERATIVE_LANGUAGES, LANGUAGES } from './langs';
import type { LanguageId } from './types';

/** How the common block types are spelled in each language. */
export const TYPE_NAMES: Record<string, Partial<Record<LanguageId, string>>> = {
  integer: { python: 'int', javascript: 'number', typescript: 'number', c: 'int', cpp: 'int', java: 'int', csharp: 'int', lua: 'integer', php: 'int', go: 'int', rust: 'i64', dart: 'int', ruby: 'Integer', kotlin: 'Int', bash: 'text (arithmetic)' },
  decimal: { python: 'float', javascript: 'number', typescript: 'number', c: 'double', cpp: 'double', java: 'double', csharp: 'double', lua: 'float', php: 'float', go: 'float64', rust: 'f64', dart: 'double', ruby: 'Float', kotlin: 'Double', bash: 'text (awk)' },
  text: { python: 'str', javascript: 'string', typescript: 'string', c: 'const char *', cpp: 'std::string', java: 'String', csharp: 'string', lua: 'string', php: 'string', go: 'string', rust: 'String', dart: 'String', ruby: 'String', kotlin: 'String', bash: 'text' },
  'true/false': { python: 'bool', javascript: 'boolean', typescript: 'boolean', c: 'bool', cpp: 'bool', java: 'boolean', csharp: 'bool', lua: 'boolean', php: 'bool', go: 'bool', rust: 'bool', dart: 'bool', ruby: 'true / false', kotlin: 'Boolean', bash: 'text "true" / "false"' },
  list: { python: 'list', javascript: 'Array', typescript: 'T[]', c: 'struct with a growing buffer', cpp: 'std::vector<T>', java: 'ArrayList<T>', csharp: 'List<T>', lua: 'table', php: 'array', go: '[]T', rust: 'Vec<T>', dart: 'List<T>', ruby: 'Array', kotlin: 'MutableList<T>', bash: 'indexed array' },
  dictionary: { python: 'dict', javascript: 'object', typescript: 'Record<string, V>', c: 'not available', cpp: 'std::map<K, V>', java: 'HashMap<K, V>', csharp: 'Dictionary<K, V>', lua: 'table', php: 'array', go: 'map[K]V', rust: 'HashMap<K, V>', dart: 'Map<K, V>', ruby: 'Hash', kotlin: 'MutableMap<K, V>', bash: 'associative array (Bash 4+)' },
};

export interface SemanticNote {
  id: string;
  /** Program features that make the note relevant; empty means always. */
  features: string[];
  /** Languages the note is about; undefined means all imperative languages. */
  langs?: LanguageId[];
  /** English text; the app localises by id. */
  text: string;
}

const names = (ids: LanguageId[]) => ids.map((l) => LANGUAGES[l].name).join(', ');

export const SEMANTIC_NOTES: SemanticNote[] = [
  { id: 'typing', features: [], text: `Types are checked before the program runs in ${names(['typescript', 'c', 'cpp', 'java', 'csharp', 'go', 'rust', 'dart', 'kotlin'])}. ${names(['python', 'javascript', 'lua', 'php', 'ruby', 'bash'])} only discover type mistakes while running.` },
  { id: 'intSize', features: [], text: 'Whole numbers have different limits: unlimited in Python and Ruby; 64-bit in Go, Rust, Dart, Lua, PHP and Bash; 32-bit in C, C++, Java, C# and Kotlin; JavaScript and TypeScript use 64-bit decimals that are exact up to 2^53. Large results can overflow in one language and not in another.' },
  { id: 'division', features: [], text: 'The divide block always produces a decimal. Statically typed languages convert the operands first, Ruby uses fdiv, and Bash delegates to awk because its own arithmetic is whole-number only.' },
  { id: 'decimalPrint', features: ['print'], text: 'A decimal with no fraction prints differently: 6.0 in Python, Java, Kotlin, Dart, Lua and Ruby, but 6 in JavaScript, TypeScript, C, C++, C#, Go, Rust, PHP and Bash.' },
  { id: 'boolPrint', features: ['print'], text: 'Printing a true/false value gives True in Python and C#, 1 or nothing in PHP, and true elsewhere. C and C++ print the words through an explicit conversion.' },
  { id: 'modulo', features: [], text: 'The remainder of a negative number follows the sign of the divisor in Python, Ruby and Lua, and the sign of the dividend in the other languages.' },
  { id: 'rounding', features: ['math'], text: 'Rounding a value that ends in .5 goes to the nearest even number in Python, away from zero in C, C++, C#, Go, Rust, Kotlin and Ruby, and upwards in JavaScript, Java, Dart and Lua.' },
  { id: 'listValue', features: ['lists'], text: 'Passing a list to a function shares it in Python, JavaScript, TypeScript, Java, C#, Dart, Kotlin, Ruby, Lua and Go (until it grows). C++, PHP and Rust pass a copy, and C copies the header but shares the items. Bash cannot pass lists to functions.' },
  { id: 'listIndex', features: ['lists'], text: 'Block list positions start at 0. Lua lists start at 1, so the generated Lua code adds 1 to every position.' },
  { id: 'listPrint', features: ['lists', 'print'], text: 'Printing a whole list uses each language\'s own format, for example [1, 2, 3] in Python, [1 2 3] in Go and 1 2 3 in Bash.' },
  { id: 'textLength', features: ['strings'], text: 'Text length counts characters in Python, Ruby, Rust and Bash, UTF-16 units in JavaScript, TypeScript, Java, C#, Kotlin and Dart, and bytes in C, C++, Go, PHP and Lua. The results differ for text outside basic Latin, such as Korean or emoji.' },
  { id: 'textCase', features: ['strings'], text: 'Uppercase and lowercase conversion only handles ASCII letters in C, C++, PHP, Lua and Bash (tr).' },
  { id: 'maps', features: ['maps'], text: 'Dictionaries are not available in C. Go, Rust, Java and others do not keep insertion order; Python, JavaScript, PHP, Ruby and Dart do. Reading a missing key is an error in Python, Rust, Kotlin, Dart, C++ and C#, and yields an empty value elsewhere.' },
  { id: 'errors', features: ['exceptions'], text: 'try/catch maps to exceptions in most languages, to panic and recover in Go and to pcall in Lua. C, Rust and Bash have no equivalent and report the blocks as unsupported.' },
  { id: 'globals', features: ['functions'], text: 'A variable used by both the main program and a function becomes a global. Python needs a global statement, PHP a global declaration, Ruby a $ prefix, and safe Rust does not allow it at all.' },
  { id: 'ternary', features: ['conditions'], langs: ['go', 'lua', 'bash'], text: 'Go has no conditional expression, so the generated helper evaluates both values. Lua uses "and/or", and Bash uses a command substitution.' },
  { id: 'classes', features: ['classes'], text: 'Objects are references in Python, JavaScript, TypeScript, Java, C#, Dart, Kotlin, Ruby, PHP, Lua and Go (pointer receivers). C++ and Rust copy objects on assignment. C and Bash have no classes.' },
  { id: 'structs', features: ['structs'], text: 'Structs are value types in C, C++, C#, Go and Rust: assigning one makes a copy. In the other languages they are ordinary objects that are shared.' },
  { id: 'async', features: ['async'], text: 'await is real in JavaScript, TypeScript, Python (asyncio) and Dart. The other generators run the same steps one after another.' },
  { id: 'sleep', features: ['sleep'], text: 'Waiting pauses the whole program everywhere except JavaScript and TypeScript, where the function becomes asynchronous. Standard Lua has no sleep and keeps the CPU busy.' },
  { id: 'http', features: ['http'], text: 'HTTP requests use each standard library. C, C++, Lua and Rust have none and report the block as unsupported; Bash calls curl.' },
  { id: 'input', features: ['input'], text: 'A number prompt always yields a decimal. Invalid input raises an error in Python, Java, C#, Kotlin and Dart, and silently becomes 0 or NaN in the others.' },
  { id: 'random', features: ['random'], text: 'Random numbers come from generators of very different quality. Rust has none in its standard library, so the generated program includes a small clock-seeded helper.' },
  { id: 'memory', features: ['lists', 'strings'], langs: ['c'], text: 'The generated C code allocates text and lists on the heap and does not free them. That is fine for short programs and wrong for long-running ones.' },
];

/** Notes relevant to a program's features and the languages being compared. */
export function semanticNotes(features: string[], langs: LanguageId[]): SemanticNote[] {
  const has = new Set(features);
  return SEMANTIC_NOTES.filter((n) => n.features.every((f) => has.has(f)) && (!n.langs || n.langs.some((l) => langs.includes(l))));
}

export const COMPARABLE_LANGUAGES = IMPERATIVE_LANGUAGES;
