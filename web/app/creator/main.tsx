import { createRoot } from 'react-dom/client';
import { CreatorPage } from './creator-page';

const root = document.querySelector('#creator-root');
if (root) createRoot(root).render(<CreatorPage />);
