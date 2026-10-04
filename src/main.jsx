import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import VoirCommeTab from './components/VoirCommeTab.jsx';
import { isVoirCommeTab } from './lib/supabase';
import './index.css';

// A data router, for useBlocker() (the admin's unsaved-changes guard, #150). App keeps declaring
// its own <Routes> under the one catch-all route. A « Voir comme » tab (#267) runs the same app
// inside its shell, which opens the member's read-only session first.
const router = createBrowserRouter([{ path: '*', element: isVoirCommeTab ? <VoirCommeTab><App /></VoirCommeTab> : <App /> }]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
