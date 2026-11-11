import { blockTypesFor, buildToolbox, type Diagnostic, type LanguageId, toolboxEntry, type WorkspaceState } from '@blockforge/core';
import { PositionedMinimap } from '@blockly/workspace-minimap';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { diagText, t, useLocale } from '../i18n';
import { useProject } from '../state/project';
import { resolveTheme, useSettings } from '../state/settings';
import { promptDialog, useUi } from '../state/ui';
import { Blockly, blockSearchText, categoryLabel, setupBlockly, themes } from './setup';

export interface BlockEditorApi {
  /** Replace the workspace as one undoable step. */
  applyState(state: WorkspaceState): void;
  getState(): WorkspaceState;
  selectedIds(): string[];
  reveal(id: string): void;
  undo(redo?: boolean): void;
}

/** Live block editors by file id, so other panels can talk to them. */
export const blockEditors = new Map<string, BlockEditorApi>();

let menusRegistered = false;

function registerContextMenus(): void {
  if (menusRegistered) return;
  menusRegistered = true;
  const reg = Blockly.ContextMenuRegistry.registry;
  reg.register({
    id: 'bf_favorite',
    weight: 200,
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    displayText: (scope) => (useSettings.getState().favorites.includes(scope.block!.type) ? t('blocks.unfavorite') : t('blocks.favorite')),
    preconditionFn: (scope) => (scope.block && !scope.block.isInFlyout ? 'enabled' : 'hidden'),
    callback: (scope) => {
      const type = scope.block!.type;
      const cur = useSettings.getState().favorites;
      useSettings.getState().update({ favorites: cur.includes(type) ? cur.filter((x) => x !== type) : [...cur, type] });
    },
  });
  reg.register({
    id: 'bf_save_custom',
    weight: 201,
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    displayText: () => t('blocks.saveCustom'),
    preconditionFn: (scope) => (scope.block && !scope.block.isInFlyout ? 'enabled' : 'hidden'),
    callback: (scope) => {
      const state = Blockly.serialization.blocks.save(scope.block!, { addCoordinates: false, addNextBlocks: false, saveIds: false });
      void promptDialog({ title: t('blocks.saveCustom'), message: t('blocks.saveCustomHint'), value: '' }).then((name) => {
        if (!name?.trim() || !state) return;
        const cur = useSettings.getState().customBlocks;
        useSettings.getState().update({ customBlocks: [...cur, { id: `c${Date.now().toString(36)}`, name: name.trim(), state }] });
        useUi.getState().toast(t('blocks.customSaved'), 'ok');
      });
    },
  });
}

function toolboxFor(lang: LanguageId, unsupported?: Set<string>) {
  const s = useSettings.getState();
  const def = buildToolbox({ lang, label: categoryLabel, unsupported, favorites: s.favorites.filter((f) => blockTypesFor(lang).includes(f)) });
  if (s.customBlocks.length) {
    def.contents.push({ kind: 'sep' });
    def.contents.push({ kind: 'category', name: t('cat.custom'), categorystyle: 'custom_category', toolboxitemid: 'custom', contents: s.customBlocks.flatMap((c) => [{ kind: 'label', text: c.name }, { kind: 'block', ...(c.state as object) }]) });
  }
  return def;
}

function variablesFlyout(ws: Blockly.WorkspaceSvg): Blockly.utils.toolbox.FlyoutDefinition {
  const out: Record<string, unknown>[] = [{ kind: 'button', text: t('blocks.createVariable'), callbackkey: 'BF_CREATE_VARIABLE' }];
  const vars = ws.getVariableMap().getAllVariables();
  if (!vars.length) return out as unknown as Blockly.utils.toolbox.FlyoutDefinition;
  const last = vars[vars.length - 1];
  const field = (v: { getId(): string }) => ({ VAR: { id: v.getId() } });
  out.push({ kind: 'block', type: 'variables_set', fields: field(last) });
  out.push({ kind: 'block', type: 'math_change', fields: field(last), inputs: { DELTA: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } });
  out.push({ kind: 'block', type: 'bf_var_declare', fields: field(last) });
  for (const v of [...vars].sort((a, b) => a.getName().localeCompare(b.getName()))) out.push({ kind: 'block', type: 'variables_get', fields: field(v) });
  return out as unknown as Blockly.utils.toolbox.FlyoutDefinition;
}

