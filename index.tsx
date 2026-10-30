import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SessionGate from './components/auth/SessionGate';
import { installSessionGuard } from './services/authService';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Session expirée (401) ou page restaurée depuis le cache après déconnexion : retour à la connexion
installSessionGuard();

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <SessionGate>
      <App />
    </SessionGate>
  </React.StrictMode>
);
