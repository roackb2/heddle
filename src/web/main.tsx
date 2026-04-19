import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tailwind.css';
import { ControlPlaneApp } from './features/control-plane/ControlPlaneApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ControlPlaneApp />
  </StrictMode>,
);
