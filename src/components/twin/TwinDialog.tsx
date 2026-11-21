import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink } from '../ExternalLink';
import { askTwin, type AskResult, type TwinMessage } from '../../utils/twinApi';
import { getTurnstileToken } from '../../utils/turnstile';
import { linkify } from './linkify';
import { CONTACT_EMOJI, STARTERS } from './starters';
import { TwinAvatar } from './TwinAvatar';
import type { TwinOwner } from './TwinLauncher';

interface TwinDialogProps {
  open: boolean;
  onClose: () => void;
  owner: TwinOwner;
  /** The AI is out of quota: quick answers and email still work. */
  resting: boolean;
  resetsAt?: string;
  avatarHash?: string | null;
}

interface ChatItem extends TwinMessage {
  id: number;
  /** Pre-written (owner-approved) answer: no AI call was made. */
  canned?: boolean;
}

const MAX_INPUT = 500;
const MAX_HISTORY = 11; // plus the new question = 12, the server limit
const SLOW_AFTER_MS = 3000;
const HAPPY_MS = 1200;
const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+$/;

const formatTime = (iso?: string): string | undefined => {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function errorText(result: Extract<AskResult, { ok: false }>): string {
  switch (result.code) {
    case 'rate_limited':
      return `Whoa, that's a lot of questions! Please try again in ${Math.max(1, Math.ceil((result.retryAfterSec ?? 60) / 60))} min, or email me directly.`;
    case 'resting': {
      const at = formatTime(result.resetsAt);
      return `I'm taking a little break${at ? ` (back around ${at})` : ''}. The quick answers above still work, or email me.`;
    }
    case 'busy':
      return "I'm a bit busy right now. Please try again in a minute.";
    case 'timeout':
      return "I'm a bit slow right now. Please try again.";
    case 'invalid_request':
      return result.message ?? 'Please shorten or rephrase your question.';
    case 'verification_failed':
      return "I couldn't verify that you're a person. Please try again.";
    case 'network':
      return "I can't reach the server. Check your connection and try again.";
    default:
      return 'Something went wrong on my side. Please try again in a moment, or email me.';
  }
}

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
);

