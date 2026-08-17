import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { getRouterBasename } from './lib/routerBasename.js';
import './styles/caratdesk.css';

const hasSession =
  localStorage.getItem('cd_pp_key') ||
  localStorage.getItem('cd_pc_key') ||
  localStorage.getItem('cd_api_key');

if (!hasSession) {
  window.location.replace('/caratdesk-login?logout=1');
} else {
  const active = localStorage.getItem('cd_active_instance') || 'PP';
  const key =
    active === 'PC'
      ? localStorage.getItem('cd_pc_key')
      : localStorage.getItem('cd_pp_key');
  const secret =
    active === 'PC'
      ? localStorage.getItem('cd_pc_secret')
      : localStorage.getItem('cd_pp_secret');
  if (key && secret) {
    localStorage.setItem('cd_api_key', key);
    localStorage.setItem('cd_api_secret', secret);
  }
}

const basename = getRouterBasename();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
