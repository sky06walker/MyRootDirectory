import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Modal } from "./Modal";

interface ShareModalProps {
  url: string;
  onClose: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ url, onClose }) => (
  <Modal>
    <button
      onClick={onClose}
      aria-label="Close"
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
    <p style={{ marginBottom: "1rem", color: "#666" }}>Scan to view on mobile</p>
    <div style={{ display: "flex", justifyContent: "center", margin: "1rem 0" }}>
      <QRCodeSVG value={url} size={200} />
    </div>
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <input
        type="text"
        readOnly
        value={url}
        aria-label="Share URL"
        className="form-input"
        style={{ width: "100%" }}
      />
      <button
        className="btn"
        onClick={() => navigator.clipboard.writeText(url).catch(console.error)}
      >
        Copy
      </button>
    </div>
  </Modal>
);
