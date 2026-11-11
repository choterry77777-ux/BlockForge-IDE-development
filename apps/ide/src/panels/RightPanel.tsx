import { ChatPane } from '../ai/ChatPane';
import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { type RightTab, useSettings } from '../state/settings';
import { BrowserPane } from './BrowserPane';
import { ComparePane } from './ComparePane';
import { PackagesPane } from './PackagesPane';
import { PreviewPane } from './PreviewPane';
import { ToolchainsPane } from './ToolchainsPane';
import { ToolsPane } from './ToolsPane';

export const RIGHT_TABS: { id: RightTab; icon: string }[] = [
  { id: 'assistant', icon: 'sparkle' },
  { id: 'compare', icon: 'compare' },
  { id: 'preview', icon: 'eye' },
  { id: 'browser', icon: 'globe' },
  { id: 'tools', icon: 'tools' },
  { id: 'packages', icon: 'package' },
  { id: 'toolchains', icon: 'toolchain' },
];

export function RightPanel() {
  const tab = useSettings((s) => s.layout.rightTab);
  const set = (rightTab: RightTab) => useSettings.getState().update({ layout: { rightTab } });
  return (
    <div className="col grow" data-testid="right-panel">
      <div className="bf-header" style={{ padding: '0 6px' }}>
        <div className="tabs scroll" style={{ overflowY: 'hidden' }}>
          {RIGHT_TABS.map((x) => (
            <button key={x.id} className={`tab ${tab === x.id ? 'active' : ''}`} onClick={() => set(x.id)} title={t(`right.${x.id}`)} data-testid={`right-${x.id}`}>
              <Icon name={x.icon} size={14} />
              {tab === x.id && t(`right.${x.id}`)}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn sm icon" title={t('right.hide')} onClick={() => useSettings.getState().update({ layout: { rightOpen: false } })}>
          <Icon name="chevronRight" size={14} />
        </button>
      </div>
      {/* The assistant and the browser stay mounted so a conversation or page survives tab switches. */}
      <div className={`col grow ${tab === 'assistant' ? '' : 'hidden'}`}>
        <ChatPane />
      </div>
      <div className={`col grow ${tab === 'browser' ? '' : 'hidden'}`}>
        <BrowserPane visible={tab === 'browser'} />
      </div>
      {tab === 'compare' && <ComparePane />}
      {tab === 'preview' && <PreviewPane />}
      {tab === 'tools' && <ToolsPane />}
      {tab === 'packages' && <PackagesPane />}
      {tab === 'toolchains' && <ToolchainsPane />}
    </div>
  );
}
