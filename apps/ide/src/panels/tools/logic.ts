/** Pure developer-utility logic for the Tools panel. No DOM, no React. */

export interface Ok<T> {
  ok: true;
  value: T;
}
export interface Err {
  ok: false;
  /** Maps to the i18n key `tools.err.<code>`. */
  code: string;
  params?: Record<string, string | number>;
  position?: number;
}
export type Result<T> = Ok<T> | Err;

const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = (code: string, params?: Record<string, string | number>, position?: number): Err => ({ ok: false, code, params, position });

/* ------------------------------------------------------------------ JSON */

function lineColumn(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, position);
  const line = before.split('\n').length;
  return { line, column: position - (before.lastIndexOf('\n') + 1) + 1 };
}

/** Some engines omit the position for "Unexpected token" errors; find it by bisecting prefixes. */
function locateTokenError(text: string, message: string): number | undefined {
  if (!message.startsWith('Unexpected token')) return undefined;
  const fails = (n: number): boolean => {
    try {
      JSON.parse(text.slice(0, n));
      return false;
    } catch (e) {
      return e instanceof Error && e.message.startsWith('Unexpected token');
    }
  };
  let lo = 1;
  let hi = text.length;
  if (!fails(hi)) return undefined;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fails(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo - 1;
}

function parseJson(text: string): Result<unknown> {
  if (text.trim() === '') return err('empty');
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const m = /position (\d+)/.exec(message);
    const position = m ? Number(m[1]) : locateTokenError(text, message);
    if (position === undefined) return err('json', { detail: message });
    const { line, column } = lineColumn(text, position);
    const detail = /line \d+/.test(message) ? message : `${message} (line ${line}, column ${column})`;
    return err('json', { detail, line, column }, position);
  }
}

export function jsonFormat(text: string): Result<string> {
  const r = parseJson(text);
  return r.ok ? ok(JSON.stringify(r.value, null, 2)) : r;
}

export function jsonMinify(text: string): Result<string> {
  const r = parseJson(text);
  return r.ok ? ok(JSON.stringify(r.value)) : r;
}

export function jsonValidate(text: string): Result<true> {
  const r = parseJson(text);
  return r.ok ? ok(true) : r;
}

/* ---------------------------------------------------------------- Base64 */

function bytesToBinary(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}

export function base64Encode(text: string): string {
  return btoa(bytesToBinary(new TextEncoder().encode(text)));
}

export function base64ToBytes(input: string): Result<Uint8Array> {
  const clean = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.replace(/=+$/, '').length % 4 === 1) return err('base64');
  const unpadded = clean.replace(/=+$/, '');
  const padded = unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return ok(bytes);
  } catch {
    return err('base64');
  }
}

export function base64Decode(input: string): Result<string> {
  const r = base64ToBytes(input);
  if (!r.ok) return r;
  try {
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(r.value));
  } catch {
    return err('base64utf8');
  }
}

/* ------------------------------------------------------------------- URL */

export function urlEncode(text: string): Result<string> {
  try {
    return ok(encodeURIComponent(text));
  } catch {
    return err('urlEncode');
  }
}

export function urlDecode(text: string): Result<string> {
  try {
    return ok(decodeURIComponent(text));
  } catch {
    return err('urlDecode');
  }
}

/* ------------------------------------------------------------------ Hash */

export type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export const HASH_ALGORITHMS: readonly HashAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

export async function hashHex(algorithm: HashAlgorithm, text: string): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ UUID */

export function generateUuids(count: number): string[] {
  const n = Math.min(50, Math.max(1, Math.trunc(Number.isFinite(count) ? count : 1)));
  return Array.from({ length: n }, () => crypto.randomUUID());
}

/* ----------------------------------------------------------- Number base */

export type Radix = 2 | 8 | 10 | 16;
export const RADIXES: readonly Radix[] = [2, 8, 10, 16];

export interface BaseConversion {
  bin: string;
  oct: string;
  dec: string;
  hex: string;
}

export function parseBigInt(input: string, radix: Radix): Result<bigint> {
  let s = input.trim().replace(/[\s_]/g, '');
  let negative = false;
  if (s.startsWith('-') || s.startsWith('+')) {
    negative = s[0] === '-';
    s = s.slice(1);
  }
  const prefix = { 2: /^0b/i, 8: /^0o/i, 10: null, 16: /^0x/i }[radix];
  if (prefix) s = s.replace(prefix, '');
  if (s === '') return err('empty');
  const big = BigInt(radix);
  let value = 0n;
  for (const ch of s) {
    const digit = parseInt(ch, 36);
    if (!/^[0-9a-zA-Z]$/.test(ch) || digit >= radix) return err('digit', { digit: ch, radix });
    value = value * big + BigInt(digit);
  }
  return ok(negative ? -value : value);
}

