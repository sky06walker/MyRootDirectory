
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

interface HeaderProps {
    isAdmin?: boolean;
    currentTheme?: 'modern' | 'custom';
    onToggleTheme?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ isAdmin, currentTheme, onToggleTheme }) => {
    const navigate = useNavigate();

    const handleLogout = async (e: React.MouseEvent) => {
        e.preventDefault();
        try {
            await fetch('/api/logout', { method: 'POST' });
            navigate('/');
        } catch (error) {
            console.error('Logout failed:', error);
            navigate('/');
        }
    };

    return (
        <header style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to="/" style={{ fontWeight: 'bold', fontSize: '1.2rem', color: 'var(--color-text-primary)', textDecoration: 'none' }}>
                My Root Directory
            </Link>
            <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                {onToggleTheme && (
                    <button onClick={onToggleTheme} className="btn" style={{ fontSize: '0.8rem', backgroundColor: 'transparent', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)' }}>
                        Theme: {currentTheme === 'modern' ? 'Modern' : 'Custom'}
                    </button>
                )}
                
                {isAdmin ? (
                    <>
                        <a href="/" onClick={handleLogout} className="btn" style={{backgroundColor: 'transparent', color: 'var(--color-text-primary)', cursor: 'pointer'}}>View Mode</a>
                        <span style={{padding: '0.5rem', fontWeight: 'bold', color: 'var(--color-primary)'}}>Admin Console</span>
                    </>
                ) : (
                    <Link to="/admin" className="btn" style={{backgroundColor: 'transparent', color: 'var(--color-text-secondary)'}}>Admin</Link>
                )}
            </nav>
        </header>
    );
};
