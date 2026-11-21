import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkError } from '../lib/recover';

type Props = {
  children: ReactNode;
  /** Cuando cambia (p. ej., la pantalla), se olvida el error y se vuelve a intentar. */
  resetKey?: unknown;
  /** Qué mostrar si algo falla. Por defecto, `ScreenError`. */
  fallback?: (error: Error, retry: () => void) => ReactNode;
  onError?: (error: Error) => void;
};
type State = { error: Error | null };

/**
 * Atrapa los errores de lo que envuelve para que un fallo no desmonte toda la app (sin esto React deja la página
 * vacía: la pantalla "en negro"). Ver lib/recover.ts.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[igv] error atrapado', error, info.componentStack);
    this.props.onError?.(error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) this.setState({ error: null });
  }

  retry = () => {
    // Una pantalla cuyo archivo no se pudo descargar queda marcada como fallida: solo recargar la arregla.
    if (this.state.error && isChunkError(this.state.error)) window.location.reload();
    else this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return this.props.fallback ? this.props.fallback(error, this.retry) : <ScreenError error={error} retry={this.retry} />;
  }
}

/** Aviso cuando una pantalla no se pudo abrir: qué pasó y cómo salir. */
export function ScreenError({ error, retry }: { error: Error; retry: () => void }) {
  const chunk = isChunkError(error);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const [title, text] = chunk
    ? offline
      ? ['Sin conexión', 'Esta pantalla aún no estaba guardada en tu teléfono. Conéctate y vuelve a intentar.']
      : ['Hay una versión nueva de la app', 'Recarga para abrir esta pantalla. Tus registros están guardados en este dispositivo.']
    : ['No se pudo abrir esta pantalla', 'Algo falló al mostrarla. Tus registros están a salvo; intenta de nuevo o vuelve a Hoy.'];
  return (
    <div className="card screen-error" role="alert">
      <h2>{title}</h2>
      <p className="muted">{text}</p>
      <div className="row wrap">
        <button className="btn primary" onClick={retry}>
          {chunk ? 'Recargar' : 'Intentar de nuevo'}
        </button>
        <button className="btn" onClick={() => window.location.assign('/')}>
          Ir a Hoy
        </button>
      </div>
      <details>
        <summary className="small muted">Detalle</summary>
        <code className="small">{error.message || String(error)}</code>
      </details>
    </div>
  );
}

/** Si algo falla fuera de las pantallas (la navegación misma), una página para recuperarse en vez del fondo vacío. */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(error, retry) => (
        <div className="main fatal-error">
          <ScreenError error={error} retry={isChunkError(error) ? retry : () => window.location.reload()} />
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
