import React from 'react';
import ReactDOM from 'react-dom/client';
import { Root } from './Root';
import './index.css';
import * as controller from './state/controller';
import { useStore } from './state/store';

if (import.meta.env.DEV) {
  // dev-only handle for scripted end-to-end checks
  (window as unknown as { __scent: unknown }).__scent = { controller, store: useStore };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