const TwinDialog: React.FC<TwinDialogProps> = ({ open, onClose, owner, resting, resetsAt, avatarHash }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | undefined>(undefined);
  const happyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextId = useRef(1);

  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [happy, setHappy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = owner.shortName ?? owner.name;

  // Native <dialog>: top layer (no z-index fights), inert background and focus trap for free,
  // Escape fires "close", focus returns to the launcher.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => () => clearTimeout(happyTimer.current), []);

  // Bring the newest message (or error) into view from its first line, not the chips below it.
  useEffect(() => {
    const newest = logRef.current?.querySelectorAll('.twin-msg, .twin-error');
    newest?.[newest.length - 1]?.scrollIntoView?.({ block: 'start' });
  }, [items, busy, error]);

  /** A little hop of the avatar when an answer arrives. */
  const celebrate = () => {
    setHappy(true);
    clearTimeout(happyTimer.current);
    happyTimer.current = setTimeout(() => setHappy(false), HAPPY_MS);
  };

  const add = (message: TwinMessage, canned = false) =>
    setItems((prev) => [...prev, { ...message, id: nextId.current++, canned }]);

  // The links are written out in full so they are clickable in the answer (see linkify) and always
  // the exact ones from the CV.
  const contactAnswer = [
    `The best way is email: ${owner.email}.`,
    owner.linkedin ? `LinkedIn: ${owner.linkedin}` : '',
    owner.github ? `GitHub: ${owner.github}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const askStarter = (question: string, answer: string) => {
    setError(null);
    add({ role: 'user', content: question });
    add({ role: 'assistant', content: answer }, true);
    celebrate();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || resting) return;
    setError(null);
    setInput('');
    setBusy(true);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);

    const history: TwinMessage[] = items
      .slice(-MAX_HISTORY)
      .map(({ role, content }) => ({ role, content }));
    const question: TwinMessage = { role: 'user', content: text };
    const questionId = nextId.current++;
    setItems((prev) => [...prev, { ...question, id: questionId }]);

    const attempt = async (): Promise<AskResult> => {
      let token: string | undefined;
      if (!sessionRef.current && captchaRef.current) {
        try {
          token = await getTurnstileToken(captchaRef.current);
        } catch {
          return { ok: false, code: 'verification_failed' };
        }
      }
      return askTwin([...history, question], sessionRef.current, token);
    };

    let result = await attempt();
    if (!result.ok && result.code === 'verification_failed' && sessionRef.current) {
      sessionRef.current = undefined; // expired or foreign session: verify again once
      result = await attempt();
    }

    clearTimeout(slowTimer);
    setBusy(false);
    setSlow(false);

    if (result.ok) {
      if (result.session) sessionRef.current = result.session;
      add({ role: 'assistant', content: result.answer });
      celebrate();
    } else {
      setInput(text); // keep the visitor's question so they can retry
      setItems((prev) => prev.filter((m) => m.id !== questionId));
      setError(errorText(result));
    }
  };

  const lastQuestion = [...items].reverse().find((m) => m.role === 'user')?.content ?? '';
  const mailto = EMAIL_PATTERN.test(owner.email)
    ? `mailto:${owner.email}?subject=${encodeURIComponent('Question from your CV site')}&body=${encodeURIComponent(
        lastQuestion ? `Hi ${name},\n\n${lastQuestion}\n` : `Hi ${name},\n\n`,
      )}`
    : undefined;

  const miniAvatar = <TwinAvatar hash={avatarHash} size={28} className="twin-mini-avatar" />;
  const resumeAt = formatTime(resetsAt);
  const welcome = resting
    ? `Zzz… I'm taking a little break${resumeAt ? ` (back around ${resumeAt})` : ''}. My quick answers below still work!`
    : `Hi, I'm ${name} 👋 Ask me anything about my work, or tap a topic below.`;

  return (
    <dialog
      id="twin-dialog"
      ref={dialogRef}
      className="twin-dialog no-print"
      aria-labelledby="twin-title"
      data-resting={resting ? '' : undefined}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose(); // click on the backdrop
      }}
    >
      <header className="twin-header">
        <span className="twin-header-avatar-wrap">
          <TwinAvatar
            hash={avatarHash}
            size={52}
            className={`twin-header-avatar${busy ? ' is-thinking' : happy ? ' is-happy' : ''}`}
          />
          <span className="twin-online" aria-hidden="true" />
        </span>
        <div className="twin-title-wrap">
          <p id="twin-title" className="twin-title">Ask me</p>
          <p className="twin-subtitle">{resting ? 'Taking a little break' : 'Anything about my work'}</p>
        </div>
        <button type="button" className="twin-close" onClick={onClose} aria-label="Close chat">
          &times;
        </button>
      </header>

      <p className="twin-disclosure">
        I'm {name}. My answers come from this CV and may be inaccurate. Messages are
        processed by a third-party AI provider that may log them, so please don't share personal or
        sensitive information.
      </p>

      <div ref={logRef} className="twin-log" role="log" aria-live="polite" aria-label="Conversation">
        {items.length === 0 && (
          <div className="twin-row assistant">
            {miniAvatar}
            <div className="twin-msg assistant twin-welcome">
              <p>{welcome}</p>
            </div>
          </div>
        )}
        {items.map((m) => (
          <div key={m.id} className={`twin-row ${m.role}`}>
            {m.role === 'assistant' && miniAvatar}
            <div className={`twin-msg ${m.role}`}>
              <p>{m.role === 'assistant' ? linkify(m.content, [owner.linkedin, owner.github]) : m.content}</p>
            </div>
          </div>
        ))}
        {busy && (
          <>
            <div className="twin-row assistant">
              {miniAvatar}
              <div className="twin-msg assistant twin-typing" role="status" aria-label="Thinking">
                <span />
                <span />
                <span />
              </div>
            </div>
            {slow && <p className="twin-hint">Thinking… free AI models can take a few seconds.</p>}
          </>
        )}
        {error && (
          <div className="twin-error" role="alert">
            {error}
          </div>
        )}
        <div className="twin-chips">
          {STARTERS.map((s) => (
            <button key={s.id} type="button" className="twin-chip" onClick={() => askStarter(s.question, s.answer)}>
              <span aria-hidden="true">{s.emoji}</span>
              {s.question}
            </button>
          ))}
          <button type="button" className="twin-chip" onClick={() => askStarter('How can I contact you?', contactAnswer)}>
            <span aria-hidden="true">{CONTACT_EMOJI}</span>
            How can I contact you?
          </button>
        </div>
      </div>

      <div ref={captchaRef} className="twin-captcha" />

      <form
        className="twin-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="twin-input" className="twin-sr-only">Your question</label>
        <div className="twin-input-wrap">
          <textarea
            id="twin-input"
            className="twin-input"
            rows={1}
            maxLength={MAX_INPUT}
            placeholder={resting ? 'Taking a break: email me instead' : 'Type your question…'}
            value={input}
            disabled={busy || resting}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button type="submit" className="twin-send" aria-label="Send" disabled={busy || resting || input.trim() === ''}>
            <SendIcon />
          </button>
        </div>
        {input.length > 0 && (
          <span className="twin-count" aria-hidden="true">{input.length}/{MAX_INPUT}</span>
        )}
      </form>

      <footer className="twin-footer">
        {mailto && (
          <a href={mailto} className="twin-mail">
            {lastQuestion ? '✉️ Email me this question' : '✉️ Email me'}
          </a>
        )}
        <span className="twin-links">
          <ExternalLink href={owner.linkedin} label="LinkedIn" />
          <ExternalLink href={owner.github} label="GitHub" />
        </span>
      </footer>
    </dialog>
  );
};

export default TwinDialog;
