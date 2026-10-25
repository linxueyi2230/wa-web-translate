import '../shared/generated/haomai.css';
import '../shared/ui/theme.css';
import { initializeTheme } from '../shared/ui/theme';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HaomaiApp } from './HaomaiApp';
import './styles.css';

initializeTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HaomaiApp />
  </StrictMode>,
);
