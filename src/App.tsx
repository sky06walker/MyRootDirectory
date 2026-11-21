import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { RequireAuth } from './components/RequireAuth';
import type { Theme } from './utils/types';

// The admin console is only for the owner: keep it out of the public page's JavaScript.
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));

const isTheme = (value: unknown): value is Theme =>
    value === 'modern' || value === 'custom';

// URL param wins (used by shared links), then the saved preference.
// localStorage can throw (blocked storage / private mode), so guard it.
function getInitialTheme(): Theme {
    const fromUrl = new URLSearchParams(window.location.search).get('theme');
    if (isTheme(fromUrl)) return fromUrl;
    try {
        const stored = localStorage.getItem('theme');
        if (isTheme(stored)) return stored;
    } catch { /* ignore */ }
    return 'modern';
}

function AppContent() {
    const [theme, setTheme] = useState<Theme>(getInitialTheme);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        try {
            localStorage.setItem('theme', theme);
        } catch { /* ignore */ }
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'modern' ? 'custom' : 'modern');
    };

    return (
        <Routes>
            <Route path="/" element={<Home theme={theme} toggleTheme={toggleTheme} />} />
            {/* Old bookmark: the password login page no longer exists (Cloudflare Access handles sign-in). */}
            <Route path="/login" element={<Navigate to="/admin" replace />} />
            <Route path="/admin" element={
                <RequireAuth>
                    <Suspense fallback={<div className="container">Loading...</div>}>
                        <Admin theme={theme} />
                    </Suspense>
                </RequireAuth>
            } />
        </Routes>
    );
}

function App() {
  return (
    <Router>
        <AppContent />
    </Router>
  );
}

export default App;
