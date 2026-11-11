import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64Encode,
  convertBase,
  convertCase,
  dateToTimestamp,
  decodeJwt,
  describeColor,
  diffLines,
  generateUuids,
  hashHex,
  hslToRgb,
  jsonFormat,
  jsonMinify,
  jsonValidate,
  parseColor,
  rgbToHsl,
  runRegex,
  splitWords,
  textStats,
  timestampToDate,
  urlDecode,
  urlEncode,
  type CaseStyle,
} from '../src/panels/tools/logic';

const val = <T>(r: { ok: boolean; value?: T }): T => {
  expect(r.ok).toBe(true);
  return r.value as T;
};

const b64url = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('json', () => {
  it('formats with 2 spaces', () => {
    expect(val(jsonFormat('{"a":[1,2],"b":{"c":null}}'))).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": null\n  }\n}');
  });
  it('minifies', () => {
    expect(val(jsonMinify('{\n "a": [1, 2],\n "b": "x y"\n}'))).toBe('{"a":[1,2],"b":"x y"}');
  });
  it('validates', () => {
    expect(jsonValidate('[1,2,3]').ok).toBe(true);
  });
  it('reports a readable error with position', () => {
    const r = jsonValidate('{\n  "a": 1,\n  "b": }');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('json');
      expect(r.position).toBeTypeOf('number');
      expect(r.params?.line).toBe(3);
      expect(String(r.params?.detail)).toMatch(/line 3/);
    }
  });
  it('rejects empty input', () => {
    const r = jsonFormat('   ');
    expect(r.ok ? '' : r.code).toBe('empty');
  });
});

describe('base64', () => {
  it('encodes ascii', () => {
    expect(base64Encode('hello')).toBe('aGVsbG8=');
  });
  it('round-trips Korean, Japanese and emoji', () => {
    for (const s of ['안녕하세요 こんにちは', 'emoji \u{1F600}\u{1F680} ok', '']) {
      expect(val(base64Decode(base64Encode(s)))).toBe(s);
    }
  });
  it('matches Node for UTF-8', () => {
    const s = '안녕하세요 こんにちは';
    expect(base64Encode(s)).toBe(Buffer.from(s, 'utf8').toString('base64'));
  });
  it('decodes url-safe and unpadded input', () => {
    expect(val(base64Decode('aGVsbG8'))).toBe('hello');
    expect(val(base64Decode(Buffer.from('??>>', 'utf8').toString('base64url')))).toBe('??>>');
  });
  it('errors on garbage and invalid UTF-8', () => {
    const bad = base64Decode('@@@');
    expect(bad.ok ? '' : bad.code).toBe('base64');
    const notUtf8 = base64Decode(Buffer.from([0xff, 0xfe]).toString('base64'));
    expect(notUtf8.ok ? '' : notUtf8.code).toBe('base64utf8');
  });
});

describe('url', () => {
  it('encodes and decodes', () => {
    expect(val(urlEncode('a b&c=한'))).toBe('a%20b%26c%3D%ED%95%9C');
    expect(val(urlDecode('a%20b%26c%3D%ED%95%9C'))).toBe('a b&c=한');
  });
  it('reports malformed input', () => {
    const r = urlDecode('%E0%A4%A');
    expect(r.ok ? '' : r.code).toBe('urlDecode');
    const lone = urlEncode('\ud800');
    expect(lone.ok ? '' : lone.code).toBe('urlEncode');
  });
});

