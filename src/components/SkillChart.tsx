
import React from 'react';
import type { Skill } from '../utils/types';

interface SkillChartProps {
    skills: Skill[];
}

export const SkillChart: React.FC<SkillChartProps> = ({ skills }) => {
    return (
        <div style={{ width: '100%', border: '1px solid #ccc', padding: '1rem', boxSizing: 'border-box' }}>
            {skills.map(skill => (
                <div key={skill.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.8rem' }}>
                    <div style={{ width: '150px', paddingRight: '1rem', textAlign: 'right', fontSize: '0.9rem' }}>
                        {skill.name}
                    </div>
                    <div style={{ flex: 1, height: '20px', backgroundColor: '#f0f0f0', position: 'relative', borderLeft: '1px solid #ccc' }}>
                        {/* Bar */}
                        <div style={{
                            width: `${skill.level || 0}%`,
                            height: '100%',
                            background: 'linear-gradient(to right, #ffffff, #93c5fd)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            paddingRight: '0.5rem',
                            boxSizing: 'border-box'
                        }}>
                             <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{skill.level}%</span>
                        </div>
                        {/* Vertical Grid Lines for visual reference (optional) */}
                        <div style={{position: 'absolute', top: 0, bottom: 0, left: '50%', borderLeft: '1px solid #eee', width: '1px'}}></div>
                        <div style={{position: 'absolute', top: 0, bottom: 0, left: '75%', borderLeft: '1px solid #eee', width: '1px'}}></div>
                    </div>
                </div>
            ))}
        </div>
    );
};
