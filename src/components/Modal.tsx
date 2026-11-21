import React, { type ReactNode } from "react";

/** Full-screen dimmed overlay with a centred card. */
export const Modal: React.FC<{ children: ReactNode }> = ({ children }) => (
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
      role="dialog"
      aria-modal="true"
      style={{
        width: "90%",
        maxWidth: "400px",
        position: "relative",
        backgroundColor: "white",
        padding: "2rem",
      }}
    >
      {children}
    </div>
  </div>
);