function proceduresFlyout(ws: Blockly.WorkspaceSvg): Blockly.utils.toolbox.FlyoutDefinition {
  const out: Record<string, unknown>[] = [
    { kind: 'block', type: 'procedures_defnoreturn', fields: { NAME: t('blocks.defaultFunction') } },
    { kind: 'block', type: 'procedures_defreturn', fields: { NAME: t('blocks.defaultFunction') } },
    { kind: 'block', type: 'bf_return' },
    { kind: 'block', type: 'procedures_ifreturn' },
  ];
  const [noReturn, withReturn] = Blockly.Procedures.allProcedures(ws);
  for (const [name, params] of noReturn) out.push({ kind: 'block', type: 'procedures_callnoreturn', extraState: { name, params } });
  for (const [name, params] of withReturn) out.push({ kind: 'block', type: 'procedures_callreturn', extraState: { name, params } });
  out.push({ kind: 'block', type: 'bf_func_ref' }, { kind: 'block', type: 'bf_call_ref' }, { kind: 'block', type: 'bf_call_ref_stmt' });
  return out as unknown as Blockly.utils.toolbox.FlyoutDefinition;
}

interface Props {
  fileId: string;
  language: LanguageId;
  initial: WorkspaceState;
  readOnly?: boolean;
  diagnostics?: Diagnostic[];
  unsupported?: Set<string>;
  /** Blocks to mark, for example the ones an AI proposal would add. */
  highlight?: string[];
  compact?: boolean;
}