describe('hash', () => {
  it('sha256 of abc', async () => {
    expect(await hashHex('SHA-256', 'abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('sha1 of abc', async () => {
    expect(await hashHex('SHA-1', 'abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
  it('sha384 and sha512 have the right length', async () => {
    expect(await hashHex('SHA-384', 'abc')).toHaveLength(96);
    expect(await hashHex('SHA-512', 'abc')).toHaveLength(128);
  });
  it('hashes UTF-8 bytes', async () => {
    expect(await hashHex('SHA-256', '한')).toBe((await import('node:crypto')).createHash('sha256').update('한', 'utf8').digest('hex'));
  });
});

describe('uuid', () => {
  it('generates the requested number of v4 uuids', () => {
    const ids = generateUuids(10);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('clamps to 1..50', () => {
    expect(generateUuids(0)).toHaveLength(1);
    expect(generateUuids(500)).toHaveLength(50);
    expect(generateUuids(Number.NaN)).toHaveLength(1);
  });
});

describe('number base', () => {
  it('converts from decimal', () => {
    expect(val(convertBase('255', 10))).toEqual({ bin: '11111111', oct: '377', dec: '255', hex: 'ff' });
  });
  it('converts from hex with prefix', () => {
    expect(val(convertBase('0xFF', 16)).dec).toBe('255');
  });
  it('converts from binary and octal', () => {
    expect(val(convertBase('1010', 2)).dec).toBe('10');
    expect(val(convertBase('0o17', 8)).dec).toBe('15');
  });
  it('handles negatives', () => {
    expect(val(convertBase('-255', 10))).toEqual({ bin: '-11111111', oct: '-377', dec: '-255', hex: '-ff' });
    expect(val(convertBase('-ff', 16)).dec).toBe('-255');
  });
  it('handles values beyond 64 bits', () => {
    const r = val(convertBase('ffffffffffffffffffffffffffffffff', 16));
    expect(r.dec).toBe('340282366920938463463374607431768211455');
    expect(r.bin).toBe('1'.repeat(128));
    expect(val(convertBase('18446744073709551616', 10)).hex).toBe('10000000000000000');
  });
  it('reports invalid digits', () => {
    const r = convertBase('102', 2);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('digit');
      expect(r.params).toEqual({ digit: '2', radix: 2 });
    }
    expect(convertBase('12g', 16).ok).toBe(false);
    expect(convertBase('1.5', 10).ok).toBe(false);
  });
  it('rejects empty input', () => {
    expect(convertBase('', 10).ok).toBe(false);
    expect(convertBase('-', 10).ok).toBe(false);
  });
});

describe('timestamp', () => {
  it('converts seconds', () => {
    const r = val(timestampToDate('1700000000'));
    expect(r.unit).toBe('seconds');
    expect(r.iso).toBe('2023-11-14T22:13:20.000Z');
    expect(r.seconds).toBe(1700000000);
    expect(r.ms).toBe(1700000000000);
    expect(r.local).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}$/);
  });
  it('detects milliseconds', () => {
    const r = val(timestampToDate('1700000000123'));
    expect(r.unit).toBe('milliseconds');
    expect(r.iso).toBe('2023-11-14T22:13:20.123Z');
  });
  it('supports negative and zero', () => {
    expect(val(timestampToDate('0')).iso).toBe('1970-01-01T00:00:00.000Z');
    expect(val(timestampToDate('-86400')).iso).toBe('1969-12-31T00:00:00.000Z');
  });
  it('rejects non numbers and out of range', () => {
    expect(timestampToDate('abc').ok).toBe(false);
    expect(timestampToDate('99999999999999999999').ok).toBe(false);
  });
  it('converts a date string back', () => {
    const r = val(dateToTimestamp('2023-11-14T22:13:20Z'));
    expect(r.seconds).toBe(1700000000);
    expect(r.ms).toBe(1700000000000);
    expect(r.iso).toBe('2023-11-14T22:13:20.000Z');
    expect(dateToTimestamp('not a date').ok).toBe(false);
  });
});

describe('regex', () => {
  it('lists matches with index and groups', () => {
    const r = val(runRegex('(\\w+)@(\\w+)\\.com', 'g', 'a@b.com, cc@dd.com'));
    expect(r.matches).toHaveLength(2);
    expect(r.matches[0]).toMatchObject({ index: 0, text: 'a@b.com', groups: ['a', 'b'] });
    expect(r.matches[1]).toMatchObject({ index: 9, groups: ['cc', 'dd'] });
  });
  it('supports named groups and optional unmatched groups', () => {
    const r = val(runRegex('(?<y>\\d{4})(-)?(x)?', 'g', '2024'));
    expect(r.matches[0].named.y).toBe('2024');
    expect(r.matches[0].groups).toEqual(['2024', undefined, undefined]);
  });
  it('adds the g flag when missing', () => {
    expect(val(runRegex('a', '', 'aaa')).matches).toHaveLength(3);
  });
  it('reports invalid patterns and flags', () => {
    const r = runRegex('(', 'g', 'x');
    expect(r.ok ? '' : r.code).toBe('regex');
    expect(runRegex('a', 'zz', 'x').ok).toBe(false);
  });
  it('does not loop forever on zero-length matches', () => {
    const r = val(runRegex('x*', 'g', 'abc'));
    expect(r.matches.map((m) => m.index)).toEqual([0, 1, 2, 3]);
    expect(val(runRegex('', 'g', 'ab')).matches).toHaveLength(3);
    expect(val(runRegex('(?:)', 'gu', '\u{1F600}a')).matches.map((m) => m.index)).toEqual([0, 2, 3]);
  });
  it('truncates at the limit', () => {
    const r = val(runRegex('a', 'g', 'a'.repeat(1000), 10));
    expect(r.matches).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });
});

describe('colour', () => {
  it('parses every accepted syntax', () => {
    expect(val(parseColor('#f00'))).toEqual({ r: 255, g: 0, b: 0 });
    expect(val(parseColor('#336699'))).toEqual({ r: 51, g: 102, b: 153 });
    expect(val(parseColor('rgb(51, 102, 153)'))).toEqual({ r: 51, g: 102, b: 153 });
    expect(val(parseColor('RGB(51 102 153)'))).toEqual({ r: 51, g: 102, b: 153 });
    expect(val(parseColor('hsl(210, 50%, 40%)'))).toEqual({ r: 51, g: 102, b: 153 });
  });
  it('rejects bad input', () => {
    expect(parseColor('#ggg').ok).toBe(false);
    expect(parseColor('rgb(300, 0, 0)').ok).toBe(false);
    expect(parseColor('hsl(10, 120%, 50%)').ok).toBe(false);
    expect(parseColor('banana').ok).toBe(false);
    expect(parseColor('').ok).toBe(false);
  });
  it('describes in all formats', () => {
    const c = val(describeColor('#336699'));
    expect(c.hex).toBe('#336699');
    expect(c.rgbText).toBe('rgb(51, 102, 153)');
    expect(c.hslText).toBe('hsl(210, 50%, 40%)');
    expect(val(describeColor('#fff')).hslText).toBe('hsl(0, 0%, 100%)');
    expect(val(describeColor('hsl(120, 100%, 50%)')).hex).toBe('#00ff00');
  });
  it('round-trips rgb through hsl', () => {
    for (const rgb of [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 0, b: 0 },
      { r: 12, g: 200, b: 99 },
      { r: 250, g: 128, b: 114 },
      { r: 1, g: 2, b: 3 },
    ]) {
      expect(hslToRgb(rgbToHsl(rgb))).toEqual(rgb);
    }
  });
});

describe('diff', () => {
  it('marks added and removed lines', () => {
    const r = val(diffLines('a\nb\nc', 'a\nc\nd'));
    expect(r).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });
  it('reports identical texts as unchanged', () => {
    expect(val(diffLines('x\ny', 'x\ny')).every((l) => l.kind === 'same')).toBe(true);
  });
  it('handles empty sides and CRLF', () => {
    expect(val(diffLines('', 'a\nb')).map((l) => l.kind)).toEqual(['add', 'add']);
    expect(val(diffLines('a\r\nb', '')).map((l) => l.kind)).toEqual(['del', 'del']);
    expect(val(diffLines('a\r\nb', 'a\nb')).every((l) => l.kind === 'same')).toBe(true);
  });
  it('is a valid edit script', () => {
    const a = 'one\ntwo\nthree\nfour\nfive';
    const b = 'one\nthree\nfour\nsix\nfive\nseven';
    const r = val(diffLines(a, b));
    expect(r.filter((l) => l.kind !== 'add').map((l) => l.text).join('\n')).toBe(a);
    expect(r.filter((l) => l.kind !== 'del').map((l) => l.text).join('\n')).toBe(b);
  });
});

describe('case', () => {
  const cases: [CaseStyle, string][] = [
    ['camel', 'helloWorldFooBar'],
    ['pascal', 'HelloWorldFooBar'],
    ['snake', 'hello_world_foo_bar'],
    ['kebab', 'hello-world-foo-bar'],
    ['upperSnake', 'HELLO_WORLD_FOO_BAR'],
    ['lower', 'hello world foo_bar'],
    ['upper', 'HELLO WORLD FOO_BAR'],
    ['title', 'Hello World Foo_Bar'],
  ];
  for (const [style, expected] of cases) {
    it(style, () => {
      expect(convertCase('hello World foo_bar', style)).toBe(expected);
    });
  }
  it('splits existing identifiers', () => {
    expect(splitWords('parseHTTPResponse-v2 my_var')).toEqual(['parse', 'HTTP', 'Response', 'v2', 'my', 'var']);
    expect(convertCase('parseHTTPResponse', 'snake')).toBe('parse_http_response');
    expect(convertCase('some-kebab-name', 'camel')).toBe('someKebabName');
  });
  it('works per line', () => {
    expect(convertCase('a b\nc d', 'snake')).toBe('a_b\nc_d');
  });
});

describe('jwt', () => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: '1234', name: '안녕', iat: 1700000000, exp: 1700003600, nbf: 1699999999 };
  const token = `${b64url(header)}.${b64url(payload)}.c2ln`;
  it('decodes header and payload', () => {
    const r = val(decodeJwt(token, 1700000100_000));
    expect(r.header).toEqual(header);
    expect(r.payload).toEqual(payload);
    expect(r.headerText).toBe(JSON.stringify(header, null, 2));
    expect(r.payloadText).toContain('"name": "안녕"');
    expect(r.alg).toBe('HS256');
    expect(r.signature).toBe('c2ln');
    expect(r.verified).toBe(false);
    expect(r.expired).toBe(false);
  });
  it('shows exp, iat and nbf as dates', () => {
    const r = val(decodeJwt(token, 0));
    expect(r.claims.map((c) => c.name)).toEqual(['exp', 'iat', 'nbf']);
    expect(r.claims.find((c) => c.name === 'exp')?.iso).toBe('2023-11-14T23:13:20.000Z');
    expect(r.claims.find((c) => c.name === 'iat')?.iso).toBe('2023-11-14T22:13:20.000Z');
  });
  it('flags expiry', () => {
    expect(val(decodeJwt(token, 1700003601_000)).expired).toBe(true);
  });
  it('accepts an empty signature', () => {
    expect(val(decodeJwt(`${b64url(header)}.${b64url({ a: 1 })}.`)).signature).toBe('');
  });
  it('rejects malformed tokens', () => {
    const a = decodeJwt('abc');
    expect(a.ok ? '' : a.code).toBe('jwtFormat');
    const b = decodeJwt('@@.@@.x');
    expect(b.ok ? '' : b.code).toBe('jwtPart');
    expect(b.ok ? '' : b.params?.part).toBe('header');
    const c = decodeJwt(`${b64url(header)}.${Buffer.from('not json').toString('base64url')}.x`);
    expect(c.ok ? '' : c.params?.part).toBe('payload');
    expect(decodeJwt(`${b64url([1])}.${b64url({})}.x`).ok).toBe(false);
    expect(decodeJwt('').ok).toBe(false);
  });
});

describe('text statistics', () => {
  it('counts code points, bytes, words and lines', () => {
    expect(textStats('hello world\nsecond line')).toEqual({ chars: 23, bytes: 23, words: 4, lines: 2 });
  });
  it('counts multibyte text correctly', () => {
    const s = textStats('안녕 \u{1F600}');
    expect(s.chars).toBe(4);
    expect(s.bytes).toBe(6 + 1 + 4);
    expect(s.words).toBe(2);
  });
  it('handles empty text', () => {
    expect(textStats('')).toEqual({ chars: 0, bytes: 0, words: 0, lines: 0 });
    expect(textStats('   ').words).toBe(0);
  });
  it('handles CRLF', () => {
    expect(textStats('a\r\nb\r\nc').lines).toBe(3);
  });
});
