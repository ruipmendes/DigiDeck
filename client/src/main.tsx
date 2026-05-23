import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// One-time migration of localStorage keys from the previous project name.
// Safe to run on every load: skips if the new key already exists.
const KEY_RENAMES: Array<[string, string]> = [
  ['ancient-crown:token',       'digi-deck:token'],
  ['ancient-crown:ws_url',      'digi-deck:ws_url'],
  ['ancient-crown:active_page', 'digi-deck:active_page'],
];
for (const [oldKey, newKey] of KEY_RENAMES) {
  if (localStorage.getItem(newKey) !== null) continue;
  const v = localStorage.getItem(oldKey);
  if (v !== null) {
    localStorage.setItem(newKey, v);
    localStorage.removeItem(oldKey);
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
