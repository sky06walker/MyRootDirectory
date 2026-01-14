
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { INITIAL_CV_DATA, type CVData, type Experience, type Education, type Skill, type Language, type Certification } from '../utils/types';
import { fetchCVData, saveCVData, changePassword } from '../utils/api';
import { Header } from '../components/Header';

interface AdminProps {
    theme?: 'modern' | 'custom';
}

export const Admin: React.FC<AdminProps> = ({ theme }) => {
    const navigate = useNavigate();
    const [cv, setCv] = useState<CVData>(INITIAL_CV_DATA);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    // Password Change State
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [pwdData, setPwdData] = useState({ current: '', new: '', confirm: '' });
    const [pwdError, setPwdError] = useState('');
    const [pwdSuccess, setPwdSuccess] = useState('');

    useEffect(() => {
        fetchCVData().then(data => {
            setCv(data);
            setLoading(false);
        });
    }, []);

    const handleChangePassword = async () => {
        setPwdError('');
        setPwdSuccess('');
        if (!pwdData.current || !pwdData.new || !pwdData.confirm) {
            setPwdError("All fields are required");
            return;
        }
        if (pwdData.new !== pwdData.confirm) {
            setPwdError("New passwords do not match");
            return;
        }
        if (pwdData.new.length < 6) {
            setPwdError("New password must be at least 6 characters");
            return;
        }

        const res = await changePassword(pwdData.current, pwdData.new);
        if (res.success) {
            setPwdSuccess("Password changed successfully!");
            setPwdData({ current: '', new: '', confirm: '' });
            setTimeout(() => {
                setShowPasswordModal(false);
                setPwdSuccess('');
            }, 1500);
        } else {
            setPwdError(res.error || "Failed to change password");
        }
    };

    const handleSave = async (dataToSave?: CVData) => {
        setSaving(true);
        const success = await saveCVData(dataToSave || cv);
        setSaving(false);
        if (success) {
            alert('Saved successfully!');
            // If we reset, update local state too
            if (dataToSave) setCv(dataToSave);
        } else {
            alert('Failed to save. You might be logged out.');
            navigate('/login');
        }
    };

    const updateProfile = (field: keyof typeof cv.profile, value: string) => {
        setCv(prev => ({ ...prev, profile: { ...prev.profile, [field]: value } }));
    };

    const updateContact = (field: keyof typeof cv.contact, value: string) => {
        setCv(prev => ({ ...prev, contact: { ...prev.contact, [field]: value } }));
    };

    // Experience Helpers
    const addExperience = () => {
        const newExp: Experience = { id: Date.now().toString(), company: '', role: '', startDate: '', endDate: '', description: '' };
        setCv(prev => ({ ...prev, experience: [newExp, ...prev.experience] }));
    };
    const removeExperience = (id: string) => {
        setCv(prev => ({ ...prev, experience: prev.experience.filter(e => e.id !== id) }));
    };
    const updateExperience = (id: string, field: keyof Experience, value: string) => {
        setCv(prev => ({
            ...prev,
            experience: prev.experience.map(e => e.id === id ? { ...e, [field]: value } : e)
        }));
    };

    // Education Helpers
    const addEducation = () => {
        const newEdu: Education = { id: Date.now().toString(), institution: '', degree: '', year: '' };
        setCv(prev => ({ ...prev, education: [newEdu, ...prev.education] }));
    };
    const removeEducation = (id: string) => {
        setCv(prev => ({ ...prev, education: prev.education.filter(e => e.id !== id) }));
    };
    const updateEducation = (id: string, field: keyof Education, value: string) => {
        setCv(prev => ({
            ...prev,
            education: prev.education.map(e => e.id === id ? { ...e, [field]: value } : e)
        }));
    };

    // Skill Helpers
    const addSkill = () => {
        const newSkill: Skill = { id: Date.now().toString(), name: '', category: 'other' };
        setCv(prev => ({ ...prev, skills: [...prev.skills, newSkill] }));
    };
    const removeSkill = (id: string) => {
        setCv(prev => ({ ...prev, skills: prev.skills.filter(s => s.id !== id) }));
    };
    const updateSkill = (id: string, field: keyof Skill, value: string | number) => {
        setCv(prev => ({
            ...prev,
            skills: prev.skills.map(s => s.id === id ? { ...s, [field]: value } : s)
        }));
    };

    // Language Helpers
    const addLanguage = () => {
        const newLang: Language = { id: Date.now().toString(), language: '', proficiency: '' };
        setCv(prev => ({ ...prev, languages: [...prev.languages || [], newLang] }));
    };
    const removeLanguage = (id: string) => {
        setCv(prev => ({ ...prev, languages: prev.languages.filter(l => l.id !== id) }));
    };
    const updateLanguage = (id: string, field: keyof Language, value: string) => {
        setCv(prev => ({
            ...prev,
            languages: prev.languages.map(l => l.id === id ? { ...l, [field]: value } : l)
        }));
    };

    // Certification Helpers
    const addCertification = () => {
        const newCert: Certification = { id: Date.now().toString(), name: '', year: '' };
        setCv(prev => ({ ...prev, certifications: [...prev.certifications || [], newCert] }));
    };
    const removeCertification = (id: string) => {
        setCv(prev => ({ ...prev, certifications: prev.certifications.filter(c => c.id !== id) }));
    };
    const updateCertification = (id: string, field: keyof Certification, value: string) => {
        setCv(prev => ({
            ...prev,
            certifications: prev.certifications.map(c => c.id === id ? { ...c, [field]: value } : c)
        }));
    };

    if (loading) return <div className="container">Loading...</div>;

    return (
        <div className="container" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
            <Header isAdmin currentTheme={theme} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h1>Admin Console</h1>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="btn" onClick={() => setShowPasswordModal(true)} style={{ backgroundColor: '#4b5563', borderColor: '#4b5563' }}>
                        Change Password
                    </button>
                    <button className="btn" onClick={() => handleSave()} disabled={saving}>
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>

            {/* Change Password Modal */}
            {showPasswordModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
                }}>
                    <div className="card" style={{ width: '90%', maxWidth: '400px', position: 'relative', backgroundColor: 'white', padding: '2rem' }}>
                        <h3 style={{marginTop: 0}}>Change Password</h3>
                        {pwdError && <div style={{color: 'red', marginBottom: '1rem'}}>{pwdError}</div>}
                        {pwdSuccess && <div style={{color: 'green', marginBottom: '1rem'}}>{pwdSuccess}</div>}
                        
                        <div className="form-group">
                            <label className="form-label">Current Password</label>
                            <input type="password" className="form-input" value={pwdData.current} onChange={e => setPwdData({...pwdData, current: e.target.value})} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">New Password</label>
                            <input type="password" className="form-input" value={pwdData.new} onChange={e => setPwdData({...pwdData, new: e.target.value})} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Confirm New Password</label>
                            <input type="password" className="form-input" value={pwdData.confirm} onChange={e => setPwdData({...pwdData, confirm: e.target.value})} />
                        </div>

                        <div style={{display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem'}}>
                            <button className="btn" onClick={() => setShowPasswordModal(false)} style={{backgroundColor: '#ccc', color: 'black', border: '1px solid #999'}}>Cancel</button>
                            <button className="btn" onClick={handleChangePassword}>Change Password</button>
                        </div>
                    </div>
                </div>
            )}

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
                <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={cv.profile.name} onChange={e => updateProfile('name', e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={cv.profile.title} onChange={e => updateProfile('title', e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Summary</label><textarea className="form-textarea" rows={3} value={cv.profile.summary} onChange={e => updateProfile('summary', e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Location</label><input className="form-input" value={cv.profile.location} onChange={e => updateProfile('location', e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Address</label><textarea className="form-textarea" rows={3} value={cv.profile.address || ''} onChange={e => updateProfile('address', e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Website URL</label><input className="form-input" value={cv.profile.url} onChange={e => updateProfile('url', e.target.value)} /></div>
                <div className="form-group"><label className="form-label">GitHub URL</label><input className="form-input" value={cv.contact.github || ''} onChange={e => updateContact('github', e.target.value)} /></div>
            </div>

            <div className="card">
                <h3>Contact</h3>
                <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={cv.contact.email} onChange={e => updateContact('email', e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={cv.contact.phone} onChange={e => updateContact('phone', e.target.value)} /></div>
            </div>

            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h3>Experience</h3>
                    <button className="btn" onClick={addExperience} style={{ fontSize: '0.8rem' }}>+ Add</button>
                </div>
                {cv.experience.map(exp => (
                    <div key={exp.id} style={{ padding: '1rem', border: '1px solid var(--color-border)', marginBottom: '1rem', borderRadius: 'var(--radius)' }}>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <div style={{ flex: 1 }}>
                                <input placeholder="Company" className="form-input" style={{ marginBottom: '0.5rem' }} value={exp.company} onChange={e => updateExperience(exp.id, 'company', e.target.value)} />
                                <input placeholder="Role" className="form-input" style={{ marginBottom: '0.5rem' }} value={exp.role} onChange={e => updateExperience(exp.id, 'role', e.target.value)} />
                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                    <input placeholder="Start Date" className="form-input" value={exp.startDate} onChange={e => updateExperience(exp.id, 'startDate', e.target.value)} />
                                    <input placeholder="End Date" className="form-input" value={exp.endDate} onChange={e => updateExperience(exp.id, 'endDate', e.target.value)} />
                                </div>
                                <textarea placeholder="Description" className="form-textarea" rows={3} value={exp.description} onChange={e => updateExperience(exp.id, 'description', e.target.value)} />
                            </div>
                            <button onClick={() => removeExperience(exp.id)} style={{ color: 'red', background: 'none', border: 'none', alignSelf: 'flex-start' }}>X</button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h3>Education</h3>
                    <button className="btn" onClick={addEducation} style={{ fontSize: '0.8rem' }}>+ Add</button>
                </div>
                {cv.education.map(edu => (
                    <div key={edu.id} style={{ padding: '1rem', border: '1px solid var(--color-border)', marginBottom: '1rem', borderRadius: 'var(--radius)' }}>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <div style={{ flex: 1 }}>
                                <input placeholder="Institution" className="form-input" style={{ marginBottom: '0.5rem' }} value={edu.institution} onChange={e => updateEducation(edu.id, 'institution', e.target.value)} />
                                <input placeholder="Degree" className="form-input" style={{ marginBottom: '0.5rem' }} value={edu.degree} onChange={e => updateEducation(edu.id, 'degree', e.target.value)} />
                                <input placeholder="Year" className="form-input" value={edu.year} onChange={e => updateEducation(edu.id, 'year', e.target.value)} />
                            </div>
                            <button onClick={() => removeEducation(edu.id)} style={{ color: 'red', background: 'none', border: 'none', alignSelf: 'flex-start' }}>X</button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h3>Skills</h3>
                    <button className="btn" onClick={addSkill} style={{ fontSize: '0.8rem' }}>+ Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                    {cv.skills.map(skill => (
                        <div key={skill.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--color-border)', padding: '0.5rem', borderRadius: '1rem' }}>
                            <input 
                                className="form-input" 
                                style={{ border: 'none', padding: '0.25rem', width: '150px' }} 
                                value={skill.name} 
                                onChange={e => updateSkill(skill.id, 'name', e.target.value)} 
                                placeholder="Skill Name"
                            />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', borderLeft: '1px solid #ddd', paddingLeft: '0.5rem' }}>
                                <input 
                                    type="number" 
                                    min="0" 
                                    max="100"
                                    className="form-input" 
                                    style={{ border: 'none', padding: '0.25rem', width: '60px', textAlign: 'right' }} 
                                    value={skill.level || 0} 
                                    onChange={e => updateSkill(skill.id, 'level', parseInt(e.target.value) || 0)} 
                                    placeholder="%"
                                />
                                <span style={{ fontSize: '0.8rem', color: '#666' }}>%</span>
                            </div>
                            <button onClick={() => removeSkill(skill.id)} style={{ color: 'red', background: 'none', border: 'none', marginLeft: '0.5rem', cursor: 'pointer' }}>&times;</button>
                        </div>
                    ))}
                </div>
            </div>

             <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h3>Languages</h3>
                    <button className="btn" onClick={addLanguage} style={{ fontSize: '0.8rem' }}>+ Add</button>
                </div>
                {cv.languages?.map(lang => (
                    <div key={lang.id} style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                        <input className="form-input" placeholder="Language" value={lang.language} onChange={e => updateLanguage(lang.id, 'language', e.target.value)} />
                        <select 
                            className="form-input" 
                            value={lang.proficiency} 
                            onChange={e => updateLanguage(lang.id, 'proficiency', e.target.value)}
                        >
                            <option value="">Select Proficiency</option>
                            <option value="Native">Native</option>
                            <option value="Fluent">Fluent</option>
                            <option value="Advanced">Advanced</option>
                            <option value="Intermediate">Intermediate</option>
                            <option value="Basic">Basic</option>
                            {!['Native', 'Fluent', 'Advanced', 'Intermediate', 'Basic', ''].includes(lang.proficiency) && (
                                <option value={lang.proficiency}>{lang.proficiency}</option>
                            )}
                        </select>
                        <button onClick={() => removeLanguage(lang.id)} style={{ color: 'red', background: 'none', border: 'none' }}>&times;</button>
                    </div>
                ))}
            </div>

            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h3>Certifications</h3>
                    <button className="btn" onClick={addCertification} style={{ fontSize: '0.8rem' }}>+ Add</button>
                </div>
                {cv.certifications?.map(cert => (
                    <div key={cert.id} style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                        <input className="form-input" placeholder="Certification Name" value={cert.name} onChange={e => updateCertification(cert.id, 'name', e.target.value)} />
                        <input className="form-input" placeholder="Year" value={cert.year} onChange={e => updateCertification(cert.id, 'year', e.target.value)} />
                        <button onClick={() => removeCertification(cert.id)} style={{ color: 'red', background: 'none', border: 'none' }}>&times;</button>
                    </div>
                ))}
            </div>
        </div>
    );
};
