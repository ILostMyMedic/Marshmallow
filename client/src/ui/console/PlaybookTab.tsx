// The console's Playbook tab: the office's and each floor's agent docs, which every worker session on a floor gets
// without anything committed to its repository. Rules go into the session's system prompt (paid on every turn, so the
// tab shows their size); skills, subagents and commands go into a plugin the office writes for the session. Scope tabs
// for the office and each floor; the docs by kind with a switch each; an editor with a live size readout; templates to
// start from; and a preview of what a worker on the floor gets. Commands go over REST; the playbook comes back over
// /ws. playbook.ts has the logic. New in Marshmallow.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { KIND_NAMES, PLUGIN_NAME, type PlaybookDoc, type PlaybookKind } from '../../../../shared/playbook';
import type { Floor } from '../../../../shared/types';
import { useStore } from '../../store';
import { ConfirmButton, FloorBadge } from './fields';
import { showTab } from './nav';
import {
  blankForm,
  docForm,
  docGroups,
  docReadout,
  entryUse,
  formDraft,
  formPatch,
  formProblems,
  nameTaken,
  placeholderHints,
  placeOf,
  preview,
  rulesReadout,
  templateCards,
  type DocForm,
  type PlaybookPlace,
} from './playbook';
import { run, useBusy } from './run';
import './playbook.css';

/** What the right-hand pane shows. */
type Pane = { kind: 'preview' } | { kind: 'templates' } | { kind: 'edit'; id: number } | { kind: 'new'; docKind: PlaybookKind };

const shortName = (f: Floor) => f.fullName.split('/').pop() ?? f.fullName;
const placeName = (place: PlaybookPlace, floor: Floor | undefined) => (place.scope === 'office' ? 'the office' : floor ? `floor ${floor.floor}` : 'this floor');