export function convertBase(input: string, radix: Radix): Result<BaseConversion> {
  const r = parseBigInt(input, radix);
  if (!r.ok) return r;
  const v = r.value;
  return ok({ bin: v.toString(2), oct: v.toString(8), dec: v.toString(10), hex: v.toString(16) });
}

/* ------------------------------------------------------------- Timestamp */

export interface Stamp {
  seconds: number;
  ms: number;
  iso: string;
  local: string;
}
export interface TimestampResult extends Stamp {
  unit: 'seconds' | 'milliseconds';
}

const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, '0');

export function formatLocal(d: Date): string {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const date = `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  return `${date} ${time} ${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

function describeMs(ms: number): Result<Stamp> {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return err('timestampRange');
  return ok({ seconds: Math.floor(ms / 1000), ms, iso: d.toISOString(), local: formatLocal(d) });
}

/** Values with magnitude >= 1e11 are treated as milliseconds, smaller ones as seconds. */
export function timestampToDate(input: string): Result<TimestampResult> {
  const s = input.trim();
  if (s === '') return err('empty');
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return err('timestamp');
  const n = Number(s);
  const unit = Math.abs(n) >= 1e11 ? 'milliseconds' : 'seconds';
  const r = describeMs(Math.round(unit === 'milliseconds' ? n : n * 1000));
  return r.ok ? ok({ ...r.value, unit }) : r;
}

export function dateToTimestamp(input: string): Result<Stamp> {
  const s = input.trim();
  if (s === '') return err('empty');
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return err('date');
  return describeMs(ms);
}

/* ----------------------------------------------------------------- Regex */

export interface RegexMatch {
  index: number;
  text: string;
  groups: (string | undefined)[];
  named: Record<string, string | undefined>;
}
export interface RegexRun {
  matches: RegexMatch[];
  truncated: boolean;
}

export const REGEX_MATCH_LIMIT = 500;

export function runRegex(pattern: string, flags: string, text: string, limit = REGEX_MATCH_LIMIT): Result<RegexRun> {
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  } catch (e) {
    return err('regex', { detail: e instanceof Error ? e.message : String(e) });
  }
  const unicode = re.unicode || re.flags.includes('v');
  const matches: RegexMatch[] = [];
  let truncated = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    matches.push({ index: m.index, text: m[0], groups: m.slice(1), named: { ...(m.groups ?? {}) } });
    if (m[0] === '') {
      const cp = unicode ? text.codePointAt(re.lastIndex) : undefined;
      re.lastIndex += cp !== undefined && cp > 0xffff ? 2 : 1;
      if (re.lastIndex > text.length) break;
    }
  }
  return ok({ matches, truncated });
}

/* ---------------------------------------------------------------- Colour */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d + 6) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r1, g1, b1] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = ln - c / 2;
  const to = (v: number): number => Math.round((v + m) * 255);
  return { r: to(r1), g: to(g1), b: to(b1) };
}

const SEP = String.raw`(?:\s*,\s*|\s+)`;
const RGB_RE = new RegExp(String.raw`^rgb\(\s*(\d{1,3})${SEP}(\d{1,3})${SEP}(\d{1,3})\s*\)$`);
const HSL_RE = new RegExp(String.raw`^hsl\(\s*(-?\d+(?:\.\d+)?)(?:deg)?${SEP}(\d+(?:\.\d+)?)%${SEP}(\d+(?:\.\d+)?)%\s*\)$`);

export function parseColor(input: string): Result<Rgb> {
  const s = input.trim().toLowerCase();
  if (s === '') return err('empty');
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return ok({ r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) });
  }
  m = RGB_RE.exec(s);
  if (m) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return r > 255 || g > 255 || b > 255 ? err('colorRange') : ok({ r, g, b });
  }
  m = HSL_RE.exec(s);
  if (m) {
    const [h, sat, l] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return sat > 100 || l > 100 ? err('colorRange') : ok(hslToRgb({ h, s: sat, l }));
  }
  return err('color');
}

export interface ColorInfo {
  rgb: Rgb;
  hex: string;
  rgbText: string;
  hslText: string;
}

