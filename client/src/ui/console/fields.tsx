// The console's small parts: a labelled field, a model box, an effort picker, a write-only secret, a button that asks
// before it acts, a worker's status. Adapted from cubefarm client/src/ui/AgentSettings.tsx (ModelInput, EffortSelect),
// CloudSettings.tsx (SecretField) and Confirm.tsx (MIT); the confirmation asks in place rather than in a dialog of its own.
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { EffortLevel, WorkerStatus } from '../../../../shared/types';
import { CLAUDE_MODELS } from '../../../../shared/models';
import { EFFORTS } from './forms';

/** Offered in every model box; any other name can still be typed. */
export const MODEL_SUGGESTIONS = [...CLAUDE_MODELS, 'ollama/gpt-oss:20b', 'ollama/qwen3:8b'];

/** A label over its input, with a problem (in red) or a hint under it. */
export function Field({ label, problem, hint, children }: { label: ReactNode; problem?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="console-field">
      <span className="console-field-label">{label}</span>
      {children}
      {problem ? <small className="console-bad">{problem}</small> : hint ? <small className="console-hint">{hint}</small> : null}
    </label>
  );
}

/** A model name, saved on Enter or when you leave the box; empty means the office default. A refusal puts it back. */
export function ModelInput({ value, placeholder, label, onCommit }: { value: string; placeholder: string; label: string; onCommit: (model: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const list = useId();
  const commit = () => {
    const v = draft.trim();
    if (v !== value) void onCommit(v).then((ok) => ok === null && setDraft(value));
  };
  return (
    <>
      <input
        className="console-model"
        value={draft}
        placeholder={placeholder}
        list={list}
        aria-label={label}
        title="A Claude model, or ollama/<name> for one on this computer. Empty: the office default."
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <datalist id={list}>
        {MODEL_SUGGESTIONS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}

/** A model box that only keeps what you type (the setup's and the hiring's choice, sent with their button). */
export function ModelPick({ value, placeholder, label, onChange }: { value: string; placeholder: string; label: string; onChange: (model: string) => void }) {
  const list = useId();
  return (
    <>
      <input className="console-model" value={value} placeholder={placeholder} list={list} aria-label={label} onChange={(e) => onChange(e.target.value)} />
      <datalist id={list}>
        {MODEL_SUGGESTIONS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}

/** An effort level, or '' for the office default (`fallback`). */
export function EffortSelect({ value, fallback, label, onChange }: { value: EffortLevel | ''; fallback: EffortLevel; label: string; onChange: (effort: EffortLevel | '') => void }) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as EffortLevel | '')}>
      <option value="">default ({fallback})</option>
      {EFFORTS.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </select>
  );
}

/** Acts on the second click: the first turns it into "Sure? [confirm] [Cancel]", which gives up by itself after a while. */
export function ConfirmButton({ children, question, confirm, onConfirm, disabled, title }: { children: ReactNode; question: string; confirm: string; onConfirm: () => void; disabled?: boolean; title?: string }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), 6000);
    return () => clearTimeout(t);
  }, [asking]);
  if (!asking)
    return (
      <button className="console-btn" disabled={disabled} title={title} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  return (
    <span className="console-confirm" role="group" aria-label={question}>
      <span>{question}</span>
      <button
        className="console-btn bad"
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirm}
      </button>
      <button className="console-btn ghost" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

/**
 * A key or token the server keeps and never sends back: its last characters once saved (Replace, Remove), else a box
 * to paste one into. `save('')` removes it.
 */
export function SecretField({ label, saved, hint, placeholder, save }: { label: string; saved: boolean; hint: string; placeholder: string; save: (value: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const store = (v: string) => {
    setBusy(true);
    void save(v)
      .then((ok) => {
        if (ok === null) return;
        setValue(''); // never kept or shown again once saved
        setEditing(false);
      })
      .finally(() => setBusy(false));
  };
  if (saved && !editing)
    return (
      <div className="console-row">
        <span className="console-grow">
          🔑 {label} saved{hint && <code> ••••{hint}</code>}
        </span>
        <button className="console-btn ghost" onClick={() => setEditing(true)}>
          Replace
        </button>
        <ConfirmButton question={`Remove the ${label}?`} confirm="Remove" disabled={busy} onConfirm={() => store('')}>
          Remove
        </ConfirmButton>
      </div>
    );
  return (
    <form
      className="console-row"
      onSubmit={(e) => {
        e.preventDefault();
        store(value);
      }}
    >
      <input className="console-grow" type="password" value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-label={label} onChange={(e) => setValue(e.target.value)} />
      <button className="console-btn good" disabled={busy || !value.trim()}>
        {busy ? 'Checking…' : 'Save'}
      </button>
      {editing && (
        <button
          type="button"
          className="console-btn ghost"
          onClick={() => {
            setEditing(false);
            setValue('');
          }}
        >
          Cancel
        </button>
      )}
    </form>
  );
}

const STATUS_WORDS: Record<WorkerStatus, string> = { idle: 'free', preparing: 'setting up', working: 'working', done: 'done', error: 'error', stopped: 'stopped' };

export function StatusPill({ status }: { status: WorkerStatus }) {
  return <span className={`console-status console-status-${status}`}>{STATUS_WORDS[status]}</span>;
}

/** A floor's number on its colour, as on the elevator's buttons. */
export function FloorBadge({ floor, color }: { floor: number | string; color: string }) {
  return (
    <span className="elevator-number console-floor-no" style={{ background: color }}>
      {floor}
    </span>
  );
}