export function PlaybookTab({ floorId }: { floorId?: string }) {
  const floors = useStore((s) => s.floors);
  const docs = useStore((s) => s.playbook.docs);
  const place = placeOf(floors, floorId);
  const floor = floors.find((f) => f.id === place.floorId);
  const [pane, setPane] = useState<Pane>({ kind: 'preview' });
  // A new scope opens on its preview; a doc that's gone (deleted, or in another tab) does too.
  useEffect(() => setPane({ kind: 'preview' }), [place.floorId]);
  useEffect(() => {
    if (pane.kind === 'edit' && !docs.some((d) => d.id === pane.id)) setPane({ kind: 'preview' });
  }, [docs, pane]);
  const groups = docGroups(docs, place);
  const pb = useMemo(() => preview(docs, floors, place), [docs, floors, place.scope, place.floorId]);
  const size = rulesReadout(pb);
  const editing = pane.kind === 'edit' ? docs.find((d) => d.id === pane.id) : undefined;

  return (
    <div className="pb" style={{ '--floor': floor?.color ?? '#9b5de5' } as CSSProperties}>
      <div className="console-row wrap console-floor-picks" role="tablist" aria-label="Whose playbook">
        <button role="tab" aria-selected={place.scope === 'office'} className={`console-pick pb-office${place.scope === 'office' ? ' on' : ''}`} onClick={() => showTab('playbook')}>
          <span className="pb-office-icon" aria-hidden>
            🏢
          </span>
          The office
        </button>
        {floors.map((f) => (
          <button key={f.id} role="tab" aria-selected={f.id === place.floorId} className={`console-pick${f.id === place.floorId ? ' on' : ''}`} style={{ borderColor: f.color }} onClick={() => showTab('playbook', f.id)}>
            <FloorBadge floor={f.floor} color={f.color} /> {shortName(f)}
          </button>
        ))}
      </div>
      <p className="console-hint pb-intro">
        {place.scope === 'office'
          ? 'The office’s docs go to every session on every floor, before each floor’s own. The CEO gets the office’s rules only.'
          : `${floor?.fullName ?? 'This floor'}’s own docs, on top of the office’s. A skill, subagent or command named like an office one replaces it here.`}{' '}
        Nothing is committed to a repository: the office hands them to each session as it starts.
      </p>

      <div className="pb-body">
        <aside className="pb-side" aria-label="Docs">
          <div className={`pb-meter${size.heavy ? ' heavy' : ''}`} role="status">
            <strong>{place.scope === 'office' ? 'Every session’s rules from the office' : `A session on ${placeName(place, floor)}`}</strong>
            <span>{size.text}</span>
          </div>
          {groups.map((g) => (
            <section key={g.kind} className="pb-group">
              <h4 className="pb-group-h">
                <span aria-hidden>{g.icon}</span> {g.title}
                {g.docs.length > 0 && <span className="pb-count">{g.docs.length}</span>}
                <button className="console-btn small ghost pb-add" title={`A new ${KIND_NAMES[g.kind].one} doc for ${placeName(place, floor)}`} onClick={() => setPane({ kind: 'new', docKind: g.kind })}>
                  + New
                </button>
              </h4>
              <p className="pb-group-hint">{g.hint}</p>
              {g.docs.length === 0 ? (
                <p className="pb-none">None yet.</p>
              ) : (
                <ul className="pb-docs">
                  {g.docs.map((d) => (
                    <DocRow key={d.id} d={d} on={pane.kind === 'edit' && pane.id === d.id} onOpen={() => setPane({ kind: 'edit', id: d.id })} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </aside>

        <section className="pb-main">
          <div className="pb-panes" role="tablist" aria-label="Playbook view">
            <button role="tab" aria-selected={pane.kind === 'preview'} className={`pb-pane${pane.kind === 'preview' ? ' on' : ''}`} onClick={() => setPane({ kind: 'preview' })}>
              👀 What a worker gets
            </button>
            <button role="tab" aria-selected={pane.kind === 'templates'} className={`pb-pane${pane.kind === 'templates' ? ' on' : ''}`} onClick={() => setPane({ kind: 'templates' })}>
              📚 Templates
            </button>
            {(pane.kind === 'edit' || pane.kind === 'new') && (
              <button role="tab" aria-selected className="pb-pane on">
                ✏️ {pane.kind === 'new' ? `New ${KIND_NAMES[pane.docKind].one}` : (editing?.name ?? 'Editor')}
              </button>
            )}
          </div>
          {pane.kind === 'preview' && <Preview place={place} floor={floor} />}
          {pane.kind === 'templates' && <Templates place={place} floor={floor} onAdded={(id) => setPane({ kind: 'edit', id })} />}
          {pane.kind === 'new' && <Editor key={`new:${pane.docKind}:${place.floorId}`} kind={pane.docKind} doc={null} place={place} floor={floor} onSaved={(id) => setPane({ kind: 'edit', id })} onClose={() => setPane({ kind: 'preview' })} />}
          {pane.kind === 'edit' && editing && <Editor key={`${editing.id}:${editing.updatedAt}`} kind={editing.kind} doc={editing} place={place} floor={floor} onSaved={() => undefined} onClose={() => setPane({ kind: 'preview' })} />}
        </section>
      </div>
    </div>
  );
}

/** A doc in the list: its switch, its name (which opens it) and its size. */
function DocRow({ d, on, onOpen }: { d: PlaybookDoc; on: boolean; onOpen: () => void }) {
  const [busy, go] = useBusy();
  const lines = d.body ? d.body.split('\n').length : 0;
  return (
    <li className={`pb-doc${on ? ' on' : ''}${d.enabled ? '' : ' off'}`}>
      <label className="pb-switch" title={d.enabled ? 'On: sessions get it. Click to switch it off.' : 'Off: sessions don’t get it. Click to switch it on.'}>
        <input type="checkbox" role="switch" checked={d.enabled} disabled={busy} aria-label={`${d.name} on`} onChange={(e) => void go(run('POST', `/api/playbook/docs/${d.id}/enable`, { enabled: e.target.checked }))} />
        <span aria-hidden />
      </label>
      <button className="pb-doc-name" onClick={onOpen} aria-current={on}>
        <span className="pb-doc-title">{d.name}</span>
        <span className="pb-doc-meta">{d.description || `${lines} line${lines === 1 ? '' : 's'}`}</span>
      </button>
    </li>
  );
}

const DESCRIPTION_HINTS: Record<PlaybookKind, string> = {
  rules: 'A note for you: sessions don’t see it.',
  skill: 'When a worker should use it: Claude picks skills by this line.',
  agent: 'When a worker should hand it a job: Claude picks subagents by this line.',
  command: 'What it does, shown in the command list.',
};

const BODY_HINTS: Record<PlaybookKind, string> = {
  rules: 'Markdown, appended to the system prompt: how branches and PRs work here, when a task is done, what not to touch.',
  skill: 'The SKILL.md body: steps a worker follows when the skill fits.',
  agent: 'The subagent’s system prompt.',
  command: 'The prompt the command sends. $ARGUMENTS is what follows it.',
};

/** A doc's editor: name, description, (a subagent's tools and model), the markdown, a live size readout, and Save. */
function Editor({ kind, doc, place, floor, onSaved, onClose }: { kind: PlaybookKind; doc: PlaybookDoc | null; place: PlaybookPlace; floor: Floor | undefined; onSaved: (id: number) => void; onClose: () => void }) {
  const docs = useStore((s) => s.playbook.docs);
  const floors = useStore((s) => s.floors);
  const [form, setForm] = useState<DocForm>(() => (doc ? docForm(doc) : blankForm(kind)));
  const [saving, go] = useBusy();
  const problems = formProblems(form, kind);
  const taken = nameTaken(docs, kind, place, form.name, doc?.id ?? null);
  const patch = doc ? formPatch(form, doc) : null;
  const dirty = doc ? Object.keys(patch!).length > 0 : true;
  const blocked = Object.keys(problems).length > 0 || taken;
  const readout = docReadout(kind, form);
  const set = <K extends keyof DocForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (blocked || !dirty) return;
    const out = doc ? await go(run<PlaybookDoc>('PATCH', `/api/playbook/docs/${doc.id}`, patch)) : await go(run<PlaybookDoc>('POST', '/api/playbook/docs', formDraft(form, kind, place)));
    if (out) onSaved(out.id);
  };
  const names = KIND_NAMES[kind];
  return (
    <form
      className="pb-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="pb-editor-head">
        <span className="pb-kind-icon" aria-hidden>
          {names.icon}
        </span>
        <div className="console-grow">
          <div className="pb-kicker">
            {doc ? 'Editing' : 'New'} {names.one} · {placeName(place, floor)}
          </div>
          <strong>{doc?.name || form.name || `A new ${names.one}`}</strong>
        </div>
        {doc && <span className={`console-chip${doc.enabled ? '' : ' warn'}`}>{doc.enabled ? 'on' : 'off'}</span>}
      </div>
      <div className="pb-fields">
        <label className="console-field">
          <span className="console-field-label">Name</span>
          <input value={form.name} placeholder={kind === 'rules' ? 'work-branch-flow' : kind === 'skill' ? 'write-tests' : kind === 'agent' ? 'reviewer' : 'release-notes'} spellCheck={false} aria-invalid={!!problems.name || taken} onChange={(e) => set('name', e.target.value)} />
          {problems.name || taken ? <small className="console-bad">{taken ? `${placeName(place, floor)} has a ${names.one} named that already` : problems.name}</small> : kind !== 'rules' && <small className="console-hint">Workers reach it as {entryUse({ kind, name: form.name.trim() || 'name' })}</small>}
        </label>
        <label className="console-field">
          <span className="console-field-label">Description</span>
          <input value={form.description} placeholder={kind === 'rules' ? 'Optional' : 'Use when…'} aria-invalid={!!problems.description} onChange={(e) => set('description', e.target.value)} />
          {problems.description ? <small className="console-bad">{problems.description}</small> : <small className="console-hint">{DESCRIPTION_HINTS[kind]}</small>}
        </label>
        {kind === 'agent' && (
          <div className="pb-agent-row">
            <label className="console-field">
              <span className="console-field-label">Tools</span>
              <input value={form.tools} placeholder="All of the session’s" spellCheck={false} aria-invalid={!!problems.tools} onChange={(e) => set('tools', e.target.value)} />
              {problems.tools ? <small className="console-bad">{problems.tools}</small> : <small className="console-hint">Comma-separated, like Read, Grep, Bash</small>}
            </label>
            <label className="console-field">
              <span className="console-field-label">Model</span>
              <input value={form.model} placeholder="The session’s" spellCheck={false} aria-invalid={!!problems.model} onChange={(e) => set('model', e.target.value)} />
              {problems.model ? <small className="console-bad">{problems.model}</small> : <small className="console-hint">sonnet, opus, haiku or a model id</small>}
            </label>
          </div>
        )}
      </div>
      <label className="console-field pb-body-field">
        <span className="console-field-label">{kind === 'rules' ? 'The rules' : 'The text'}</span>
        <textarea className="pb-text" rows={14} value={form.body} spellCheck={false} aria-invalid={!!problems.body} onChange={(e) => set('body', e.target.value)} />
        {problems.body ? <small className="console-bad">{problems.body}</small> : <small className="console-hint">{BODY_HINTS[kind]}</small>}
      </label>
      <p className={`pb-readout${readout.heavy ? ' heavy' : ''}`} role="status">
        📏 {readout.text}
      </p>
      <div className="pb-placeholders">
        <span className="console-hint">Filled in for each floor:</span>
        {placeholderHints(floors, place).map((p) => (
          <span key={p.key} className="console-chip" title={`Becomes ${p.value}`}>
            <code>{p.key}</code> → {p.value}
          </span>
        ))}
      </div>
      <div className="pb-editor-foot">
        {doc && (
          <ConfirmButton question={`Delete ${doc.name}?`} confirm="Delete" onConfirm={() => void run('DELETE', `/api/playbook/docs/${doc.id}`).then((ok) => ok && onClose())}>
            🗑 Delete
          </ConfirmButton>
        )}
        <span className="console-grow console-hint">{doc ? (dirty ? 'Not saved yet.' : 'Saved. Sessions starting from now get it.') : 'Sessions starting after you save get it.'}</span>
        <button type="button" className="console-btn ghost" onClick={() => (doc && dirty ? setForm(docForm(doc)) : onClose())}>
          {doc && dirty ? 'Undo' : 'Close'}
        </button>
        <button className="console-btn good" disabled={saving || blocked || !dirty}>
          {saving ? 'Saving…' : doc ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  );
}

/** The templates, each added to the place in a click (once). */
function Templates({ place, floor, onAdded }: { place: PlaybookPlace; floor: Floor | undefined; onAdded: (id: number) => void }) {
  const docs = useStore((s) => s.playbook.docs);
  const [busy, setBusy] = useState<string | null>(null);
  const add = async (id: string) => {
    setBusy(id);
    const out = await run<PlaybookDoc>('POST', `/api/playbook/templates/${id}/apply`, place);
    setBusy(null);
    if (out) onAdded(out.id);
  };
  return (
    <div className="pb-templates">
      <p className="console-hint">Start from one of these and make it yours. Placeholders like {'{workBranch}'} are filled in for each floor when a session starts.</p>
      <div className="pb-template-grid">
        {templateCards(docs, place).map(({ template: t, added, fromOffice }) => (
          <article key={t.id} className={`pb-template${added ? ' added' : ''}`}>
            <div className="pb-template-head">
              <span className="pb-kind-icon small" aria-hidden>
                {KIND_NAMES[t.kind].icon}
              </span>
              <strong className="console-grow">{t.title}</strong>
              <span className="console-chip">{KIND_NAMES[t.kind].one}</span>
            </div>
            <p className="pb-template-blurb">{t.blurb}</p>
            <details className="pb-template-text">
              <summary>Read it</summary>
              <pre className="console-pre">{t.body}</pre>
            </details>
            <div className="pb-template-foot">
              {added ? (
                <span className="console-good">✓ On {placeName(place, floor)}</span>
              ) : fromOffice ? (
                <>
                  <span className="console-good console-grow">✓ From the office</span>
                  <button className="console-btn small ghost" disabled={busy !== null} title={t.kind === 'rules' ? 'The floor would get both: the office’s and its own' : 'The floor’s own replaces the office’s here'} onClick={() => void add(t.id)}>
                    {busy === t.id ? 'Adding…' : 'Add a floor copy'}
                  </button>
                </>
              ) : (
                <button className="console-btn good" disabled={busy !== null} onClick={() => void add(t.id)}>
                  {busy === t.id ? 'Adding…' : `Add to ${placeName(place, floor)}`}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/** What a worker's session gets: the rules after the office's instructions, the plugin's entries, and whose setup. */
function Preview({ place, floor }: { place: PlaybookPlace; floor: Floor | undefined }) {
  const docs = useStore((s) => s.playbook.docs);
  const floors = useStore((s) => s.floors);
  const own = useStore((s) => s.settings.workersUseMySetup);
  const pb = preview(docs, floors, place);
  const size = rulesReadout(pb);
  return (
    <div className="pb-preview">
      <p className="pb-preview-lead">
        {place.scope === 'office'
          ? 'Every floor’s sessions get these from the office, before the floor’s own, with the placeholders filled in for the floor:'
          : `A worker’s session on ${floor ? `floor ${floor.floor} (${floor.fullName})` : 'this floor'} gets, besides its task:`}
      </p>
      <section className="pb-preview-part">
        <h4 className="console-h4">
          📜 Rules, after the office’s instructions for the task {pb.rulesDocs.length > 0 && <span className="console-hint">· {pb.rulesDocs.map((d) => `${d.name}${place.scope === 'floor' ? ` (${d.scope === 'office' ? 'office' : 'floor'})` : ''}`).join(', ')}</span>}
        </h4>
        <p className={`pb-readout${size.heavy ? ' heavy' : ''}`}>📏 {size.text}</p>
        {pb.rules && <pre className="console-pre pb-rules">{pb.rules}</pre>}
      </section>
      <section className="pb-preview-part">
        <h4 className="console-h4">
          🧩 The {PLUGIN_NAME} plugin <span className="console-hint">· loaded with --plugin-dir; each entry costs only its description until it’s used</span>
        </h4>
        {pb.entries.length === 0 ? (
          <p className="pb-none">No skills, subagents or commands: the session starts without a plugin.</p>
        ) : (
          <ul className="pb-entries">
            {pb.entries.map((e) => (
              <li key={e.path}>
                <span aria-hidden>{KIND_NAMES[e.kind].icon}</span>
                <strong>{e.name}</strong>
                <span className="console-chip">{KIND_NAMES[e.kind].one}</span>
                {place.scope === 'floor' && <span className="console-chip">{e.scope === 'office' ? 'from the office' : 'this floor’s'}</span>}
                <code className="pb-path">plugin/{e.path}</code>
                <span className="console-hint">{entryUse(e)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="pb-preview-part">
        <h4 className="console-h4">🧳 Whose setup</h4>
        <p className="pb-setup">
          {own ? '✓ Your own Claude setup comes along too: your settings, CLAUDE.md, skills, plugins and memory.' : '✓ Not yours: the repository’s own CLAUDE.md and settings, and the above. Your sign-in is used, nothing else of your setup.'}{' '}
          <button className="console-btn small ghost" onClick={() => showTab('settings')}>
            Change in Settings
          </button>
        </p>
      </section>
    </div>
  );
}
