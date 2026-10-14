import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "../hooks/useTranslation";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Without this a single render error anywhere in the tree tears down the whole React
 * root and the user is left staring at a blank window with no way back.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught error in React tree:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <Fallback error={this.state.error} onReload={() => this.setState({ error: null })} />;
  }
}

function Fallback({ error, onReload }: { error: Error; onReload: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="error-boundary">
      <div className="error-boundary-card">
        <h2>{t("errorBoundaryTitle")}</h2>
        <p>{t("errorBoundaryDesc")}</p>
        <pre className="error-boundary-detail">{error.message}</pre>
        <button className="btn btn-primary" onClick={onReload}>
          {t("errorBoundaryReload")}
        </button>
      </div>
    </div>
  );
}