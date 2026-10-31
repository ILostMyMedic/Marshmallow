// The console's Settings tab: your name and company, the session limit and pacing, team sizes and autoscale, the
// default model and effort, and cloud workers. One Save sends whatever changed (forms.ts settingsPatch); keys and tokens
// save on their own, since the server keeps them and never sends them back. Adapted from cubefarm
// client/src/ui/ManagerConsole.tsx (SettingsTab) and CloudSettings.tsx (MIT). Cut: other coding agents and their keys,
// the runtime choice, the CEO's scaling mode and reviews, the dog, the projects folder, idle-desk trimming, the tour,
// and the profile, voice, outside, notification, theme and accessibility settings.
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { BOX_SIZE_INFO, BOX_SIZES } from '../../../../shared/cloud';
import { DAY_MODES, type BoxSize, type CloudCredentialSource, type DayMode } from '../../../../shared/types';
import { useStore } from '../../store';
import { ConfirmButton, Field, ModelPick, SecretField } from './fields';
import { EFFORTS, LIMITS, pruneEdits, settingsForm, settingsPatch, type FormEdits, type SettingsForm } from './forms';
import { run, useBusy } from './run';

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CREDENTIAL_SOURCE: Record<NonNullable<CloudCredentialSource>, string> = {
  token: 'a token you saved',
  gh: 'your gh login',
  subscription: 'MARSHMALLOW_CLAUDE_TOKEN from your environment',
  apiKey: 'an Anthropic API key you saved',
  login: "each Box's own sign-in, in the worker's terminal",
};
const source = (s: CloudCredentialSource) => (s ? `✓ ${CREDENTIAL_SOURCE[s]}` : '⚠ not set up yet');

const DAY_MODE_NAMES: Record<DayMode, string> = { cycle: 'A whole day every 30 minutes', clock: "Your computer's clock", day: 'Always mid-afternoon' };

/** The Upstash account's Boxes, a check of the key, and deleting Boxes whose worker is gone. */
function Boxes() {
  const cloud = useStore((s) => s.cloud);
  const [testing, go] = useBusy();
  const [note, setNote] = useState('');
  const b = cloud.boxes;
  return (
    <div className="console-row wrap">
      <span className="console-grow console-hint">{b ? `${plural(b.total, 'Box', 'Boxes')} on the account · this office: ${b.running} running, ${b.paused} paused` : 'Boxes not counted yet.'}</span>
      <button
        className="console-btn"
        disabled={testing}
        onClick={() => {
          setNote('');
          void go(run('POST', '/api/cloud/test')).then((ok) => ok && setNote('✓ Connected'));
        }}
      >
        {testing ? 'Checking…' : 'Test'}
      </button>
      {!!b?.orphans && (
        <ConfirmButton question={`Delete ${plural(b.orphans, 'orphaned Box', 'orphaned Boxes')} for good?`} confirm="Delete" onConfirm={() => void run('POST', '/api/cloud/orphans')}>
          Delete {plural(b.orphans, 'orphan')}
        </ConfirmButton>
      )}
      {note && <span className="console-good">{note}</span>}
    </div>
  );
}

