import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/theme.css';
import './styles/layout.css';
import './styles/landing.css';

// main starts here: render the app into the root element,
// wrapped in StrictMode for highlighting potential issues in development. 
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
