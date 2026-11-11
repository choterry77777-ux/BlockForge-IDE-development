export interface DiffLine {
  kind: 'same' | 'add' | 'del' | 'gap';
  text: string;
  /** Line numbers in the old and new text (1-based). */
  a?: number;
  b?: number;
}

/** Line based diff using a longest common subsequence table. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n');
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n');
  // Trim the common prefix and suffix so the table stays small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: 'same', text: a[i], a: i + 1, b: i + 1 });
  if (n * m > 4_000_000) {
    // Too large for a table: show the middle as a plain replacement.
    for (let i = start; i < endA; i++) out.push({ kind: 'del', text: a[i], a: i + 1 });
    for (let j = start; j < endB; j++) out.push({ kind: 'add', text: b[j], b: j + 1 });
  } else {
    const w = m + 1;
    const table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * w + j] = a[start + i] === b[start + j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        out.push({ kind: 'same', text: a[start + i], a: start + i + 1, b: start + j + 1 });
        i++;
        j++;
      } else if (j < m && (i === n || table[i * w + j + 1] >= table[(i + 1) * w + j])) {
        out.push({ kind: 'add', text: b[start + j], b: start + j + 1 });
        j++;
      } else {
        out.push({ kind: 'del', text: a[start + i], a: start + i + 1 });
        i++;
      }
    }
  }
  for (let k = 0; endA + k < a.length; k++) out.push({ kind: 'same', text: a[endA + k], a: endA + k + 1, b: endB + k + 1 });
  return out;
}

/** Keep changed lines with a few lines of context and collapse the rest. */
export function foldDiff(lines: DiffLine[], context = 3): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ kind: 'gap', text: String(skipped) });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ kind: 'gap', text: String(skipped) });
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((l) => l.kind === 'add').length, removed: lines.filter((l) => l.kind === 'del').length };
}
