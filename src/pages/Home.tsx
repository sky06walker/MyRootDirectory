import React, { useEffect, useState } from "react";
import { INITIAL_CV_DATA, type CVData } from "../utils/types";
import { fetchCVData } from "../utils/api";
import { Header } from "../components/Header";
import { CVSection } from "../components/CVSection";
import { SkillChart } from "../components/SkillChart";
import { QRCodeSVG } from "qrcode.react";

interface HomeProps {
  theme?: "modern" | "custom";
  toggleTheme?: () => void;
}

export const Home: React.FC<HomeProps> = ({ theme, toggleTheme }) => {
  const [cv, setCv] = useState<CVData>(INITIAL_CV_DATA);
  const [loading, setLoading] = useState(true);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    fetchCVData().then((data) => {
      setCv(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="container">Loading...</div>;

  const currentUrl = `${window.location.origin}${window.location.pathname}?theme=${theme}`;

  const ShareModal = () =>
    showShare && (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 1000,
        }}
      >
        <div
          className="card"
          style={{
            width: "90%",
            maxWidth: "400px",
            position: "relative",
            backgroundColor: "white",
            padding: "2rem",
          }}
        >
          <button
            onClick={() => setShowShare(false)}
            style={{
              position: "absolute",
              top: "1rem",
              right: "1rem",
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "black",
            }}
          >
            &times;
          </button>
          <h3 style={{ color: "black" }}>Share this CV</h3>
          <p style={{ marginBottom: "1rem", color: "#666" }}>
            Scan to view on mobile
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              margin: "1rem 0",
            }}
          >
            <QRCodeSVG value={currentUrl} size={200} />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              readOnly
              value={currentUrl}
              className="form-input"
              style={{ width: "100%" }}
            />
            <button
              className="btn"
              onClick={() => navigator.clipboard.writeText(currentUrl)}
            >
              Copy
            </button>
          </div>
        </div>
      </div>
    );

  if (theme === "custom") {
    return (
      <div className="container">
        <Header currentTheme={theme} onToggleTheme={toggleTheme} />
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "0 1rem",
            gap: "0.5rem",
          }}
        >
          <button className="btn no-print" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn no-print" onClick={() => setShowShare(true)}>
            Share CV
          </button>
        </div>
        <ShareModal />

        <div className="cv-container">
          {/* Sidebar: Photo, Profile, Contact, Languages, Education & Certs */}
          <aside className="cv-sidebar">
            <div style={{ textAlign: "center", marginBottom: "2rem" }}>
              <img
                src={cv.profile.photo || "/profile.jpg"}
                alt={cv.profile.name}
                style={{
                  width: "150px",
                  height: "150px",
                  borderRadius: "50%",
                  objectFit: "cover",
                  marginBottom: "1rem",
                  border: "4px solid white",
                }}
              />
              <h1>{cv.profile.name}</h1>
              <p style={{ fontSize: "1.1rem", opacity: 0.9 }}>
                {cv.profile.title}
              </p>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h3
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.3)",
                  paddingBottom: "0.5rem",
                  marginBottom: "1rem",
                }}
              >
                Contact
              </h3>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                {cv.profile.address && (
                  <span
                    style={{
                      whiteSpace: "pre-line",
                      fontSize: "0.9rem",
                      opacity: 0.9,
                    }}
                  >
                    {cv.profile.address}
                  </span>
                )}
                <a href={`mailto:${cv.contact.email}`}>{cv.contact.email}</a>
                <a
                  href={`https://wa.me/${cv.contact.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {cv.contact.phone}
                </a>
                {cv.contact.github && (
                  <a href={cv.contact.github} target="_blank" rel="noreferrer">
                    {cv.contact.github}
                  </a>
                )}
                {cv.profile.url && (
                  <a
                    href={cv.profile.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ wordBreak: "break-all" }}
                  >
                    {cv.profile.url}
                  </a>
                )}
              </div>
            </div>

            {/* Merged Labels: Education & Certifications */}
            <div style={{ marginBottom: "2rem" }}>
              <h3
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.3)",
                  paddingBottom: "0.5rem",
                  marginBottom: "1rem",
                }}
              >
                Education & Certifications
              </h3>

              {/* Education first */}
              {cv.education.map((edu) => (
                <div key={edu.id} style={{ marginBottom: "1rem" }}>
                  <h4 style={{ fontSize: "1rem", fontWeight: "bold" }}>
                    {edu.degree}
                  </h4>
                  <p style={{ fontSize: "0.9rem" }}>{edu.institution}</p>
                  <span style={{ fontSize: "0.8rem", opacity: 0.8 }}>
                    {edu.year}
                  </span>
                </div>
              ))}

              {/* Then Certifications */}
              {cv.certifications?.map((cert) => (
                <div key={cert.id} style={{ marginBottom: "1rem" }}>
                  <h4 style={{ fontSize: "1rem", fontWeight: "bold" }}>
                    {cert.name}
                  </h4>
                  <span style={{ fontSize: "0.8rem", opacity: 0.8 }}>
                    {cert.year}
                  </span>
                </div>
              ))}
            </div>

            {cv.languages && cv.languages.length > 0 && (
              <div style={{ marginBottom: "2rem" }}>
                <h3
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.3)",
                    paddingBottom: "0.5rem",
                    marginBottom: "1rem",
                  }}
                >
                  Languages
                </h3>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  {cv.languages.map((lang) => (
                    <div
                      key={lang.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{lang.language}</span>
                      <span style={{ opacity: 0.8, fontSize: "0.9rem" }}>
                        {lang.proficiency}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* Main Content: Summary, Skill Chart, Experience */}
          <main className="cv-main">
            <section style={{ marginBottom: "2rem" }}>
              <h2
                style={{
                  color: "var(--color-primary)",
                  borderBottom: "2px solid var(--color-border)",
                  paddingBottom: "0.5rem",
                  marginBottom: "1rem",
                }}
              >
                Profile
              </h2>
              <p>{cv.profile.summary}</p>
            </section>

            {/* Skill Chart Component */}
            <section style={{ marginBottom: "2rem" }}>
              <h2
                style={{
                  color: "var(--color-primary)",
                  borderBottom: "2px solid var(--color-border)",
                  paddingBottom: "0.5rem",
                  marginBottom: "1rem",
                }}
              >
                Skills
              </h2>
              <SkillChart skills={cv.skills} />
            </section>

            <section style={{ marginBottom: "2rem" }}>
              <h2
                style={{
                  color: "var(--color-primary)",
                  borderBottom: "2px solid var(--color-border)",
                  paddingBottom: "0.5rem",
                  marginBottom: "1rem",
                }}
              >
                Experience
              </h2>
              {cv.experience.map((exp) => (
                <div key={exp.id} style={{ marginBottom: "1.5rem" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <h3 style={{ fontSize: "1.1rem", color: "black" }}>
                      {exp.role}
                    </h3>
                    <span style={{ color: "#666", fontSize: "0.9rem" }}>
                      {exp.startDate} - {exp.endDate}
                    </span>
                  </div>
                  <h4
                    style={{
                      fontSize: "1rem",
                      color: "var(--color-primary)",
                      marginBottom: "0.5rem",
                    }}
                  >
                    {exp.company}
                  </h4>
                  <p style={{ whiteSpace: "pre-line" }}>{exp.description}</p>
                </div>
              ))}
            </section>
          </main>
        </div>
      </div>
    );
  }

  // Modern Theme (Default)
  return (
    <div className="container">
      <Header currentTheme={theme} onToggleTheme={toggleTheme} />

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: "1rem",
          gap: "0.5rem",
        }}
      >
        <button className="btn no-print" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn no-print" onClick={() => setShowShare(true)}>
          Share CV
        </button>
      </div>

      <ShareModal />

      {/* Profile */}
      <header style={{ textAlign: "center", marginBottom: "3rem" }}>
        <img
          src={cv.profile.photo || "/profile.jpg"}
          alt={cv.profile.name}
          style={{
            width: "120px",
            height: "120px",
            borderRadius: "50%",
            objectFit: "cover",
            marginBottom: "1rem",
          }}
        />
        <h1 style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>
          {cv.profile.name}
        </h1>
        <p
          style={{
            fontSize: "1.25rem",
            color: "var(--color-text-secondary)",
            marginBottom: "1rem",
          }}
        >
          {cv.profile.title}
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
            flexWrap: "wrap",
            color: "var(--color-primary)",
          }}
        >
          {cv.profile.address && <span>{cv.profile.address}</span>}
          <a href={`mailto:${cv.contact.email}`}>{cv.contact.email}</a>
          <a
            href={`https://wa.me/${cv.contact.phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
          >
            {cv.contact.phone}
          </a>
          {cv.contact.github && (
            <a href={cv.contact.github} target="_blank" rel="noreferrer">
              {cv.contact.github}
            </a>
          )}
        </div>
        {cv.profile.url && (
          <a
            href={cv.profile.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              marginTop: "0.5rem",
              wordBreak: "break-all",
            }}
          >
            {cv.profile.url}
          </a>
        )}
        <p
          style={{
            marginTop: "1.5rem",
            maxWidth: "600px",
            margin: "1.5rem auto",
          }}
        >
          {cv.profile.summary}
        </p>
      </header>

      {/* Experience */}
      <CVSection title="Experience">
        {cv.experience.map((exp) => (
          <div key={exp.id} style={{ marginBottom: "1.5rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                flexWrap: "wrap",
              }}
            >
              <h3 style={{ fontSize: "1.1rem" }}>
                {exp.role}{" "}
                <span style={{ fontWeight: "normal" }}>at {exp.company}</span>
              </h3>
              <span
                style={{
                  color: "var(--color-text-secondary)",
                  fontSize: "0.9rem",
                }}
              >
                {exp.startDate} - {exp.endDate}
              </span>
            </div>
            <p style={{ marginTop: "0.5rem", whiteSpace: "pre-line" }}>
              {exp.description}
            </p>
          </div>
        ))}
      </CVSection>

      {/* Education */}
      <CVSection title="Education">
        {cv.education.map((edu) => (
          <div key={edu.id} style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ fontSize: "1.1rem" }}>{edu.degree}</h3>
              <span>{edu.year}</span>
            </div>
            <p>{edu.institution}</p>
          </div>
        ))}
      </CVSection>

      {/* Skills */}
      <CVSection title="Skills">
        <div style={{ marginBottom: "1rem" }}>
          <SkillChart skills={cv.skills} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {cv.skills.map((skill) => (
            <span
              key={skill.id}
              style={{
                padding: "0.25rem 0.75rem",
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "2rem",
                fontSize: "0.9rem",
              }}
            >
              {skill.name}
            </span>
          ))}
        </div>
      </CVSection>

      {/* Languages (Modern Theme) */}
      {cv.languages && cv.languages.length > 0 && (
        <CVSection title="Languages">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "1rem",
            }}
          >
            {cv.languages.map((lang) => (
              <div
                key={lang.id}
                style={{
                  padding: "0.5rem",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius)",
                }}
              >
                <strong>{lang.language}</strong>: {lang.proficiency}
              </div>
            ))}
          </div>
        </CVSection>
      )}

      {/* Certifications (Modern Theme) */}
      {cv.certifications && cv.certifications.length > 0 && (
        <CVSection title="Certifications">
          {cv.certifications.map((cert) => (
            <div key={cert.id} style={{ marginBottom: "0.5rem" }}>
              <strong>{cert.name}</strong>{" "}
              <span style={{ color: "var(--color-text-secondary)" }}>
                ({cert.year})
              </span>
            </div>
          ))}
        </CVSection>
      )}
    </div>
  );
};
