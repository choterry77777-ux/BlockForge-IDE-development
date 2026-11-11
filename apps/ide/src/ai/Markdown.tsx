import DOMPurify from 'dompurify';
import { marked, type Token } from 'marked';
import { memo, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { colorize } from '../editor/monaco';
import { t } from '../i18n';
import { useUi } from '../state/ui';

const ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', 'c++': 'cpp', cs: 'csharp', rb: 'ruby', kt: 'kotlin', rs: 'rust', golang: 'go', asm: 'bf-asm', assembly: 'bf-asm', yml: 'yaml' };

export const CodeCard = memo(function CodeCard({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string>();
  const id = ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();
  useEffect(() => {
    let live = true;
    if (!code || code.length > 60000) return;
    void colorize(code, id || 'plaintext')
      .then((h) => live && setHtml(h))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code, id]);
  return (
    <div className="code-card">
      <div className="code-card-head">
        <span>{lang || 'text'}</span>
        <span className="grow" />
        <button
          className="btn sm icon"
          title={t('common.copy')}
          onClick={() => {
            void navigator.clipboard.writeText(code);
            useUi.getState().toast(t('common.copied'), 'ok');
          }}
        >
          <Icon name="copy" size={14} />
        </button>
      </div>
      {/* Colourised output comes from the editor's tokenizer and contains only spans. */}
      {html ? <pre className="selectable" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, { ALLOWED_TAGS: ['span', 'br', 'div'], ALLOWED_ATTR: ['class', 'style'] }) }} /> : <pre className="selectable">{code}</pre>}
    </div>
  );
});

/** Markdown from a model is untrusted: it is sanitised and never allowed to carry script or styles. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const tokens = useMemo(() => {
    try {
      return marked.lexer(text, { gfm: true, breaks: false });
    } catch {
      return [{ type: 'paragraph', raw: text, text, tokens: [{ type: 'text', raw: text, text }] } as Token];
    }
  }, [text]);
  return (
    <div className="md selectable">
      {tokens.map((tok, i) => {
        if (tok.type === 'code') return <CodeCard key={i} code={(tok as { text: string }).text} lang={((tok as { lang?: string }).lang ?? '').split(/\s/)[0]} />;
        if (tok.type === 'space') return null;
        const html = DOMPurify.sanitize(marked.parser([tok] as Token[], { gfm: true }), { FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'img', 'video', 'audio', 'object', 'embed', 'svg', 'math'], FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'], ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i });
        return <div key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
});