export function describeColor(input: string): Result<ColorInfo> {
  const r = parseColor(input);
  if (!r.ok) return r;
  const { r: rr, g, b } = r.value;
  const hsl = rgbToHsl(r.value);
  const hex = '#' + [rr, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return ok({
    rgb: r.value,
    hex,
    rgbText: `rgb(${rr}, ${g}, ${b})`,
    hslText: `hsl(${Math.round(hsl.h) % 360}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`,
  });
}

/* ------------------------------------------------------------- Text diff */

export type DiffKind = 'same' | 'add' | 'del';
export interface DiffLine {
  kind: DiffKind;
  text: string;
}

const splitLines = (t: string): string[] => (t === '' ? [] : t.split(/\r?\n/));
export const DIFF_CELL_LIMIT = 4_000_000;

export function diffLines(a: string, b: string): Result<DiffLine[]> {
  const x = splitLines(a);
  const y = splitLines(b);
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const mid1 = x.slice(start, endX);
  const mid2 = y.slice(start, endY);
  const n = mid1.length;
  const m = mid2.length;
  if ((n + 1) * (m + 1) > DIFF_CELL_LIMIT) return err('diffTooLarge');
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = mid1[i] === mid2[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const out: DiffLine[] = x.slice(0, start).map((text) => ({ kind: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && mid1[i] === mid2[j]) {
      out.push({ kind: 'same', text: mid1[i] });
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      out.push({ kind: 'del', text: mid1[i++] });
    } else {
      out.push({ kind: 'add', text: mid2[j++] });
    }
  }
  for (const text of x.slice(endX)) out.push({ kind: 'same', text });
  return ok(out);
}

/* ------------------------------------------------------------------ Case */

export type CaseStyle = 'camel' | 'pascal' | 'snake' | 'kebab' | 'upperSnake' | 'lower' | 'upper' | 'title';
export const CASE_STYLES: readonly CaseStyle[] = ['camel', 'pascal', 'snake', 'kebab', 'upperSnake', 'lower', 'upper', 'title'];

export function splitWords(line: string): string[] {
  return line
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const capitalize = (w: string): string => (w === '' ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

function convertLine(line: string, style: CaseStyle): string {
  switch (style) {
    case 'lower':
      return line.toLowerCase();
    case 'upper':
      return line.toUpperCase();
    case 'title':
      return line.replace(/\p{L}[\p{L}\p{N}']*/gu, capitalize);
    default:
  }
  const words = splitWords(line).map((w) => w.toLowerCase());
  switch (style) {
    case 'camel':
      return words.map((w, i) => (i === 0 ? w : capitalize(w))).join('');
    case 'pascal':
      return words.map(capitalize).join('');
    case 'snake':
      return words.join('_');
    case 'kebab':
      return words.join('-');
    default:
      return words.join('_').toUpperCase();
  }
}

export function convertCase(text: string, style: CaseStyle): string {
  return text
    .split('\n')
    .map((l) => convertLine(l, style))
    .join('\n');
}

/* ------------------------------------------------------------------- JWT */

export interface JwtClaim {
  name: 'exp' | 'iat' | 'nbf';
  value: number;
  iso: string;
  local: string;
}
export interface JwtDecoded {
  header: unknown;
  payload: unknown;
  headerText: string;
  payloadText: string;
  alg: string | undefined;
  claims: JwtClaim[];
  expired: boolean;
  signature: string;
  /** The signature is never verified by this tool. */
  verified: false;
}

function decodePart(part: string, name: string): Result<unknown> {
  const bytes = base64ToBytes(part);
  if (!bytes.ok) return err('jwtPart', { part: name });
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.value));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return err('jwtPart', { part: name });
    return ok(value);
  } catch {
    return err('jwtPart', { part: name });
  }
}

export function decodeJwt(token: string, nowMs: number = Date.now()): Result<JwtDecoded> {
  const t = token.trim();
  if (t === '') return err('empty');
  const parts = t.split('.');
  if (parts.length !== 3) return err('jwtFormat');
  const h = decodePart(parts[0], 'header');
  if (!h.ok) return h;
  const p = decodePart(parts[1], 'payload');
  if (!p.ok) return p;
  const payload = p.value as Record<string, unknown>;
  const header = h.value as Record<string, unknown>;
  const claims: JwtClaim[] = [];
  for (const name of ['exp', 'iat', 'nbf'] as const) {
    const v = payload[name];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const d = new Date(v * 1000);
    if (Number.isNaN(d.getTime())) continue;
    claims.push({ name, value: v, iso: d.toISOString(), local: formatLocal(d) });
  }
  const exp = claims.find((c) => c.name === 'exp');
  return ok({
    header,
    payload,
    headerText: JSON.stringify(header, null, 2),
    payloadText: JSON.stringify(payload, null, 2),
    alg: typeof header.alg === 'string' ? header.alg : undefined,
    claims,
    expired: exp ? exp.value * 1000 < nowMs : false,
    signature: parts[2],
    verified: false,
  });
}

/* ------------------------------------------------------------ Statistics */

export interface TextStats {
  chars: number;
  bytes: number;
  words: number;
  lines: number;
}

export function textStats(text: string): TextStats {
  const trimmed = text.trim();
  return {
    chars: Array.from(text).length,
    bytes: new TextEncoder().encode(text).length,
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    lines: text === '' ? 0 : text.split(/\r\n|\r|\n/).length,
  };
}
