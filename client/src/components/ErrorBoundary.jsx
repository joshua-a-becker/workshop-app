import React from "react";

// Diagnostic error boundary.
//
// Without a boundary, any thrown render error (e.g. a transient null scope on a
// cold reconnect: `player.stage` undefined, `game.treatment` undefined) makes
// React 18 unmount the whole root, leaving an empty `#root` — the "grey/blank
// page" with no spinner and no message. This boundary captures that throw and
// renders the actual error + stack + component stack on screen, so a crash is
// diagnosable without needing console access. It deliberately does NOT swallow
// or "fix" the error — it surfaces it.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Loud, tagged log so it sits alongside the existing [DIAG] breadcrumbs.
    console.error("[DIAG][error] render crash caught by ErrorBoundary", {
      label: this.props.label,
      message: error?.message,
      stack: error?.stack,
      componentStack: info?.componentStack,
    });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const ns =
      new URLSearchParams(window.location.search).get("participantKey") || "(none)";

    return (
      <div className="min-h-screen w-full bg-gray-900 text-gray-100 p-6 overflow-auto">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold text-red-400 mb-1">
            Something crashed
          </h1>
          <p className="text-sm text-gray-400 mb-4">
            The page failed to render. Details below (also logged to the console
            as <code>[DIAG][error]</code>).
          </p>

          <div className="mb-4 text-xs text-gray-400">
            <span className="mr-4">boundary: {this.props.label || "app"}</span>
            <span>participantKey: {ns}</span>
          </div>

          <div className="mb-4">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
              Error
            </div>
            <pre className="bg-black/50 rounded p-3 text-sm text-red-300 whitespace-pre-wrap break-words">
              {String(error?.message || error)}
            </pre>
          </div>

          {error?.stack && (
            <div className="mb-4">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Stack
              </div>
              <pre className="bg-black/50 rounded p-3 text-xs text-gray-300 whitespace-pre-wrap break-words">
                {error.stack}
              </pre>
            </div>
          )}

          {info?.componentStack && (
            <div className="mb-4">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Component stack
              </div>
              <pre className="bg-black/50 rounded p-3 text-xs text-gray-300 whitespace-pre-wrap break-words">
                {info.componentStack}
              </pre>
            </div>
          )}

          <button
            onClick={() => window.location.reload()}
            className="mt-2 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
