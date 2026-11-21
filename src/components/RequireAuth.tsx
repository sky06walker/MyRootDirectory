import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { verifySession } from '../utils/api';

export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

    useEffect(() => {
        verifySession().then(setIsAuthenticated);
    }, []);

    if (isAuthenticated === null) {
        return <div className="container">Verifying...</div>; // Or a spinner
    }

    if (!isAuthenticated) {
        // Sign-in itself is handled by Cloudflare Access in front of /admin; if we are
        // here the Access session is missing/expired or Access is not configured.
        return (
            <div className="container">
                <h2>Access denied</h2>
                <p>
                    The admin console requires an active Cloudflare Access sign-in. Reload this page to
                    sign in, or <Link to="/">return to the CV</Link>.
                </p>
            </div>
        );
    }

    return children;
};
