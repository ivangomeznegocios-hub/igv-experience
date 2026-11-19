import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initStore } from './data/store';
import { applyTheme } from './lib/theme';
import './styles.css';

applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
initStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
