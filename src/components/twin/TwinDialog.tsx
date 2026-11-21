import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink } from '../ExternalLink';
import { askTwin, type AskResult, type TwinMessage } from '../../utils/twinApi';
import { getTurnstileToken } from '../../utils/turnstile';
import { STARTERS } from './starters';
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
const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+$/;

const formatTime = (iso?: string): string | undefined => {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function errorText(result: Extract<AskResult, { ok: false }>, ownerName: string): string {
  switch (result.code) {
    case 'rate_limited':
      return `You've asked a lot in a short time. Please try again in ${Math.max(1, Math.ceil((result.retryAfterSec ?? 60) / 60))} min, or email ${ownerName} directly.`;
    case 'resting': {
      const at = formatTime(result.resetsAt);
      return `I'm resting right now${at ? ` (back around ${at})` : ''}. The quick answers above still work, or email ${ownerName}.`;
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
      return "Something went wrong on my side. Please try again in a moment, or email me.";
  }
}

const TwinDialog: React.FC<TwinDialogProps> = ({ open, onClose, owner, resting, resetsAt, avatarHash }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | undefined>(undefined);
  const nextId = useRef(1);

  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Native <dialog>: top layer (no z-index fights), inert background and focus trap for free,
  // Escape fires "close", focus returns to the launcher.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Bring the newest message (or error) into view from its first line, not the chips below it.
  useEffect(() => {
    const newest = logRef.current?.querySelectorAll('.twin-msg, .twin-error');
    newest?.[newest.length - 1]?.scrollIntoView?.({ block: 'start' });
  }, [items, busy, error]);

  const add = (message: TwinMessage, canned = false) =>
    setItems((prev) => [...prev, { ...message, id: nextId.current++, canned }]);

  const contactAnswer = `The best way is email: ${owner.email}.${owner.linkedin || owner.github ? ' You can also find me on LinkedIn and GitHub (links below).' : ''}`;

  const askStarter = (question: string, answer: string) => {
    setError(null);
    add({ role: 'user', content: question });
    add({ role: 'assistant', content: answer }, true);
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
    } else {
      setInput(text); // keep the visitor's question so they can retry
      setItems((prev) => prev.filter((m) => m.id !== questionId));
      setError(errorText(result, owner.name));
    }
  };

  const lastQuestion = [...items].reverse().find((m) => m.role === 'user')?.content ?? '';
  const mailto = EMAIL_PATTERN.test(owner.email)
    ? `mailto:${owner.email}?subject=${encodeURIComponent('Question from your CV site')}&body=${encodeURIComponent(
        lastQuestion ? `Hi ${owner.name},\n\n${lastQuestion}\n` : `Hi ${owner.name},\n\n`,
      )}`
    : undefined;

  return (
    <dialog
      id="twin-dialog"
      ref={dialogRef}
      className="twin-dialog no-print"
      aria-labelledby="twin-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose(); // click on the backdrop
      }}
    >
      <header className="twin-header">
        <TwinAvatar hash={avatarHash} size={40} className={`twin-header-avatar${busy ? ' is-thinking' : ''}`} />
        <p id="twin-title" className="twin-title">Ask my digital twin</p>
        <button type="button" className="twin-close" onClick={onClose} aria-label="Close chat">
          &times;
        </button>
      </header>

      <p className="twin-disclosure">
        I'm an AI, not {owner.name}. My answers come from this CV and may be inaccurate. Messages are
        processed by a third-party AI provider that may log them, so please don't share personal or
        sensitive information.
      </p>

      <div ref={logRef} className="twin-log" role="log" aria-live="polite" aria-label="Conversation">
        {items.length === 0 && (
          <p className="twin-empty">
            {resting
              ? `I'm resting right now${formatTime(resetsAt) ? ` (back around ${formatTime(resetsAt)})` : ''}, but these quick answers still work:`
              : 'Hi! Pick a question, or type your own.'}
          </p>
        )}
        {items.map((m) => (
          <div key={m.id} className={`twin-msg ${m.role}`}>
            <p>{m.content}</p>
          </div>
        ))}
        {busy && (
          <div className="twin-msg assistant" aria-label="Thinking">
            <p>{slow ? 'Thinking… free AI models can take a few seconds.' : 'Thinking…'}</p>
          </div>
        )}
        {error && (
          <div className="twin-error" role="alert">
            {error}
          </div>
        )}
        <div className="twin-chips">
          {STARTERS.map((s) => (
            <button key={s.id} type="button" className="twin-chip" onClick={() => askStarter(s.question, s.answer)}>
              {s.question}
            </button>
          ))}
          <button type="button" className="twin-chip" onClick={() => askStarter('How can I contact you?', contactAnswer)}>
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
        <textarea
          id="twin-input"
          className="form-textarea twin-input"
          rows={2}
          maxLength={MAX_INPUT}
          placeholder={resting ? 'Resting: email me instead' : 'Ask about my experience…'}
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
        <div className="twin-form-row">
          <span className="twin-count" aria-hidden="true">{input.length}/{MAX_INPUT}</span>
          <button type="submit" className="btn" disabled={busy || resting || input.trim() === ''}>
            Send
          </button>
        </div>
      </form>

      <footer className="twin-footer">
        {mailto && (
          <a href={mailto} className="twin-mail">
            {lastQuestion ? `Send this question to ${owner.name}` : `Email ${owner.name}`}
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
