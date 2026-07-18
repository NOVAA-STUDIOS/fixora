import { Button } from '@fixora/ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The last line of defence for the renderer.
 *
 * Without one of these, a single uncaught render error unmounts the entire React tree and leaves a
 * blank window: no menu, no way back, nothing to do but force-quit. That is a realistic failure here
 * rather than a theoretical one — the renderer displays *other people's source code*, and the panels
 * around it derive layout, decorations and details from analyzer output whose shape comes from
 * external tools. A malformed finding should cost the user one panel, not the application.
 *
 * It deliberately does **not** try to be clever about recovery. `reset` re-mounts the subtree, which
 * fixes a transient error and visibly fails again on a deterministic one — better than a retry loop
 * that hides a real bug. Reload is the escape hatch when the state itself is the problem.
 *
 * A class component because that is the only way React exposes this; there is no hook equivalent.
 */

interface Props {
  children: ReactNode;
  /** Names the area that failed, so the message can say what is broken rather than "something". */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack is what makes this diagnosable at all. It goes to the console, which in a
    // packaged build is the DevTools the user can open — never to a network endpoint, since this
    // payload can contain fragments of the user's code (Security §9, local-first).
    console.error('[renderer] unhandled error', {
      area: this.props.label ?? 'application',
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  private readonly reload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    const area = this.props.label ?? 'Fixora';

    return (
      <div
        role="alert"
        className="flex h-full min-w-0 flex-col items-center justify-center gap-3 bg-canvas p-6 text-center"
      >
        <p className="text-sm font-medium text-fg">{area} stopped responding</p>
        <p className="max-w-sm text-xs leading-relaxed text-fg-muted">
          Something went wrong while drawing this view. Your files and history are on disk and were
          not touched — nothing has been written.
        </p>
        {/* The message, not a stack trace: enough for a bug report, not a wall of frames. */}
        <p className="max-w-sm font-mono text-[11px] break-words text-danger-text">
          {error.message}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" size="sm" onClick={this.reset}>
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={this.reload}>
            Reload Fixora
          </Button>
        </div>
      </div>
    );
  }
}
