export interface SseEvent {
  event?: string;
  data: string;
}

/** Incremental Server-Sent Events parser. Tolerates CRLF, comments and split chunks. */
export async function* parseSse(body: AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | undefined;
  let data: string[] = [];
  const flush = function* (): Generator<SseEvent> {
    if (data.length) yield { event, data: data.join('\n') };
    event = undefined;
    data = [];
  };
  const feed = function* (line: string): Generator<SseEvent> {
    if (line === '') {
      yield* flush();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n/)) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 2 : 1));
      yield* feed(line);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield* feed(buffer);
  yield* flush();
}

export async function readAll(body: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let out = '';
  for await (const chunk of body) out += decoder.decode(chunk, { stream: true });
  return out + decoder.decode();
}
