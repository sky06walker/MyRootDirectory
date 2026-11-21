import React, { useEffect, useId, useState } from 'react';
import { INITIAL_CV_DATA, type CVData, type Theme } from '../utils/types';
import { fetchCVData, saveCVData } from '../utils/api';
import { Header } from '../components/Header';

interface AdminProps {
    theme?: Theme;
}

type ListKey = 'experience' | 'education' | 'skills' | 'languages' | 'certifications';
type ListItem<K extends ListKey> = CVData[K][number];

const PROFICIENCY_LEVELS = ['Native', 'Fluent', 'Advanced', 'Intermediate', 'Basic'];

const Field: React.FC<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    rows?: number;
}> = ({ label, value, onChange, rows }) => {
    const id = useId();
    return (
        <div className="form-group">
            <label className="form-label" htmlFor={id}>{label}</label>
            {rows
                ? <textarea id={id} className="form-textarea" rows={rows} value={value} onChange={e => onChange(e.target.value)} />
                : <input id={id} className="form-input" value={value} onChange={e => onChange(e.target.value)} />}
        </div>
    );
};

const SectionHeader: React.FC<{ title: string; onAdd: () => void }> = ({ title, onAdd }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3>{title}</h3>
        <button className="btn" onClick={onAdd} style={{ fontSize: '0.8rem' }}>+ Add</button>
    </div>
);

const RemoveButton: React.FC<{
    label: string;
    onClick: () => void;
    style?: React.CSSProperties;
    children: React.ReactNode;
}> = ({ label, onClick, style, children }) => (
    <button
        onClick={onClick}
        aria-label={label}
        style={{ color: 'red', background: 'none', border: 'none', ...style }}
    >
        {children}
    </button>
);

