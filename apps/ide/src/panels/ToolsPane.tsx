import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { t, useLocale } from '../i18n';
import { useUi } from '../state/ui';
import {
  CASE_STYLES,
  HASH_ALGORITHMS,
  RADIXES,
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
  jsonFormat,
  jsonMinify,
  jsonValidate,
  runRegex,
  textStats,
  timestampToDate,
  urlDecode,
  urlEncode,
  type Err,
  type HashAlgorithm,
  type Radix,
  type Result,
} from './tools/logic';

export const TOOL_IDS = [
  'json',
  'base64',
  'url',
  'hash',
  'uuid',
  'base',
  'timestamp',
  'regex',
  'color',
  'diff',
  'case',
  'jwt',
  'stats',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/* ------------------------------------------------------------- shared UI */

function copy(text: string): void {
  void navigator.clipboard.writeText(text).then(
    () => useUi.getState().toast(t('common.copied'), 'ok'),
    () => undefined,
  );
}

function errText(e: Err): string {
  return t(`tools.err.${e.code}`, e.params);
}

function ErrNotice({ r }: { r: Result<unknown> | null }) {
  return r && !r.ok ? <div className="notice err">{errText(r)}</div> : null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function TextIn({ label, value, onChange, rows = 6, placeholder }: { label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <Field label={label}>
      <textarea className="textarea mono" rows={rows} spellCheck={false} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function LineIn({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Field label={label}>
      <input className="input mono" spellCheck={false} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Read-only output textarea with a copy button. */
function TextOut({ label, value, rows = 6 }: { label: string; value: string; rows?: number }) {
  return (
    <Field label={label}>
      <textarea className="textarea mono" rows={rows} spellCheck={false} readOnly value={value} data-testid="tool-output" />
      <div className="row">
        <span className="grow" />
        <button className="btn sm outline" onClick={() => copy(value)} disabled={value === ''}>
          <Icon name="copy" />
          {t('common.copy')}
        </button>
      </div>
    </Field>
  );
}

/** Label chip, value and copy button on one row. */
function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <span className="chip" style={{ minWidth: 64, justifyContent: 'center' }}>
        {label}
      </span>
      <pre className="mono selectable grow" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {value}
      </pre>
      <button className="btn sm icon" title={t('common.copy')} onClick={() => copy(value)}>
        <Icon name="copy" />
      </button>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return (
    <div className="row" style={{ flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

function ClearBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn sm outline" onClick={onClick}>
      <Icon name="trash" />
      {t('common.clear')}
    </button>
  );
}

/* ----------------------------------------------------------------- tools */

function JsonTool() {
  const [text, setText] = useState('');
  const [res, setRes] = useState<Result<string> | null>(null);
  const run = (fn: (s: string) => Result<string>) => setRes(fn(text));
  const validate = () => {
    const r = jsonValidate(text);
    setRes(r.ok ? { ok: true, value: t('tools.json.valid') } : r);
  };
  return (
    <>
      <TextIn label={t('tools.input')} value={text} onChange={setText} rows={8} />
      <Actions>
        <button className="btn sm primary" onClick={() => run(jsonFormat)}>
          {t('tools.json.format')}
        </button>
        <button className="btn sm outline" onClick={() => run(jsonMinify)}>
          {t('tools.json.minify')}
        </button>
        <button className="btn sm outline" onClick={validate}>
          {t('tools.json.validate')}
        </button>
        <ClearBtn
          onClick={() => {
            setText('');
            setRes(null);
          }}
        />
      </Actions>
      <ErrNotice r={res} />
      {res?.ok && <TextOut label={t('tools.output')} value={res.value} rows={8} />}
    </>
  );
}

function CodecTool({ encodeLabel, decodeLabel, encode, decode }: { encodeLabel: string; decodeLabel: string; encode: (s: string) => Result<string>; decode: (s: string) => Result<string> }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<Result<string> | null>(null);
  return (
    <>
      <TextIn label={t('tools.input')} value={text} onChange={setText} />
      <Actions>
        <button className="btn sm primary" onClick={() => setRes(encode(text))}>
          {encodeLabel}
        </button>
        <button className="btn sm outline" onClick={() => setRes(decode(text))}>
          {decodeLabel}
        </button>
        <button
          className="btn sm outline"
          disabled={!res?.ok}
          onClick={() => {
            if (res?.ok) {
              setText(res.value);
              setRes(null);
            }
          }}
        >
          {t('tools.useAsInput')}
        </button>
        <ClearBtn
          onClick={() => {
            setText('');
            setRes(null);
          }}
        />
      </Actions>
      <ErrNotice r={res} />
      {res?.ok && <TextOut label={t('tools.output')} value={res.value} />}
    </>
  );
}

const base64EncodeR = (s: string): Result<string> => ({ ok: true, value: base64Encode(s) });

function HashTool() {
  const [text, setText] = useState('');
  const [algo, setAlgo] = useState<HashAlgorithm>('SHA-256');
  const [res, setRes] = useState<Result<string> | null>(null);
  useEffect(() => {
    let live = true;
    hashHex(algo, text).then(
      (value) => live && setRes({ ok: true, value }),
      () => live && setRes({ ok: false, code: 'hash' }),
    );
    return () => {
      live = false;
    };
  }, [algo, text]);
  return (
    <>
      <TextIn label={t('tools.input')} value={text} onChange={setText} />
      <Field label={t('tools.hash.algorithm')}>
        <select className="select sm" value={algo} onChange={(e) => setAlgo(e.target.value as HashAlgorithm)}>
          {HASH_ALGORITHMS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Field>
      <ErrNotice r={res} />
      <TextOut label={t('tools.hash.hex')} value={res?.ok ? res.value : ''} rows={4} />
    </>
  );
}

function UuidTool() {
  const [count, setCount] = useState('5');
  const [ids, setIds] = useState<string[]>(() => generateUuids(5));
  const gen = () => setIds(generateUuids(Number(count)));
  return (
    <>
      <Field label={t('tools.uuid.count')}>
        <input className="input" type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} />
      </Field>
      <Actions>
        <button className="btn sm primary" onClick={gen}>
          <Icon name="refresh" />
          {t('tools.uuid.generate')}
        </button>
      </Actions>
      <TextOut label={t('tools.output')} value={ids.join('\n')} rows={Math.min(12, Math.max(3, ids.length))} />
    </>
  );
}

const RADIX_KEY: Record<Radix, string> = { 2: 'tools.base.bin', 8: 'tools.base.oct', 10: 'tools.base.dec', 16: 'tools.base.hex' };

function BaseTool() {
  const [text, setText] = useState('255');
  const [radix, setRadix] = useState<Radix>(10);
  const res = useMemo(() => (text.trim() === '' ? null : convertBase(text, radix)), [text, radix]);
  return (
    <>
      <LineIn label={t('tools.input')} value={text} onChange={setText} />
      <Field label={t('tools.base.from')}>
        <select className="select sm" value={radix} onChange={(e) => setRadix(Number(e.target.value) as Radix)}>
          {RADIXES.map((r) => (
            <option key={r} value={r}>
              {t(RADIX_KEY[r])}
            </option>
          ))}
        </select>
      </Field>
      <ErrNotice r={res} />
      {res?.ok && (
        <div className="col gap-8" data-testid="tool-output">
          <KV label={t('tools.base.bin')} value={res.value.bin} />
          <KV label={t('tools.base.oct')} value={res.value.oct} />
          <KV label={t('tools.base.dec')} value={res.value.dec} />
          <KV label={t('tools.base.hex')} value={res.value.hex} />
        </div>
      )}
    </>
  );
}

function TimestampTool() {
  const [ts, setTs] = useState(() => String(Math.floor(Date.now() / 1000)));
  const [date, setDate] = useState('');
  const fromTs = useMemo(() => timestampToDate(ts), [ts]);
  const fromDate = useMemo(() => (date.trim() === '' ? null : dateToTimestamp(date)), [date]);
  return (
    <>
      <LineIn label={t('tools.ts.timestamp')} value={ts} onChange={setTs} />
      <Actions>
        <button className="btn sm primary" onClick={() => setTs(String(Math.floor(Date.now() / 1000)))}>
          {t('tools.ts.now')}
        </button>
        <button className="btn sm outline" onClick={() => setDate(new Date().toISOString())}>
          {t('tools.ts.nowDate')}
        </button>
      </Actions>
      <ErrNotice r={ts.trim() === '' ? null : fromTs} />
      {fromTs.ok && (
        <div className="col gap-8" data-testid="tool-output">
          <span className="chip">{fromTs.value.unit === 'seconds' ? t('tools.ts.unitSeconds') : t('tools.ts.unitMs')}</span>
          <KV label={t('tools.ts.iso')} value={fromTs.value.iso} />
          <KV label={t('tools.ts.local')} value={fromTs.value.local} />
        </div>
      )}
      <LineIn label={t('tools.ts.dateString')} value={date} onChange={setDate} placeholder="2024-05-01T12:00:00Z" />
      <ErrNotice r={fromDate} />
      {fromDate?.ok && (
        <div className="col gap-8">
          <KV label={t('tools.ts.seconds')} value={String(fromDate.value.seconds)} />
          <KV label={t('tools.ts.ms')} value={String(fromDate.value.ms)} />
          <KV label={t('tools.ts.iso')} value={fromDate.value.iso} />
        </div>
      )}
    </>
  );
}

function RegexTool() {
  const [pattern, setPattern] = useState('(\\w+)@(\\w+)\\.com');
  const [flags, setFlags] = useState('g');
  const [text, setText] = useState('alice@example.com, bob@test.com');
  const res = useMemo(() => (pattern === '' ? null : runRegex(pattern, flags, text)), [pattern, flags, text]);
  return (
    <>
      <LineIn label={t('tools.regex.pattern')} value={pattern} onChange={setPattern} />
      <LineIn label={t('tools.regex.flags')} value={flags} onChange={setFlags} placeholder="gimsuy" />
      <TextIn label={t('tools.regex.text')} value={text} onChange={setText} />
      <ErrNotice r={res} />
      {res?.ok && (
        <div className="col gap-8" data-testid="tool-output">
          <div className="muted small">{t('tools.regex.count', { n: res.value.matches.length })}</div>
          {res.value.truncated && <div className="notice">{t('tools.regex.truncated')}</div>}
          {res.value.matches.map((m, i) => (
            <div key={i} className="col gap-4">
              <div className="row">
                <span className="chip">#{i + 1}</span>
                <span className="chip">{t('tools.regex.at', { index: m.index })}</span>
              </div>
              <pre className="mono selectable" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {m.text === '' ? t('tools.regex.empty') : m.text}
              </pre>
              {m.groups.map((g, gi) => (
                <div key={gi} className="muted small mono" style={{ wordBreak: 'break-all' }}>
                  {t('tools.regex.group', { n: gi + 1 })}: {g === undefined ? t('tools.regex.unmatched') : g}
                </div>
              ))}
              {Object.entries(m.named).map(([k, v]) => (
                <div key={k} className="muted small mono" style={{ wordBreak: 'break-all' }}>
                  {k}: {v === undefined ? t('tools.regex.unmatched') : v}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ColorTool() {
  const [text, setText] = useState('#3b82f6');
  const res = useMemo(() => describeColor(text), [text]);
  return (
    <>
      <LineIn label={t('tools.color.input')} value={text} onChange={setText} placeholder="#rgb, #rrggbb, rgb(r, g, b), hsl(h, s%, l%)" />
      <ErrNotice r={text.trim() === '' ? null : res} />
      {res.ok && (
        <div className="col gap-8" data-testid="tool-output">
          <div style={{ height: 48, borderRadius: 6, border: 'var(--hairline) solid var(--border-2)', background: res.value.hex }} role="img" aria-label={t('tools.color.swatch')} />
          <KV label={t('tools.color.hex')} value={res.value.hex} />
          <KV label={t('tools.color.rgb')} value={res.value.rgbText} />
          <KV label={t('tools.color.hsl')} value={res.value.hslText} />
        </div>
      )}
    </>
  );
}

function DiffTool() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const res = useMemo(() => diffLines(a, b), [a, b]);
  const counts = useMemo(() => {
    if (!res.ok) return { add: 0, del: 0 };
    return { add: res.value.filter((l) => l.kind === 'add').length, del: res.value.filter((l) => l.kind === 'del').length };
  }, [res]);
  return (
    <>
      <TextIn label={t('tools.diff.original')} value={a} onChange={setA} rows={5} />
      <TextIn label={t('tools.diff.modified')} value={b} onChange={setB} rows={5} />
      <ErrNotice r={res} />
      {res.ok && res.value.length > 0 && (
        <>
          <div className="row">
            <span className="chip">{t('tools.diff.added', { n: counts.add })}</span>
            <span className="chip">{t('tools.diff.removed', { n: counts.del })}</span>
          </div>
          <div className="diff" data-testid="tool-output">
            {res.value.map((l, i) => (
              <div key={i} className={l.kind === 'same' ? 'diff-line' : `diff-line ${l.kind}`}>
                <span className="mark">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function CaseTool() {
  const [text, setText] = useState('hello world example');
  return (
    <>
      <TextIn label={t('tools.input')} value={text} onChange={setText} rows={4} />
      <div className="col gap-8" data-testid="tool-output">
        {CASE_STYLES.map((s) => (
          <KV key={s} label={t(`tools.case.${s}`)} value={convertCase(text, s)} />
        ))}
      </div>
    </>
  );
}

function JwtTool() {
  const [token, setToken] = useState('');
  const res = useMemo(() => decodeJwt(token), [token]);
  return (
    <>
      <TextIn label={t('tools.jwt.token')} value={token} onChange={setToken} rows={6} />
      <div className="notice">{t('tools.jwt.notVerified')}</div>
      <ErrNotice r={token.trim() === '' ? null : res} />
      {res.ok && (
        <div className="col gap-8" data-testid="tool-output">
          <div className="row">
            {res.value.alg && <span className="chip">{t('tools.jwt.alg', { alg: res.value.alg })}</span>}
            {res.value.expired && <span className="chip">{t('tools.jwt.expired')}</span>}
          </div>
          <Field label={t('tools.jwt.header')}>
            <pre className="mono selectable" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {res.value.headerText}
            </pre>
          </Field>
          <Field label={t('tools.jwt.payload')}>
            <pre className="mono selectable" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {res.value.payloadText}
            </pre>
          </Field>
          {res.value.claims.map((c) => (
            <KV key={c.name} label={c.name} value={`${c.iso}\n${c.local}`} />
          ))}
          <div className="muted small">{res.value.signature === '' ? t('tools.jwt.noSignature') : t('tools.jwt.signaturePresent')}</div>
        </div>
      )}
    </>
  );
}

function StatsTool() {
  const [text, setText] = useState('');
  const s = useMemo(() => textStats(text), [text]);
  return (
    <>
      <TextIn label={t('tools.input')} value={text} onChange={setText} rows={8} />
      <div className="col gap-8" data-testid="tool-output">
        <KV label={t('tools.stats.chars')} value={String(s.chars)} />
        <KV label={t('tools.stats.bytes')} value={String(s.bytes)} />
        <KV label={t('tools.stats.words')} value={String(s.words)} />
        <KV label={t('tools.stats.lines')} value={String(s.lines)} />
      </div>
    </>
  );
}

function renderTool(id: ToolId): ReactNode {
  switch (id) {
    case 'json':
      return <JsonTool />;
    case 'base64':
      return <CodecTool encodeLabel={t('tools.base64.encode')} decodeLabel={t('tools.base64.decode')} encode={base64EncodeR} decode={base64Decode} />;
    case 'url':
      return <CodecTool encodeLabel={t('tools.url.encode')} decodeLabel={t('tools.url.decode')} encode={urlEncode} decode={urlDecode} />;
    case 'hash':
      return <HashTool />;
    case 'uuid':
      return <UuidTool />;
    case 'base':
      return <BaseTool />;
    case 'timestamp':
      return <TimestampTool />;
    case 'regex':
      return <RegexTool />;
    case 'color':
      return <ColorTool />;
    case 'diff':
      return <DiffTool />;
    case 'case':
      return <CaseTool />;
    case 'jwt':
      return <JwtTool />;
    case 'stats':
      return <StatsTool />;
  }
}

export function ToolsPane() {
  useLocale();
  const [tool, setTool] = useState<ToolId>('json');
  return (
    <div className="col grow" data-testid="tools-pane">
      <div className="row pad-8" style={{ borderBottom: 'var(--hairline) solid var(--border-2)' }}>
        <select className="select sm grow" data-testid="tool-select" aria-label={t('tools.select')} value={tool} onChange={(e) => setTool(e.target.value as ToolId)}>
          {TOOL_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`tools.name.${id}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="scroll grow col gap-12 pad-12" key={tool}>
        {renderTool(tool)}
      </div>
    </div>
  );
}
