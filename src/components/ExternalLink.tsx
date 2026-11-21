import React from "react";
import { safeHref } from "../utils/url";

interface ExternalLinkProps {
  href?: string;
  /** Link text; defaults to the URL itself. */
  label?: string;
  style?: React.CSSProperties;
}

/** Renders the URL as a link in a new tab; renders nothing if it is empty or not http(s). */
export const ExternalLink: React.FC<ExternalLinkProps> = ({ href, label, style }) => {
  const safe = safeHref(href);
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noreferrer" style={style}>
      {label ?? href}
    </a>
  );
};
