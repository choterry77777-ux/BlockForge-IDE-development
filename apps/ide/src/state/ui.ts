import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  kind?: 'ok' | 'err' | 'info';
}

export interface ConfirmRequest {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Text field for prompt style dialogs. */
  input?: { value: string; placeholder?: string };
  resolve: (result: { ok: boolean; value?: string }) => void;
}

interface UiStore {
  toasts: Toast[];
  confirm?: ConfirmRequest;
  dialog?: 'settings' | 'projects' | 'palette' | 'newProject' | 'shortcuts' | 'examples' | 'importCode';
  settingsTab: string;
  sidebarView: 'files' | 'search';
  /** Block currently selected in the workspace, and the block to reveal. */
  selectedBlock?: string;
  revealBlock?: { id: string; n: number };
  revealLine?: { file: string; line: number; n: number };
  search: string;
  toast: (text: string, kind?: Toast['kind']) => void;
  open: (dialog: UiStore['dialog'], tab?: string) => void;
  close: () => void;
  set: (patch: Partial<UiStore>) => void;
}

let toastId = 0;

export const useUi = create<UiStore>((set) => ({
  toasts: [],
  settingsTab: 'general',
  sidebarView: 'files',
  search: '',
  toast: (text, kind) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'err' ? 6000 : 3200);
  },
  open: (dialog, tab) => set((s) => ({ dialog, settingsTab: tab ?? s.settingsTab })),
  close: () => set({ dialog: undefined }),
  set: (patch) => set(patch),
}));

/** Ask for confirmation with an in-app dialog. */
export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useUi.setState({ confirm: { ...opts, resolve: (r) => resolve(r.ok) } }));
}

/** Ask for a line of text with an in-app dialog. Resolves to undefined when cancelled. */
export function promptDialog(opts: Omit<ConfirmRequest, 'resolve' | 'input'> & { value?: string; placeholder?: string }): Promise<string | undefined> {
  return new Promise((resolve) => useUi.setState({ confirm: { ...opts, input: { value: opts.value ?? '', placeholder: opts.placeholder }, resolve: (r) => resolve(r.ok ? r.value : undefined) } }));
}