export const Admin: React.FC<AdminProps> = ({ theme }) => {
    const [cv, setCv] = useState<CVData>(INITIAL_CV_DATA);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchCVData().then(data => {
            setCv(data);
            setLoading(false);
        });
    }, []);

    const handleSave = async () => {
        setSaving(true);
        const result = await saveCVData(cv);
        setSaving(false);
        if (result === 'ok') {
            alert('Saved successfully!');
        } else if (result === 'unauthorized') {
            // Keep this page (and the unsaved edits). The Cloudflare Access session
            // cookie is shared across tabs, so signing in elsewhere is enough.
            alert('Your sign-in has expired. Open /admin in a new tab to sign in again, then click Save here again. Your edits on this page are kept.');
        } else {
            // Stay on the page so the unsaved edits are not lost.
            alert('Failed to save. Please try again.');
        }
    };

    const updateProfile = (field: keyof CVData['profile'], value: string) => {
        setCv(prev => ({ ...prev, profile: { ...prev.profile, [field]: value } }));
    };

    const updateContact = (field: keyof CVData['contact'], value: string) => {
        setCv(prev => ({ ...prev, contact: { ...prev.contact, [field]: value } }));
    };

    // Generic helpers for the list sections (experience, education, skills, ...)
    const addItem = <K extends ListKey>(key: K, item: ListItem<K>, atStart = false) => {
        setCv(prev => {
            const list = prev[key] as ListItem<K>[];
            return { ...prev, [key]: atStart ? [item, ...list] : [...list, item] };
        });
    };
    const removeItem = (key: ListKey, id: string) => {
        setCv(prev => ({
            ...prev,
            [key]: (prev[key] as { id: string }[]).filter(item => item.id !== id),
        }));
    };
    const updateItem = <K extends ListKey, F extends keyof ListItem<K>>(
        key: K, id: string, field: F, value: ListItem<K>[F],
    ) => {
        setCv(prev => ({
            ...prev,
            [key]: (prev[key] as { id: string }[]).map(item =>
                item.id === id ? { ...item, [field]: value } : item),
        }));
    };

    const newId = () => crypto.randomUUID();

    if (loading) return <div className="container">Loading...</div>;

    return (
        <div className="container" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
            <Header isAdmin currentTheme={theme} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h1>Admin Console</h1>
                <button className="btn" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>

            <div className="card">
                <h3>Profile</h3>
                <div className="form-group">
                    <label className="form-label">Photo</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        {cv.profile.photo && <img src={cv.profile.photo} alt="Profile" style={{ width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover' }} />}
                        <input type="file" accept="image/*" onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    updateProfile('photo', reader.result as string);
                                };
                                reader.readAsDataURL(file);
                            }
                        }} />
                    </div>
                </div>
                <Field label="Name" value={cv.profile.name} onChange={v => updateProfile('name', v)} />
                <Field label="Title" value={cv.profile.title} onChange={v => updateProfile('title', v)} />
                <Field label="Summary" rows={3} value={cv.profile.summary} onChange={v => updateProfile('summary', v)} />
                <Field label="Location" value={cv.profile.location} onChange={v => updateProfile('location', v)} />
                <Field label="Address" rows={3} value={cv.profile.address || ''} onChange={v => updateProfile('address', v)} />
                <Field label="Website URL" value={cv.profile.url} onChange={v => updateProfile('url', v)} />
                <Field label="GitHub URL" value={cv.contact.github || ''} onChange={v => updateContact('github', v)} />
            </div>

            <div className="card">
                <h3>Contact</h3>
                <Field label="Email" value={cv.contact.email} onChange={v => updateContact('email', v)} />
                <Field label="Phone" value={cv.contact.phone} onChange={v => updateContact('phone', v)} />
            </div>

            <div className="card">
                <SectionHeader title="Experience" onAdd={() => addItem('experience', { id: newId(), company: '', role: '', startDate: '', endDate: '', description: '' }, true)} />
                {cv.experience.map(exp => (
                    <div key={exp.id} style={{ padding: '1rem', border: '1px solid var(--color-border)', marginBottom: '1rem', borderRadius: 'var(--radius)' }}>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <div style={{ flex: 1 }}>
                                <input placeholder="Company" aria-label="Company" className="form-input" style={{ marginBottom: '1rem' }} value={exp.company} onChange={e => updateItem('experience', exp.id, 'company', e.target.value)} />
                                <input placeholder="Role" aria-label="Role" className="form-input" style={{ marginBottom: '1rem' }} value={exp.role} onChange={e => updateItem('experience', exp.id, 'role', e.target.value)} />
                                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                                    <input placeholder="Start Date" aria-label="Start Date" className="form-input" value={exp.startDate} onChange={e => updateItem('experience', exp.id, 'startDate', e.target.value)} />
                                    <input placeholder="End Date" aria-label="End Date" className="form-input" value={exp.endDate} onChange={e => updateItem('experience', exp.id, 'endDate', e.target.value)} />
                                </div>
                                <textarea placeholder="Description" aria-label="Description" className="form-textarea" rows={3} value={exp.description} onChange={e => updateItem('experience', exp.id, 'description', e.target.value)} />
                            </div>
                            <RemoveButton label="Remove experience" onClick={() => removeItem('experience', exp.id)} style={{ alignSelf: 'flex-start' }}>X</RemoveButton>
                        </div>
                    </div>
                ))}
            </div>

            <div className="card">
                <SectionHeader title="Education" onAdd={() => addItem('education', { id: newId(), institution: '', degree: '', year: '' }, true)} />
                {cv.education.map(edu => (
                    <div key={edu.id} style={{ padding: '1rem', border: '1px solid var(--color-border)', marginBottom: '1rem', borderRadius: 'var(--radius)' }}>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <div style={{ flex: 1 }}>
                                <input placeholder="Institution" aria-label="Institution" className="form-input" style={{ marginBottom: '1rem' }} value={edu.institution} onChange={e => updateItem('education', edu.id, 'institution', e.target.value)} />
                                <input placeholder="Degree" aria-label="Degree" className="form-input" style={{ marginBottom: '1rem' }} value={edu.degree} onChange={e => updateItem('education', edu.id, 'degree', e.target.value)} />
                                <input placeholder="Year" aria-label="Year" className="form-input" value={edu.year} onChange={e => updateItem('education', edu.id, 'year', e.target.value)} />
                            </div>
                            <RemoveButton label="Remove education" onClick={() => removeItem('education', edu.id)} style={{ alignSelf: 'flex-start' }}>X</RemoveButton>
                        </div>
                    </div>
                ))}
            </div>

            <div className="card">
                <SectionHeader title="Skills" onAdd={() => addItem('skills', { id: newId(), name: '', category: 'other' })} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                    {cv.skills.map(skill => (
                        <div key={skill.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--color-border)', padding: '0.5rem', borderRadius: '1rem' }}>
                            <input
                                className="form-input"
                                style={{ border: 'none', padding: '0.25rem', width: '150px' }}
                                value={skill.name}
                                onChange={e => updateItem('skills', skill.id, 'name', e.target.value)}
                                placeholder="Skill Name"
                                aria-label="Skill name"
                            />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', borderLeft: '1px solid #ddd', paddingLeft: '0.5rem' }}>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    className="form-input"
                                    style={{ border: 'none', padding: '0.25rem', width: '60px', textAlign: 'right' }}
                                    value={skill.level ?? 0}
                                    onChange={e => updateItem('skills', skill.id, 'level', parseInt(e.target.value) || 0)}
                                    placeholder="%"
                                    aria-label="Skill level percent"
                                />
                                <span style={{ fontSize: '0.8rem', color: '#666' }}>%</span>
                            </div>
                            <RemoveButton label="Remove skill" onClick={() => removeItem('skills', skill.id)} style={{ marginLeft: '0.5rem', cursor: 'pointer' }}>&times;</RemoveButton>
                        </div>
                    ))}
                </div>
            </div>

            <div className="card">
                <SectionHeader title="Languages" onAdd={() => addItem('languages', { id: newId(), language: '', proficiency: '' })} />
                {cv.languages.map(lang => (
                    <div key={lang.id} style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                        <input className="form-input" placeholder="Language" aria-label="Language" value={lang.language} onChange={e => updateItem('languages', lang.id, 'language', e.target.value)} />
                        <select
                            className="form-input"
                            aria-label="Proficiency"
                            value={lang.proficiency}
                            onChange={e => updateItem('languages', lang.id, 'proficiency', e.target.value)}
                        >
                            <option value="">Select Proficiency</option>
                            {PROFICIENCY_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
                            {lang.proficiency && !PROFICIENCY_LEVELS.includes(lang.proficiency) && (
                                <option value={lang.proficiency}>{lang.proficiency}</option>
                            )}
                        </select>
                        <RemoveButton label="Remove language" onClick={() => removeItem('languages', lang.id)}>&times;</RemoveButton>
                    </div>
                ))}
            </div>

            <div className="card">
                <SectionHeader title="Certifications" onAdd={() => addItem('certifications', { id: newId(), name: '', year: '' })} />
                {cv.certifications.map(cert => (
                    <div key={cert.id} style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                        <input className="form-input" placeholder="Certification Name" aria-label="Certification name" value={cert.name} onChange={e => updateItem('certifications', cert.id, 'name', e.target.value)} />
                        <input className="form-input" placeholder="Year" aria-label="Certification year" value={cert.year} onChange={e => updateItem('certifications', cert.id, 'year', e.target.value)} />
                        <RemoveButton label="Remove certification" onClick={() => removeItem('certifications', cert.id)}>&times;</RemoveButton>
                    </div>
                ))}
            </div>
        </div>
    );
};
