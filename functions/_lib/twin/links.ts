import type { TwinCv } from "./cv";

// A model can mis-copy or invent a URL (a "wrong page") and prompt injection could try to slip a
// phishing link into an answer. So after generation every link in an answer is checked against
// the links that really are in the CV: exact matches are kept (in their canonical form), any
// LinkedIn profile link is replaced by the owner's real one, and every other link is removed.

const REMOVED = "[link removed]";
const FULL_URL = /\bhttps?:\/\/[^\s<>"'`]+/gi;
// A LinkedIn profile written without a scheme ("linkedin.com/in/..."); not when it is part of a full URL.
const BARE_LINKEDIN = /(?<![\w/.:@-])(?:www\.)?linkedin\.com\/in\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

const canonical = (url: string): string => url.trim().replace(/\/+$/, "").toLowerCase();

function splitTail(match: string): { core: string; tail: string } {
  const tail = TRAILING_PUNCTUATION.exec(match)?.[0] ?? "";
  return { core: match.slice(0, match.length - tail.length), tail };
}

const isHttp = (value: string | undefined): value is string => !!value && /^https?:\/\//i.test(value);
const isLinkedIn = (value: string): boolean => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return false;
  }
};

export interface OwnerLinks {
  /** Every link that is really in the CV (http/https only). */
  allowed: string[];
  /** The owner's LinkedIn profile, if the CV has one. */
  linkedin?: string;
}

export function ownerLinks(cv: TwinCv): OwnerLinks {
  const candidates = [cv.contact.linkedin, cv.contact.github, cv.contact.website, cv.profile.url].filter(isHttp);
  const linkedin = [cv.contact.linkedin, cv.profile.url].filter(isHttp).find(isLinkedIn);
  return { allowed: [...new Set(candidates)], linkedin };
}

export function guardLinks(text: string, links: OwnerLinks): { text: string; changed: boolean } {
  const byCanonical = new Map(links.allowed.map((url) => [canonical(url), url]));
  let changed = false;
  const replace = (value: string, replacement: string): string => {
    if (replacement !== value) changed = true;
    return replacement;
  };

  // 1. Bare "linkedin.com/in/..." mentions -> the owner's real profile.
  let out = text.replace(BARE_LINKEDIN, (match) => {
    const { tail } = splitTail(match);
    return replace(match, `${links.linkedin ?? REMOVED}${tail}`);
  });

  // 2. Full URLs: keep exact CV links, fix LinkedIn profiles, remove everything else.
  out = out.replace(FULL_URL, (match) => {
    const { core, tail } = splitTail(match);
    const known = byCanonical.get(canonical(core));
    if (known) return replace(match, `${known}${tail}`);
    if (isLinkedIn(core) && /\/in\//i.test(core) && links.linkedin) return replace(match, `${links.linkedin}${tail}`);
    return replace(match, `${REMOVED}${tail}`);
  });

  return { text: out, changed };
}
