import React from 'react';
import { ExternalLink } from '../ExternalLink';
import { safeHref } from '../../utils/url';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const key = (url: string) => url.replace(/\/+$/, '').toLowerCase();

/**
 * Plain text in, React nodes out: only EXACT occurrences of the owner's own links (LinkedIn,
 * GitHub, ...) become clickable, and they point at the link exactly as written in the CV; nothing
 * else is ever turned into a link. Safe against markup in the text because it is rendered as
 * React text nodes, never as HTML.
 */
export function linkify(text: string, urls: (string | undefined)[]): React.ReactNode[] {
  const byKey = new Map<string, string>();
  for (const url of urls) if (url && safeHref(url)) byKey.set(key(url), url);
  if (byKey.size === 0) return [text];

  // longest first so a longer link is not cut short by a shorter one; an optional trailing slash is accepted
  const patterns = [...byKey.keys()].sort((a, b) => b.length - a.length).map((k) => `${escapeRegExp(k)}/?`);
  return text.split(new RegExp(`(${patterns.join('|')})`, 'gi')).map((part, index) => {
    if (index % 2 === 0) return part;
    const url = byKey.get(key(part));
    return url ? <ExternalLink key={index} href={url} /> : part;
  });
}
