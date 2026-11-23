import React from 'react';
import { Link } from 'react-router-dom';
import type { Theme } from '../utils/types';
import { adminRedirectTarget } from '../utils/adminHost';

interface HeaderProps {
    isAdmin?: boolean;
    currentTheme?: Theme;
    onToggleTheme?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ isAdmin, currentTheme, onToggleTheme }) => {
    const adminTarget = adminRedirectTarget(window.location.hostname);
    return (
        <header className="no-print" style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
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
                        <Link to="/" className="btn" style={{backgroundColor: 'transparent', color: 'var(--color-text-primary)'}}>View Mode</Link>
                        {/* Cloudflare Access endpoint; does not exist under `npm run dev` / local wrangler. */}
                        {!import.meta.env.DEV && (
                            <a href="/cdn-cgi/access/logout" className="btn" style={{backgroundColor: 'transparent', color: 'var(--color-text-primary)'}}>Sign out</a>
                        )}
                        <span style={{padding: '0.5rem', fontWeight: 'bold', color: 'var(--color-primary)'}}>Admin Console</span>
                    </>
                ) : adminTarget ? (
                    // Custom domain: Access does not cover it, so the admin lives on the canonical host.
                    <a href={adminTarget} className="btn" style={{backgroundColor: 'transparent', color: 'var(--color-text-secondary)'}}>Admin</a>
                ) : (
                    <Link to="/admin" className="btn" style={{backgroundColor: 'transparent', color: 'var(--color-text-secondary)'}}>Admin</Link>
                )}
            </nav>
        </header>
    );
};
