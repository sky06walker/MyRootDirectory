import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { fetchTwinStatus, type TwinStatus } from '../../utils/twinApi';
import { TwinAvatar } from './TwinAvatar';

// The dialog (and everything it needs) is a separate chunk: it is requested on hover/focus
// or click, never with the page, so the launcher adds almost nothing to the public bundle.
const loadDialog = () => import('./TwinDialog');
const TwinDialog = lazy(loadDialog);

export interface TwinOwner {
  name: string;
  /** How the owner introduces themselves in the dialog ("I'm Wei Hon."); falls back to `name`. */
  shortName?: string;
  email: string;
  linkedin?: string;
  github?: string;
}

const GREETED_KEY = 'twin-greeted';
const GREETING_DELAY_MS = 4000;
const GREETING_VISIBLE_MS = 9000;

const wasGreeted = (): boolean => {
  try {
    return sessionStorage.getItem(GREETED_KEY) === '1';
  } catch {
    return true; // storage blocked: do not nag
  }
};
const markGreeted = () => {
  try {
    sessionStorage.setItem(GREETED_KEY, '1');
  } catch { /* ignore */ }
};

export const TwinLauncher: React.FC<{ owner: TwinOwner }> = ({ owner }) => {
  const [status, setStatus] = useState<TwinStatus | null>(null);
  const [requested, setRequested] = useState(false); // dialog code has been asked for
  const [open, setOpen] = useState(false);
  const [greeting, setGreeting] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTwinStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = status?.enabled === true;
  const resting = enabled && status?.available === false;

  // Reserve space under the page content so the avatar never hides the last lines (small screens).
  useEffect(() => {
    if (!enabled) return;
    document.body.classList.add('has-twin');
    return () => document.body.classList.remove('has-twin');
  }, [enabled]);

  // Greeting bubble: once per session, dismissible, also states that this is an AI.
  useEffect(() => {
    if (!enabled || wasGreeted()) return;
    const show = setTimeout(() => setGreeting(true), GREETING_DELAY_MS);
    const hide = setTimeout(() => setGreeting(false), GREETING_DELAY_MS + GREETING_VISIBLE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [enabled]);

  if (!enabled) return null;

  const dismissGreeting = () => {
    setGreeting(false);
    markGreeted();
  };

  const handleOpen = () => {
    dismissGreeting();
    setRequested(true);
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };

  return (
    <>
      {greeting && !open && (
        <div className="twin-bubble no-print" role="status">
          <span>
            Hi! 👋 I'm {owner.shortName ?? owner.name}'s digital twin. Ask me anything about my work!
          </span>
          <button type="button" className="twin-bubble-close" onClick={dismissGreeting} aria-label="Dismiss greeting">
            &times;
          </button>
        </div>
      )}

      <button
        ref={launcherRef}
        type="button"
        className={`twin-launcher no-print${resting ? ' is-resting' : ''}`}
        onClick={handleOpen}
        onPointerEnter={() => void loadDialog()}
        onFocus={() => void loadDialog()}
        aria-label={`Chat with ${owner.name}'s AI digital twin`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="twin-dialog"
        title={resting ? 'Resting right now: you can still read my quick answers' : undefined}
      >
        <TwinAvatar hash={status?.avatarHash} size={64} />
        {/* decorative twinkles around the avatar (animated only when the visitor allows motion) */}
        <span className="twin-sparkle s1" aria-hidden="true">✦</span>
        <span className="twin-sparkle s2" aria-hidden="true">✦</span>
        <span className="twin-sparkle s3" aria-hidden="true">✦</span>
      </button>

      {requested && (
        <Suspense fallback={null}>
          <TwinDialog open={open} onClose={handleClose} owner={owner} resting={resting} resetsAt={status?.resetsAt} avatarHash={status?.avatarHash} />
        </Suspense>
      )}
    </>
  );
};
