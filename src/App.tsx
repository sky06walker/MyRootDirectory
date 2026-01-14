import { useEffect, useState } from 'react';

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Admin } from './pages/Admin';

import { RequireAuth } from './components/RequireAuth';

function AppContent() {
    const [theme, setTheme] = useState<'modern' | 'custom'>(() => {
        const params = new URLSearchParams(window.location.search);
        const urlTheme = params.get('theme');
        if (urlTheme === 'modern' || urlTheme === 'custom') return urlTheme;
        return (localStorage.getItem('theme') as 'modern' | 'custom') || 'modern';
    });


    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'modern' ? 'custom' : 'modern');
    };

    // Pass theme props to children if needed, or context. 
    // For now passing to Home is enough as Admin might just need structure but nice to have consistent theme.
    
    return (
        <Routes>
            <Route path="/" element={<Home theme={theme} toggleTheme={toggleTheme} />} />
            <Route path="/login" element={<Login />} />
            <Route path="/admin" element={
                <RequireAuth>
                    <Admin theme={theme} />
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
