import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
  /** Shown small inside a panel instead of filling the window. */
  compact?: boolean;
  /** A change of this value clears the error, e.g. when another tab is chosen. */
  resetKey?: string;
}

interface State {
  error?: Error;
  stack?: string;
}

/**
 * Keeps one failing part of the interface from blanking the whole window:
 * the error is shown where it happened, with a way to try again.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
    this.setState({ stack: info.componentStack ?? undefined });
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: undefined, stack: undefined });
  }

  override render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={`error-panel${this.props.compact ? ' compact' : ''}`} role="alert" data-testid="error-panel">
        <Icon name="warning" size={20} />
        <div className="title">{t('error.title')}</div>
        <div className="muted">{t('error.message')}</div>
        <div className="row gap-6">
          <button className="btn sm primary" onClick={() => this.setState({ error: undefined, stack: undefined })} data-testid="error-retry">
            {t('error.retry')}
          </button>
          <button className="btn sm outline" onClick={() => window.location.reload()}>
            {t('error.reload')}
          </button>
        </div>
        <details>
          <summary>{t('error.details')}</summary>
          <pre className="selectable">
            {String(error.message || error)}
            {error.stack ? `\n\n${error.stack.split('\n').slice(0, 8).join('\n')}` : ''}
            {stack ? `\n${stack.split('\n').slice(0, 8).join('\n')}` : ''}
          </pre>
        </details>
      </div>
    );
  }
}
