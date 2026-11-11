import { COMPARABLE_LANGUAGES, domainOf, generateMany, type GenResult, LANGUAGES, type LanguageId, linesOfBlock, semanticNotes, TYPE_NAMES } from '@blockforge/core';
import { useEffect, useMemo, useState } from 'react';
import { exportZip } from '../actions';
import { Icon } from '../components/Icon';
import { MenuButton } from '../components/ui';
import { CodeEditor } from '../editor/CodeEditor';
import { monacoLanguage } from '../editor/monaco';
import { diagText, t } from '../i18n';
import { activeFile, blockForLine, useProject } from '../state/project';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';

/** The same blocks generated in several languages, side by side. */
export function ComparePane() {
  const file = useProject((s) => activeFile(s));
  const selected = useSettings((s) => s.compareLanguages) as LanguageId[];
  const selectedBlock = useUi((s) => s.selectedBlock);
  const [results, setResults] = useState<Partial<Record<LanguageId, GenResult>>>({});
  const [tab, setTab] = useState<'code' | 'types' | 'notes'>('code');
  const comparable = !!file && domainOf(file.language) === 'imperative' && file.mode === 'blocks';
  const langs = useMemo(() => selected.filter((l) => COMPARABLE_LANGUAGES.includes(l)), [selected]);

  useEffect(() => {
    let live = true;
    if (!comparable || !file) return;
    const id = setTimeout(() => {
      void generateMany(file.blocks, langs).then((r) => live && setResults(r));
    }, 200);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [file?.blocks, langs, comparable, file]);

  if (!file || !comparable) {
    return (
      <div className="empty secondary" data-testid="compare-pane">
        <Icon name="compare" size={22} />
        {t(file && file.mode !== 'blocks' ? 'compare.codeMode' : 'compare.onlyImperative')}
      </div>
    );
  }
  const toggle = (l: LanguageId) => useSettings.getState().update({ compareLanguages: langs.includes(l) ? langs.filter((x) => x !== l) : [...langs, l] });
  const features = results[langs[0]]?.meta.features ?? [];
  const notes = semanticNotes(features, langs);

  return (
    <div className="col grow" data-testid="compare-pane">
      <div className="row pad-8 gap-6 wrap" style={{ borderBottom: 'var(--hairline) solid var(--border-2)', flex: 'none' }}>
        <div className="segmented">
          <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}>
            {t('compare.code')}
          </button>
          <button className={tab === 'types' ? 'active' : ''} onClick={() => setTab('types')}>
            {t('compare.types')}
          </button>
          <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')} data-testid="compare-notes-tab">
            {t('compare.notes')}
            <span className="chip" style={{ marginLeft: 6, height: 16 }}>
              {notes.length}
            </span>
          </button>
        </div>
        <span className="grow" />
        <MenuButton className="btn sm outline" items={COMPARABLE_LANGUAGES.map((l) => ({ label: LANGUAGES[l].name, icon: langs.includes(l) ? 'check' : undefined, onSelect: () => toggle(l) }))} testId="compare-langs">
          {t('compare.languages', { count: langs.length })}
          <Icon name="chevronDown" size={13} />
        </MenuButton>
        <button className="btn sm icon" title={t('compare.export')} onClick={() => void exportZip(langs)}>
          <Icon name="download" />
        </button>
      </div>

      {tab === 'code' && (
        <div className="scroll grow col gap-12 pad-12">
          {!langs.length && <div className="empty secondary">{t('compare.pick')}</div>}
          {langs.map((l) => {
            const r = results[l];
            const errors = r?.diagnostics.filter((d) => d.severity === 'error') ?? [];
            const range = r && selectedBlock ? linesOfBlock(r, selectedBlock) : undefined;
            const code = r?.files[0].content ?? '';
            return (
              <div key={l} className="code-card" style={{ margin: 0, flex: 'none' }} data-testid={`compare-${l}`}>
                <div className="code-card-head">
                  <span className="strong" style={{ color: 'var(--label-primary)' }}>
                    {LANGUAGES[l].name}
                  </span>
                  {errors.length > 0 && <span className="chip err" style={{ marginLeft: 8 }}>{t('compare.unsupported', { count: errors.length })}</span>}
                  <span className="grow" />
                  <span>{t('compare.lines', { count: code ? code.trimEnd().split('\n').length : 0 })}</span>
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
                  <button className="btn sm icon" title={t('compare.switchTo', { name: LANGUAGES[l].name })} onClick={() => useProject.getState().setLanguage(file.id, l)}>
                    <Icon name="arrowRight" size={14} />
                  </button>
                </div>
                {errors.length > 0 && (
                  <div className="notice warn selectable" style={{ margin: '0 10px 8px' }}>
                    <div>{errors.slice(0, 3).map((d, i) => <div key={i}>{diagText(d)}</div>)}</div>
                  </div>
                )}
                <div style={{ height: Math.min(320, Math.max(60, code.split('\n').length * 21 + 22)), display: 'flex' }}>
                  <CodeEditor
                    docId={`compare-${file.id}-${l}`}
                    value={code}
                    language={monacoLanguage(l)}
                    readOnly
                    minimal
                    highlight={range ? { start: range.startLine, end: range.endLine } : undefined}
                    testId={`compare-editor-${l}`}
                    onLineClick={(line) => {
                      // Lines of any language lead back to the block that produced them.
                      const id = r ? (r.mappings.filter((m) => line >= m.startLine && line <= m.endLine).sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0]?.blockId ?? blockForLine(file.id, line)) : undefined;
                      if (id) useUi.setState({ revealBlock: { id, n: Date.now() }, selectedBlock: id });
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'types' && (
        <div className="scroll grow pad-12">
          <table className="grid selectable">
            <thead>
              <tr>
                <th>{t('compare.blockType')}</th>
                {langs.map((l) => (
                  <th key={l}>{LANGUAGES[l].name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(TYPE_NAMES).map(([name, row]) => (
                <tr key={name}>
                  <td>{t(`type.${name}`)}</td>
                  {langs.map((l) => (
                    <td key={l} className="mono">
                      {row[l]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'notes' && (
        <div className="scroll grow col gap-8 pad-12" data-testid="compare-notes">
          <div className="notice">{t('compare.notesIntro')}</div>
          {notes.map((n) => (
            <div key={n.id} className="row" style={{ alignItems: 'flex-start', gap: 10, padding: '4px 2px' }}>
              <span className="dot warn" style={{ marginTop: 7 }} />
              <span className="selectable secondary" style={{ lineHeight: 1.55 }}>
                {t(`note.${n.id}`) === `note.${n.id}` ? n.text : t(`note.${n.id}`)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
