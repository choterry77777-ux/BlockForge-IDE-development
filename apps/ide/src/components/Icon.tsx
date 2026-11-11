/** Line icons drawn for BlockForge: 16px grid, round joins, no fills. */
const PATHS: Record<string, string> = {
  play: 'M5 3.2v9.6l7.5-4.8z',
  stop: 'M4.5 4.5h7v7h-7z',
  build: 'M9.8 2.6a3.3 3.3 0 0 0-3.9 4.3L2.6 10.2a1.3 1.3 0 0 0 0 1.9l1.3 1.3a1.3 1.3 0 0 0 1.9 0l3.3-3.3a3.3 3.3 0 0 0 4.3-3.9l-2.1 2.1-1.9-.5-.5-1.9z',
  clean: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M4.6 4.5l.6 8.5h5.6l.6-8.5M6.8 7v4M9.2 7v4',
  rebuild: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.4h-2.4',
  files: 'M3 4.2A1.2 1.2 0 0 1 4.2 3h2.5l1.3 1.5h3.8A1.2 1.2 0 0 1 13 5.7v5.6a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 11.3z',
  file: 'M4.5 2.5h4.6L11.5 5v8.5h-7zM9 2.6V5h2.4',
  filePlus: 'M4.5 2.5h4.6L11.5 5v8.5h-7zM8 7.2v3.6M6.2 9h3.6',
  search: 'M7.2 12a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6zM10.7 10.7l2.8 2.8',
  settings: 'M8 10.1a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2zM8 2.3v1.4M8 12.3v1.4M2.3 8h1.4M12.3 8h1.4M4 4l1 1M11 11l1 1M12 4l-1 1M5 11l-1 1',
  plus: 'M8 3.5v9M3.5 8h9',
  minus: 'M3.5 8h9',
  x: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6',
  check: 'M3.5 8.4l3 3 6-6.6',
  chevronDown: 'M4.2 6.2L8 10l3.8-3.8',
  chevronRight: 'M6.2 4.2L10 8l-3.8 3.8',
  chevronLeft: 'M9.8 4.2L6 8l3.8 3.8',
  chevronUp: 'M4.2 9.8L8 6l3.8 3.8',
  arrowUp: 'M8 12.5v-9M4.5 7L8 3.5 11.5 7',
  arrowRight: 'M3.5 8h9M9 4.5L12.5 8 9 11.5',
  arrowLeft: 'M12.5 8h-9M7 4.5L3.5 8 7 11.5',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.4h-2.4',
  blocks: 'M2.8 4h4.2v1.3a1.2 1.2 0 0 0 2.4 0V4h3.8v4.2H2.8zM2.8 8.2h10.4V12H2.8z',
  code: 'M5.6 4.6L2.4 8l3.2 3.4M10.4 4.6L13.6 8l-3.2 3.4M9 3.2L7 12.8',
  split: 'M2.8 3.2h10.4v9.6H2.8zM8 3.2v9.6',
  compare: 'M2.8 3.2h4.2v9.6H2.8zM9 3.2h4.2v9.6H9z',
  sparkle: 'M8 2.4l1.2 3.6 3.6 1.2-3.6 1.2L8 12l-1.2-3.6L3.2 7.2l3.6-1.2zM12.4 11.2v2.4M11.2 12.4h2.4',
  terminal: 'M2.8 3.4h10.4v9.2H2.8zM5 6.4l2 1.6-2 1.6M8.4 9.8H11',
  warning: 'M8 2.8l5.6 9.8H2.4zM8 6.6v2.8M8 11.1v.2',
  error: 'M8 13.6A5.6 5.6 0 1 0 8 2.4a5.6 5.6 0 0 0 0 11.2zM8 5.2v3.4M8 10.6v.2',
  info: 'M8 13.6A5.6 5.6 0 1 0 8 2.4a5.6 5.6 0 0 0 0 11.2zM8 7.4v3.4M8 5.3v.2',
  package: 'M8 2.4l5 2.6v6L8 13.6 3 11V5zM3.2 5.1L8 7.6l4.8-2.5M8 7.6v5.8',
  toolchain: 'M3 12.8h10M4.4 12.8V7.2l3.6-2.8 3.6 2.8v5.6M6.8 12.8V9.6h2.4v3.2',
  globe: 'M8 13.6A5.6 5.6 0 1 0 8 2.4a5.6 5.6 0 0 0 0 11.2zM2.6 8h10.8M8 2.4c1.6 1.6 2.3 3.5 2.3 5.6S9.6 12 8 13.6C6.4 12 5.7 10.1 5.7 8S6.4 4 8 2.4z',
  tools: 'M3 5h4M9.5 5H13M3 11h1.5M7 11h6M8.2 3.8v2.4M5.8 9.8v2.4',
  save: 'M3.2 3.2h7.6l2 2v7.6H3.2zM5.4 3.3v3h4.6v-3M5.4 12.7V9.4h5.2v3.3',
  folder: 'M2.8 4.4A1.2 1.2 0 0 1 4 3.2h2.4l1.3 1.4h4.3a1.2 1.2 0 0 1 1.2 1.2v5.4a1.2 1.2 0 0 1-1.2 1.2H4a1.2 1.2 0 0 1-1.2-1.2z',
  folderPlus: 'M2.8 4.4A1.2 1.2 0 0 1 4 3.2h2.4l1.3 1.4h4.3a1.2 1.2 0 0 1 1.2 1.2v5.4a1.2 1.2 0 0 1-1.2 1.2H4a1.2 1.2 0 0 1-1.2-1.2zM8 6.9v3.4M6.3 8.6h3.4',
  folderOpen: 'M2.8 12.2V4.4A1.2 1.2 0 0 1 4 3.2h2.4l1.3 1.4h3.9a1.2 1.2 0 0 1 1.2 1.2v.8M2.8 12.2l1.6-5h9.4l-1.6 5z',
  download: 'M8 2.8v7.4M4.8 7.2L8 10.4l3.2-3.2M3.2 12.8h9.6',
  upload: 'M8 10.4V3M4.8 6.2L8 3l3.2 3.2M3.2 12.8h9.6',
  copy: 'M5.6 5.6h7.2v7.2H5.6zM10.4 5.6V3.2H3.2v7.2h2.4',
  trash: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M4.6 4.5l.6 8.5h5.6l.6-8.5',
  edit: 'M3 13l.6-2.8 7-7 2.2 2.2-7 7zM9.4 4.4l2.2 2.2',
  sidebar: 'M2.8 3.2h10.4v9.6H2.8zM6.2 3.2v9.6',
  panelRight: 'M2.8 3.2h10.4v9.6H2.8zM9.8 3.2v9.6',
  panelBottom: 'M2.8 3.2h10.4v9.6H2.8zM2.8 9.4h10.4',
  star: 'M8 2.6l1.6 3.4 3.7.5-2.7 2.6.7 3.7L8 11l-3.3 1.8.7-3.7L2.7 6.5l3.7-.5z',
  undo: 'M5.6 3.6L2.8 6.4l2.8 2.8M3 6.4h6.2a3.6 3.6 0 0 1 0 7.2H6.4',
  redo: 'M10.4 3.6l2.8 2.8-2.8 2.8M13 6.4H6.8a3.6 3.6 0 0 0 0 7.2h2.8',
  zoomIn: 'M7.2 12a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6zM10.7 10.7l2.8 2.8M7.2 5.4V9M5.4 7.2H9',
  zoomOut: 'M7.2 12a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6zM10.7 10.7l2.8 2.8M5.4 7.2H9',
  fit: 'M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3',
  more: 'M4 8h.1M8 8h.1M12 8h.1',
  external: 'M9.2 3.2h3.6v3.6M12.6 3.4L7.6 8.4M11.2 9.2v3.6H3.2V4.8h3.6',
  key: 'M10.2 9.2a3.2 3.2 0 1 0-3-2.1L2.8 11.5v1.7h1.9l.9-.9v-1.2h1.2l1.4-1.4a3.2 3.2 0 0 0 2 .5zM10.8 5.2v.1',
  lock: 'M4.4 7.4h7.2v5.4H4.4zM6 7.4V5.6a2 2 0 0 1 4 0v1.8',
  book: 'M3.2 3.2h3.6A1.2 1.2 0 0 1 8 4.4v8.4a1.2 1.2 0 0 0-1.2-1.2H3.2zM12.8 3.2H9.2A1.2 1.2 0 0 0 8 4.4v8.4a1.2 1.2 0 0 1 1.2-1.2h3.6z',
  eye: 'M1.8 8S4.2 3.8 8 3.8 14.2 8 14.2 8 11.8 12.2 8 12.2 1.8 8 1.8 8zM8 9.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
  history: 'M3 8a5 5 0 1 0 1.5-3.6M3 2.6V5h2.4M8 5.4V8l1.8 1.2',
  send: 'M8 12.6V3.4M4.4 7L8 3.4 11.6 7',
  paperclip: 'M12.4 7.4l-4.6 4.6a2.6 2.6 0 0 1-3.7-3.7l4.8-4.8a1.8 1.8 0 0 1 2.5 2.5L6.7 10.7a.9.9 0 0 1-1.3-1.3l4.2-4.2',
  command: 'M5.6 5.6h4.8v4.8H5.6zM5.6 5.6V4.4a1.2 1.2 0 1 0-1.2 1.2zM10.4 5.6h1.2a1.2 1.2 0 1 0-1.2-1.2zM10.4 10.4v1.2a1.2 1.2 0 1 0 1.2-1.2zM5.6 10.4H4.4a1.2 1.2 0 1 0 1.2 1.2z',
  import: 'M8 2.8v6.4M5.2 6.6L8 9.4l2.8-2.8M3.2 9.6v3.2h9.6V9.6',
  wand: 'M3 13l7-7M9.4 4.2l2.4 2.4M11.8 2.4v1.8M10.9 3.3h1.8M13 6.6v1.4M12.3 7.3h1.4M6 2.8v1.4M5.3 3.5h1.4',
  home: 'M2.8 7.6L8 3l5.2 4.6M4.4 6.6v6.2h7.2V6.6',
  database: 'M3.4 4.6c0-1 2-1.8 4.6-1.8s4.6.8 4.6 1.8-2 1.8-4.6 1.8-4.6-.8-4.6-1.8zM3.4 4.6v6.8c0 1 2 1.8 4.6 1.8s4.6-.8 4.6-1.8V4.6M3.4 8c0 1 2 1.8 4.6 1.8s4.6-.8 4.6-1.8',
  cpu: 'M5 5h6v6H5zM6.6 2.8V5M9.4 2.8V5M6.6 11v2.2M9.4 11v2.2M2.8 6.6H5M2.8 9.4H5M11 6.6h2.2M11 9.4h2.2',
  pin: 'M6 2.8h4l-.6 3.6 2 2.2H4.6l2-2.2zM8 8.6v4.6',
  diff: 'M5 3v10M3 5h4M11 3v4M9 5h4M9 11h4',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, weight = 1.3, className }: { name: IconName | string; size?: number; weight?: number; className?: string }) {
  const d = PATHS[name] ?? PATHS.info;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={d} />
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS);

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg className="bf-brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="var(--fill-primary)" />
      <path d="M16 20h13v6a3.5 3.5 0 1 0 7 0v-6h12v12H16z" fill="var(--deepseek-400)" />
      <path d="M16 35h32v9H16z" fill="var(--label-on-fill)" />
    </svg>
  );
}
