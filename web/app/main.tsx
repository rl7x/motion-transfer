import { createRoot } from 'react-dom/client';
import { App } from './app';

const root = document.getElementById('root');
if (!root) throw Error('Application root is missing');
createRoot(root).render(<App />);