function CloudCard({ form, set }: { form: SettingsForm; set: <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => void }) {
  const cloud = useStore((s) => s.cloud);
  const demo = useStore((s) => s.demo);
  return (
    <section className="console-card console-span">
      <h3 className="console-h">☁️ Cloud workers</h3>
      <p className="console-hint">
        Workers can work in an Upstash Box each instead of on this computer. A Box worker keeps going when the office is closed, and the office catches up when it's back. Box workers run Claude: a model
        on this computer can't be reached from a Box.
      </p>
      <div className="console-grid">
        <div>
          <h4 className="console-h4">Upstash account</h4>
          <SecretField
            label="Upstash Box API key"
            saved={cloud.keySet}
            hint={cloud.keyHint}
            placeholder={demo ? 'Any text works in the demo' : 'From console.upstash.com → Box → API keys'}
            save={(key) => run('PUT', '/api/cloud/key', { key })}
          />
          {cloud.keyError && <p className="console-bad">{cloud.keyError}</p>}
          {cloud.keySet && <Boxes />}
          <h4 className="console-h4">Where new workers work</h4>
          <div role="radiogroup" aria-label="Where new workers work">
            <label className="console-toggle">
              <input type="radio" name="machine-kind" checked={form.machineKind === 'local'} onChange={() => set('machineKind', 'local')} /> 🖥 On this computer
            </label>
            <label className="console-toggle">
              <input type="radio" name="machine-kind" checked={form.machineKind === 'box'} disabled={!cloud.keySet} onChange={() => set('machineKind', 'box')} /> ☁ In an Upstash Box each
              {!cloud.keySet && <span className="console-hint"> (save your API key first)</span>}
            </label>
          </div>
          <p className="console-hint">A worker already hired moves with its ☁ Move button on the Team tab, once it has no task.</p>
        </div>
        <div>
          <Field label="Box size">
            <select value={form.boxSize} onChange={(e) => set('boxSize', e.target.value as BoxSize)}>
              {BOX_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} · {BOX_SIZE_INFO[s].spec} · ${BOX_SIZE_INFO[s].usdPerCpuHour.toFixed(2)} per active CPU hour
                </option>
              ))}
            </select>
          </Field>
          <Field label="Your plan's Box limit" hint="The free plan's is 10, paused Boxes included. A Box worker isn't hired past it.">
            <input type="number" min={LIMITS.boxLimit[0]} max={LIMITS.boxLimit[1]} value={form.boxLimit} onChange={(e) => set('boxLimit', e.target.value)} />
          </Field>
          <h4 className="console-h4">How Box workers sign in</h4>
          <p className="console-row">
            <strong className="console-grow">GitHub</strong>
            <span className={cloud.github.ready ? 'console-good' : 'console-bad'}>{source(cloud.github.source)}</span>
          </p>
          <p className="console-hint">Your gh login is used unless you save a fine-grained token for your floors' repos (contents, pull requests and issues: read and write), which is safer.</p>
          <SecretField label="GitHub token for Boxes" saved={cloud.github.source === 'token'} hint={cloud.github.hint} placeholder="github_pat_…" save={(value) => run('PUT', '/api/cloud/token', { kind: 'github', value })} />
          <p className="console-row">
            <strong className="console-grow">Claude Code</strong>
            <span className={cloud.claude.ready ? 'console-good' : 'console-bad'}>{source(cloud.claude.source)}</span>
          </p>
          {cloud.claude.source !== 'subscription' && (
            <>
              <p className="console-hint">Each Box worker signs in with your Claude subscription in their own terminal (their 🔑 Sign in), unless you save an API key here, billed per token:</p>
              <SecretField label="Anthropic API key" saved={cloud.claude.source === 'apiKey'} hint={cloud.claude.hint} placeholder="sk-ant-…" save={(value) => run('PUT', '/api/cloud/token', { kind: 'anthropic', value })} />
              <details className="console-details">
                <summary>Or one subscription token for every Box</summary>
                <p className="console-hint">
                  Run <code>claude setup-token</code>, keep the token it prints in your environment as <code>MARSHMALLOW_CLAUDE_TOKEN</code>, and restart the office. The office never writes it down.
                </p>
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** The office clock (world/dayTime.ts follows it): the sky, the light and lunch, the same in every tab. */
function ClockCard({ form, set }: { form: SettingsForm; set: <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => void }) {
  return (
    <section className="console-card">
      <h3 className="console-h">🕐 Time</h3>
      <Field label="The office clock" hint="The sky, the lamps and lunch follow it, in every tab.">
        <select value={form.dayMode} onChange={(e) => set('dayMode', e.target.value as DayMode)}>
          {DAY_MODES.map((m) => (
            <option key={m} value={m}>
              {DAY_MODE_NAMES[m]}
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}

export function SettingsTab() {
  const settings = useStore((s) => s.settings);
  const usage = useStore((s) => s.usage);
  const base = useMemo(() => settingsForm(settings), [settings]);
  // Only what you changed is kept here, so a field you didn't touch follows the office (another tab, the CEO).
  const [edits, setEdits] = useState<FormEdits>({});
  useEffect(() => setEdits((e) => pruneEdits(e, base)), [base]);
  const form: SettingsForm = { ...base, ...edits };
  const { patch, problems } = settingsPatch(form, settings);
  const changes = Object.keys(patch).length;
  const blocked = Object.keys(problems).length > 0;
  const [saving, go] = useBusy();
  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setEdits((e) => ({ ...e, [k]: v }));
  const save = () => {
    if (changes && !blocked && !saving) void go(run('PATCH', '/api/settings', patch));
  };
  const enter = (e: KeyboardEvent) => e.key === 'Enter' && save();
  const text = (k: 'managerName' | 'companyName' | 'sessionLimit' | 'pacingSessions' | 'maxWorkers', o: { placeholder?: string; number?: readonly [number, number] } = {}) => (
    <input
      type={o.number ? 'number' : 'text'}
      min={o.number?.[0]}
      max={o.number?.[1]}
      value={form[k]}
      placeholder={o.placeholder}
      aria-invalid={!!problems[k]}
      onChange={(e) => set(k, e.target.value)}
      onKeyDown={enter}
    />
  );
  return (
    <div className="console-settings">
      <div className="console-grid">
        <section className="console-card">
          <h3 className="console-h">🏢 Company</h3>
          <Field label="Your name" problem={problems.managerName} hint="What the workers call you when they say hi.">
            {text('managerName', { placeholder: 'Boss' })}
          </Field>
          <Field label="Company name" problem={problems.companyName} hint="On the lobby's sign, the CEO's office and the billboards.">
            {text('companyName', { placeholder: 'Marshmallow' })}
          </Field>
        </section>
        <section className="console-card">
          <h3 className="console-h">🧠 Models</h3>
          <Field label="Default model" problem={problems.defaultModel} hint="A Claude model, or ollama/<name> for one on this computer. Each worker and the CEO can have their own (Team tab).">
            <ModelPick value={form.defaultModel} placeholder="claude-opus-5-5" label="Default model" onChange={(v) => set('defaultModel', v)} />
          </Field>
          <Field label="Default effort">
            <select value={form.defaultEffort} onChange={(e) => set('defaultEffort', e.target.value as SettingsForm['defaultEffort'])}>
              {EFFORTS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </Field>
        </section>
        <section className="console-card">
          <h3 className="console-h">⏱ Sessions</h3>
          <Field label="Session limit" problem={problems.sessionLimit} hint="The most sessions running at once. Empty: every worker with work runs.">
            {text('sessionLimit', { placeholder: 'No limit', number: LIMITS.sessionLimit })}
          </Field>
          <Field label="Sessions while pacing" problem={problems.pacingSessions} hint="After Claude's usage warning, new issues start only while fewer sessions than this run. QA, fixes and the CEO carry on.">
            {text('pacingSessions', { number: LIMITS.pacingSessions })}
          </Field>
          {usage.state !== 'normal' && (
            <p className="console-bad">
              {usage.state === 'paused' ? '⛔ Paused at the usage limit' : '🐢 Pacing after a usage warning'}
              {usage.until && ` until ${time(usage.until)}`}
            </p>
          )}
        </section>
        <section className="console-card">
          <h3 className="console-h">👥 Teams</h3>
          <Field label="Most workers per floor" problem={problems.maxWorkers} hint="Hiring past it is refused: by hand, by the rules and by the CEO.">
            {text('maxWorkers', { number: LIMITS.maxWorkers })}
          </Field>
          <label className="console-toggle">
            <input type="checkbox" checked={form.autoscale} onChange={(e) => set('autoscale', e.target.checked)} /> Autoscale: the rules grow and shrink each floor's team to fit its work (floors held at a size excepted)
          </label>
        </section>
        <CloudCard form={form} set={set} />
        <ClockCard form={form} set={set} />
      </div>
      {(changes > 0 || blocked) && (
        <div className="console-save" role="status">
          <span className="console-grow">{blocked ? 'Fix the fields in red to save.' : `${plural(changes, 'change')} not saved yet.`}</span>
          <button className="console-btn ghost" onClick={() => setEdits({})}>
            Undo
          </button>
          <button className="console-btn good" disabled={!changes || blocked || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