export function BlocklyPane({ fileId, language, initial, readOnly, diagnostics, unsupported, highlight, compact }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const locale = useLocale();
  const themeMode = useSettings((s) => s.theme);
  const blockSettings = useSettings((s) => s.blocks);
  const favorites = useSettings((s) => s.favorites);
  const customBlocks = useSettings((s) => s.customBlocks);
  const revision = useProject((s) => s.blocksRevision);
  const reveal = useUi((s) => s.revealBlock);
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(0);
  const lastSaved = useRef('');
  const initialRef = useRef(initial);
  initialRef.current = initial;

  // Create the workspace. It is rebuilt when the language (labels) or file changes.
  useEffect(() => {
    let disposed = false;
    let ws: Blockly.WorkspaceSvg | undefined;
    let minimap: PositionedMinimap | undefined;
    let observer: ResizeObserver | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    void setupBlockly(locale).then(() => {
      if (disposed || !host.current) return;
      registerContextMenus();
      const settings = useSettings.getState();
      ws = Blockly.inject(host.current, {
        toolbox: readOnly ? undefined : (toolboxFor(language, unsupported) as Blockly.utils.toolbox.ToolboxDefinition),
        renderer: 'zelos',
        theme: themes[resolveTheme(settings.theme)],
        readOnly: !!readOnly,
        media: '/blockly-media/',
        sounds: settings.blocks.sounds,
        trashcan: false,
        grid: settings.blocks.grid && !compact ? { spacing: 24, length: 1.5, colour: resolveTheme(settings.theme) === 'dark' ? '#3a3b3f' : '#d9dce0', snap: settings.blocks.snap } : undefined,
        zoom: { controls: false, wheel: true, pinch: true, startScale: compact ? 0.7 : settings.blocks.scale, maxScale: 2.2, minScale: 0.3, scaleSpeed: 1.1 },
        move: { scrollbars: true, drag: true, wheel: true },
      });
      wsRef.current = ws;
      if (!readOnly) {
        ws.registerToolboxCategoryCallback('BF_VARIABLE', variablesFlyout);
        ws.registerToolboxCategoryCallback('BF_PROCEDURE', proceduresFlyout);
        ws.registerButtonCallback('BF_CREATE_VARIABLE', (button) => Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace()));
        if (settings.blocks.minimap) {
          minimap = new PositionedMinimap(ws);
          minimap.init();
        }
      }
      const load = (state: WorkspaceState) => {
        Blockly.Events.disable();
        try {
          Blockly.serialization.workspaces.load(state as Parameters<typeof Blockly.serialization.workspaces.load>[0], ws!, { recordUndo: false });
        } catch (err) {
          console.error(err);
          useUi.getState().toast(t('blocks.loadFailed'), 'err');
        } finally {
          Blockly.Events.enable();
        }
        ws!.clearUndo();
        lastSaved.current = JSON.stringify(Blockly.serialization.workspaces.save(ws!));
      };
      load(initialRef.current);
      if (compact || readOnly) setTimeout(() => ws && !disposed && ws.zoomToFit(), 30);

      const persist = () => {
        if (!ws || readOnly) return;
        const state = Blockly.serialization.workspaces.save(ws) as WorkspaceState;
        const text = JSON.stringify(state);
        if (text === lastSaved.current) return;
        lastSaved.current = text;
        useProject.getState().updateBlocks(fileId, state);
      };
      ws.addChangeListener((e: Blockly.Events.Abstract) => {
        if (e.type === Blockly.Events.SELECTED) {
          useUi.setState({ selectedBlock: (e as Blockly.Events.Selected).newElementId ?? undefined });
          return;
        }
        if (e.isUiEvent || ws!.isDragging()) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persist, 150);
      });

      if (!readOnly) {
        blockEditors.set(fileId, {
          applyState(state) {
            Blockly.Events.setGroup(true);
            try {
              ws!.clear();
              Blockly.serialization.workspaces.load(state as Parameters<typeof Blockly.serialization.workspaces.load>[0], ws!, { recordUndo: true });
            } finally {
              Blockly.Events.setGroup(false);
            }
            persist();
          },
          getState: () => Blockly.serialization.workspaces.save(ws!) as WorkspaceState,
          selectedIds() {
            const sel = Blockly.common.getSelected();
            return sel && 'id' in sel ? [String((sel as { id: string }).id)] : [];
          },
          reveal(id) {
            const block = ws!.getBlockById(id);
            if (!block) return;
            ws!.centerOnBlock(id);
            block.select();
          },
          undo: (redo) => ws!.undo(!!redo),
        });
      }
      observer = new ResizeObserver(() => ws && Blockly.svgResize(ws));
      observer.observe(host.current);
      setReady((n) => n + 1);
    });
    return () => {
      disposed = true;
      clearTimeout(saveTimer);
      observer?.disconnect();
      minimap?.dispose();
      if (blockEditors.get(fileId) && !readOnly) blockEditors.delete(fileId);
      ws?.dispose();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, locale, readOnly, compact, blockSettings.minimap, blockSettings.grid, blockSettings.snap, blockSettings.sounds]);

  // Blocks replaced from outside (language switch, restore, import).
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ready) return;
    const text = JSON.stringify(initialRef.current);
    if (text === lastSaved.current) return;
    Blockly.Events.disable();
    try {
      ws.clear();
      Blockly.serialization.workspaces.load(initialRef.current as Parameters<typeof Blockly.serialization.workspaces.load>[0], ws, { recordUndo: false });
    } finally {
      Blockly.Events.enable();
    }
    lastSaved.current = JSON.stringify(Blockly.serialization.workspaces.save(ws));
    if (readOnly || compact) ws.zoomToFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, ready, readOnly ? JSON.stringify(initial) : '']);

  useEffect(() => {
    wsRef.current?.setTheme(themes[resolveTheme(themeMode)]);
  }, [themeMode, ready]);

  // The toolbox follows the target language, favourites and saved blocks.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || readOnly || !ready) return;
    ws.updateToolbox(toolboxFor(language, unsupported) as Blockly.utils.toolbox.ToolboxDefinition);
  }, [language, favorites, customBlocks, unsupported, ready, readOnly]);

  // Diagnostics appear on the blocks that caused them.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ready) return;
    const byBlock = new Map<string, string[]>();
    for (const d of diagnostics ?? []) {
      if (!d.blockId || d.severity === 'info') continue;
      byBlock.set(d.blockId, [...(byBlock.get(d.blockId) ?? []), diagText(d)]);
    }
    for (const block of ws.getAllBlocks(false)) block.setWarningText(byBlock.get(block.id)?.join('\n') ?? null, 'bf');
  }, [diagnostics, ready]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ready || !highlight) return;
    for (const block of ws.getAllBlocks(false)) block.setHighlighted(highlight.includes(block.id));
  }, [highlight, ready]);

  useEffect(() => {
    if (!reveal || readOnly) return;
    blockEditors.get(fileId)?.reveal(reveal.id);
  }, [reveal, fileId, readOnly]);

  // Block search shows matches in the flyout.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || readOnly || !ready) return;
    const flyout = ws.getToolbox()?.getFlyout();
    if (!flyout) return;
    const q = query.trim().toLowerCase();
    if (!q) {
      if (flyout.isVisible() && !ws.getToolbox()?.getSelectedItem()) flyout.hide();
      return;
    }
    const words = q.split(/\s+/);
    const hits = blockTypesFor(language).filter((type) => words.every((w) => blockSearchText(type).includes(w)));
    ws.getToolbox()?.clearSelection();
    const items = hits.length ? hits.slice(0, 40).flatMap((type) => toolboxEntry(type, language) ?? []) : [{ kind: 'label', text: t('blocks.noMatch') }];
    flyout.show(items as Blockly.utils.toolbox.FlyoutDefinition);
  }, [query, language, ready, readOnly]);

  const ws = () => wsRef.current;
  return (
    <div className="col grow" style={{ position: 'relative' }}>
      <div className="grow" style={{ position: 'relative' }}>
        <div ref={host} className="blockly-host" data-testid={readOnly ? 'blocks-preview' : 'blocks-editor'} />
      </div>
      {!readOnly && (
        <div className="row gap-4 card" style={{ position: 'absolute', right: 12, bottom: 8, zIndex: 20, padding: 3, borderRadius: 12, maxWidth: 'calc(100% - 132px)' }}>
          <span style={{ display: 'flex', paddingLeft: 8 }}>
            <Icon name="search" size={14} className="faint" />
          </span>
          <input className="input sm" style={{ boxShadow: 'none', width: 132, minWidth: 40, flex: '1 1 40px', background: 'transparent', paddingLeft: 4 }} placeholder={t('blocks.search')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} aria-label={t('blocks.search')} data-testid="block-search" />
          {query && (
            <button className="btn sm icon" onClick={() => setQuery('')} title={t('common.clear')}>
              <Icon name="x" size={13} />
            </button>
          )}
          <span style={{ width: 'var(--hairline)', height: 16, background: 'var(--border-4)' }} />
          <button className="btn sm icon" title={t('common.undo')} onClick={() => ws()?.undo(false)}>
            <Icon name="undo" />
          </button>
          <button className="btn sm icon" title={t('common.redo')} onClick={() => ws()?.undo(true)}>
            <Icon name="redo" />
          </button>
          <button className="btn sm icon" title={t('blocks.zoomOut')} onClick={() => ws()?.zoomCenter(-1)}>
            <Icon name="zoomOut" />
          </button>
          <button className="btn sm icon" title={t('blocks.zoomIn')} onClick={() => ws()?.zoomCenter(1)}>
            <Icon name="zoomIn" />
          </button>
          <button className="btn sm icon" title={t('blocks.zoomFit')} onClick={() => ws()?.zoomToFit()}>
            <Icon name="fit" />
          </button>
        </div>
      )}
    </div>
  );
}
