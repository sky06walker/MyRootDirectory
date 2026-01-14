
import React, { type ReactNode } from 'react';

interface CVSectionProps {
    title: string;
    children: ReactNode;
}

export const CVSection: React.FC<CVSectionProps> = ({ title, children }) => {
    return (
        <section className="card" style={{ marginBottom: '2rem' }}>
            <h2 style={{ paddingBottom: '0.5rem', borderBottom: '1px solid var(--color-border)', marginBottom: '1rem', color: 'var(--color-primary)' }}>
                {title}
            </h2>
            {children}
        </section>
    );
};
