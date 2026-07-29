import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { AppMessageCenter } from './components/AppMessageCenter.jsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <AppMessageCenter />
  </StrictMode>
);
