import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// il service worker rende l'app disponibile offline (solo in HTTPS o su localhost)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* non disponibile */ }); });
}
