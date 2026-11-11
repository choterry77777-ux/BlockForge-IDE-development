/** Patterns of well-known API key formats, used as a second line of defence. */
const KEY_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{10,}/g, /sk-[A-Za-z0-9_-]{16,}/g, /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, /(x-api-key|api-key|authorization)["']?\s*[:=]\s*["']?[^\s"',}]{8,}/gi];

/** Remove secrets from text before it is logged, shown or sent anywhere. */
export function redactSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  }
  for (const p of KEY_PATTERNS) {
    out = out.replace(p, (m) => {
      const head = /^(Bearer\s+|[\w-]+["']?\s*[:=]\s*["']?)/i.exec(m)?.[0] ?? '';
      return `${head}[redacted]`;
    });
  }
  return out;
}

/** Header names whose values must never be logged. */
export const SENSITIVE_HEADERS = ['authorization', 'x-api-key', 'api-key', 'proxy-authorization', 'cookie'];

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = SENSITIVE_HEADERS.includes(k.toLowerCase()) ? '[redacted]' : v;
  return out;
}

/** True when an object tree contains anything that looks like a stored credential. */
export function containsSecretLikeKeys(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/^(api[-_]?key|secret|token|password|authorization)$/i.test(k) && typeof v === 'string' && v.length > 0) return true;
    if (containsSecretLikeKeys(v)) return true;
  }
  return false;
}
