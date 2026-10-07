import React from 'react';
import ReactDOM from 'react-dom/client';
import { Root } from './Root';
import { loadPublishedServer } from './api/server';
import './index.css';
import * as controller from './state/controller';
import { useStore } from './state/store';

if (import.meta.env.DEV) {
  // dev-only handle for scripted end-to-end checks
  (window as unknown as { __scent: unknown }).__scent = { controller, store: useStore };
}

// keep the app usable with no signal once it has been opened online (public/sw.js)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// learn where the server is (if one is published) before the first page asks
loadPublishedServer().finally(() =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  ),
);
