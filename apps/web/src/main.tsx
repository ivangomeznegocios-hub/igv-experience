import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initStore } from './data/store';
import { installRecovery } from './lib/recover';
import { applyTheme } from './lib/theme';
import { AppErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';

applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
installRecovery();
initStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
