import React, { useEffect, useState } from "react";
import { INITIAL_CV_DATA, type CVData, type Theme } from "../utils/types";
import { fetchCVData } from "../utils/api";
import { Header } from "../components/Header";
import { CVSection } from "../components/CVSection";
import { SkillChart } from "../components/SkillChart";
import { ShareModal } from "../components/ShareModal";
import { ExternalLink } from "../components/ExternalLink";
import { TwinLauncher } from "../components/twin/TwinLauncher";

interface HomeProps {
  theme?: Theme;
  toggleTheme?: () => void;
}

interface LayoutProps {
  cv: CVData;
  theme?: Theme;
  onToggleTheme?: () => void;
  onShare: () => void;
}

// Newest first. parseInt copes with ranges such as "1999 - 2001".
const newestFirst = (certifications: CVData["certifications"]) =>
  [...certifications].sort((a, b) => parseInt(b.year) - parseInt(a.year));

const ActionBar: React.FC<{
  onShare: () => void;
  style: React.CSSProperties;
}> = ({ onShare, style }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "flex-end",
      gap: "0.5rem",
      ...style,
    }}
  >
    <button className="btn no-print" onClick={() => window.print()}>
      Print
    </button>
    <button className="btn no-print" onClick={onShare}>
      Share CV
    </button>
  </div>
);

const SidebarHeading: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <h3
    style={{
      borderBottom: "1px solid rgba(255,255,255,0.3)",
      paddingBottom: "0.5rem",
      marginBottom: "1rem",
    }}
  >
    {children}
  </h3>
);

const MainHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2
    style={{
      color: "var(--color-primary)",
      borderBottom: "2px solid var(--color-border)",
      paddingBottom: "0.5rem",
      marginBottom: "1rem",
    }}
  >
    {children}
  </h2>
);

const CustomLayout: React.FC<LayoutProps> = ({
  cv,
  theme,
  onToggleTheme,
  onShare,
}) => (
  <div className="container">
    <Header currentTheme={theme} onToggleTheme={onToggleTheme} />
    <ActionBar onShare={onShare} style={{ padding: "0 1rem" }} />

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
          <p style={{ fontSize: "1.1rem", opacity: 0.9 }}>{cv.profile.title}</p>
        </div>

        <div style={{ marginBottom: "2rem" }}>
          <SidebarHeading>Contact</SidebarHeading>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
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
            <ExternalLink href={cv.contact.github} />
            <ExternalLink
              href={cv.profile.url}
              style={{ wordBreak: "break-all" }}
            />
          </div>
        </div>

        {/* Merged Labels: Education & Certifications */}
        <div style={{ marginBottom: "2rem" }}>
          <SidebarHeading>Education & Certifications</SidebarHeading>

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
          {newestFirst(cv.certifications).map((cert) => (
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

        {cv.languages.length > 0 && (
          <div style={{ marginBottom: "2rem" }}>
            <SidebarHeading>Languages</SidebarHeading>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
            >
              {cv.languages.map((lang) => (
                <div
                  key={lang.id}
                  style={{ display: "flex", justifyContent: "space-between" }}
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
          <MainHeading>Profile</MainHeading>
          <p>{cv.profile.summary}</p>
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <MainHeading>Skills</MainHeading>
          <SkillChart skills={cv.skills} />
        </section>

        <section style={{ marginBottom: "2rem" }}>
          <MainHeading>Experience</MainHeading>
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

const ModernLayout: React.FC<LayoutProps> = ({
  cv,
  theme,
  onToggleTheme,
  onShare,
}) => (
  <div className="container">
    <Header currentTheme={theme} onToggleTheme={onToggleTheme} />
    <ActionBar onShare={onShare} style={{ marginBottom: "1rem" }} />

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
        <ExternalLink href={cv.contact.github} />
      </div>
      <ExternalLink
        href={cv.profile.url}
        style={{ display: "block", marginTop: "0.5rem", wordBreak: "break-all" }}
      />
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

    {/* Languages */}
    {cv.languages.length > 0 && (
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

    {/* Certifications */}
    {cv.certifications.length > 0 && (
      <CVSection title="Certifications">
        {newestFirst(cv.certifications).map((cert) => (
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
  const layoutProps: LayoutProps = {
    cv,
    theme,
    onToggleTheme: toggleTheme,
    onShare: () => setShowShare(true),
  };

  return (
    <>
      {theme === "custom" ? (
        <CustomLayout {...layoutProps} />
      ) : (
        <ModernLayout {...layoutProps} />
      )}
      {showShare && (
        <ShareModal url={currentUrl} onClose={() => setShowShare(false)} />
      )}
      {/* Digital twin: renders nothing unless the server reports it enabled (see planning/PLAN.md) */}
      <TwinLauncher
        owner={{
          name: cv.profile.name,
          shortName: "Wei Hon", // how the owner introduces themselves in the twin dialog
          email: cv.contact.email,
          linkedin: cv.contact.linkedin ?? cv.profile.url,
          github: cv.contact.github,
        }}
      />
    </>
  );
};
