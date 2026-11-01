// The first-run setup: what the office calls you, your company's name, how everyone in it is drawn (the body style,
// saved as soon as it's picked), and whether to hire a CEO (and on which model).
// It opens by itself until it's finished or skipped (settings.setupDone); closing it counts as skipping, and keeps the
// names you typed. Adapted from cubefarm client/src/ui/SetupWizard.tsx (MIT). Cut: the CEO's name, look and tie, the
// CEO's scaling mode, the first project (the end offers the console's Floors tab instead) and the tutorial.
import { useEffect, useState } from 'react';
import type { BodyStyle } from '../../../shared/types';
import { useStore } from '../store';
import { parseBodyStyle } from '../world/bodyStyle';
import { useView } from '../world/view';
import { ModelPick } from './console/fields';
import { showTab } from './console/nav';
import { clearProblem, hireCeo, run, useProblem } from './console/run';
import { BodyStylePick } from './BodyStylePick';
import { Panel } from './Panel';

const COMPANIES = ['Toasted Labs', 'Campfire Software', 'Gooey Bits', 'Puffball Inc.', 'Sugar Cube Studio', 'Fluffy Cloud Works', 'Hot Cocoa Systems', 'Pillow Fort Software', 'Golden Crust Co.', 'Sticky Fingers Ltd.'];
const STEPS = ['Welcome', 'You', 'The people', 'The CEO', 'Ready'];

const pickOther = (list: string[], current: string) => {
  const rest = list.filter((x) => x !== current);
  return rest[Math.floor(Math.random() * rest.length)];
};

export function SetupWizard() {
  const settings = useStore((s) => s.settings);
  const demo = useStore((s) => s.demo);
  const ceo = useStore((s) => Object.values(s.workers).find((w) => w.role === 'ceo') ?? null);
  const closeOverlay = useView((s) => s.closeOverlay);
  const problem = useProblem((s) => s.text);
  const [step, setStep] = useState(0);
  const [managerName, setManagerName] = useState(settings.managerName);
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [hire, setHire] = useState(true);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const style = parseBodyStyle(settings.bodyStyle);
  /** The body style goes to the office straight away: everyone (the office behind this, every tab) changes with it. */
  const pickStyle = (s: BodyStyle) => s !== style && void run('PATCH', '/api/settings', { bodyStyle: s });
  useEffect(() => clearProblem, []);

  const names = { managerName: managerName.trim(), companyName: companyName.trim() };
  const company = names.companyName || 'Marshmallow';
  const hiring = hire && !ceo;

  /** Skipping (or closing) keeps the names typed so far, hires nobody, and doesn't open again. */
  const skip = () => {
    void run('PATCH', '/api/settings', { ...names, setupDone: true });
    closeOverlay();
  };
  const finish = async (then?: () => void) => {
    setBusy(true);
    const ok = (await run('PATCH', '/api/settings', names)) && (!hiring || (await hireCeo(model))) && (await run('PATCH', '/api/settings', { setupDone: true }));
    setBusy(false);
    if (!ok) return;
    closeOverlay();
    then?.();
  };
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  return (
    <Panel onClose={skip} title="👋 Welcome to the office">
      <div className="wizard console">
        <div className="wizard-steps" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
          {STEPS.map((s, i) => (
            <span key={s} className={`wizard-dot${i === step ? ' on' : i < step ? ' done' : ''}`} title={s} />
          ))}
        </div>

        {step === 0 && (
          <>
            <div className="wizard-icon">🏢</div>
            <h2>Marshmallow</h2>
            <p className="wizard-tag">Your own cartoon software company, staffed by Claude Code workers who build, test and merge your GitHub issues.</p>
            <ul className="wizard-list">
              <li>🏢 Every repository gets a floor, with a team that builds its issues on branches and opens pull requests.</li>
              <li>🔍 Another worker tests each pull request in a fresh session, and what passes is merged.</li>
              <li>👥 Teams grow and shrink with the work, and idle workers wander off for coffee, chats and lunch.</li>
              {demo && <li>🧪 This is the demo: a pretend GitHub and pretend sessions, so nothing real is touched.</li>}
            </ul>
            <button className="wizard-go" onClick={next}>
              Let's set up your company
            </button>
            <p className="wizard-meta">
              <button className="link" onClick={skip}>
                Skip the setup
              </button>
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <div className="wizard-icon">🧑‍💼</div>
            <h2>Who's the boss?</h2>
            <p className="wizard-tag">That's you: you run the company, the workers do the typing.</p>
            <label className="console-field">
              <span className="console-field-label">Your name</span>
              <input value={managerName} placeholder="Boss" autoFocus onChange={(e) => setManagerName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && next()} />
              <small className="console-hint">What the workers call you when they say hi.</small>
            </label>
            <label className="console-field">
              <span className="console-field-label">Company name</span>
              <span className="console-row">
                <input className="console-grow" value={companyName} placeholder="Marshmallow" onChange={(e) => setCompanyName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && next()} />
                <button type="button" className="console-btn" title="Suggest a name" onClick={() => setCompanyName(pickOther(COMPANIES, companyName))}>
                  🎲
                </button>
              </span>
              <small className="console-hint">It goes on the lobby's sign and the billboards.</small>
            </label>
            <p className="console-hint">You can change either any time in the manager's console (O).</p>
          </>
        )}

        {step === 2 && (
          <>
            <div className="wizard-icon">🧑‍🤝‍🧑</div>
            <h2>How do your people look?</h2>
            <p className="wizard-tag">Everyone in the office is drawn in one style: the workers, the CEO, the guide at the front desk and you.</p>
            <BodyStylePick value={style} onPick={pickStyle} />
            <p className="console-hint">Change it any time in the manager's console (O), on its Settings tab.</p>
          </>
        )}

        {step === 3 && (
          <>
            <div className="wizard-icon">🧠</div>
            <h2>A CEO?</h2>
            <p className="wizard-tag">
              A CEO studies each new floor (what the project is, how QA should test it, how big its team should be), turns the briefs you give it into GitHub issues, talks your ideas through on the
              desktop and proposes them as projects. Each of those is a session{demo ? ' (pretend ones in the demo)' : ''}.
            </p>
            {ceo ? (
              <p className="console-done">
                You have a CEO already: <strong>{ceo.name}</strong>.
              </p>
            ) : (
              <div role="radiogroup" aria-label="Hire a CEO">
                <label className="console-toggle wizard-choice">
                  <input type="radio" name="hire-ceo" checked={hire} onChange={() => setHire(true)} />
                  <span>
                    <strong>Hire a CEO</strong>
                    {hire && (
                      <span className="console-row wizard-model">
                        <span className="console-hint">on</span>
                        <ModelPick value={model} placeholder={`${settings.defaultModel} (the default)`} label="The CEO's model" onChange={setModel} />
                      </span>
                    )}
                    <small className="console-hint">A Claude model, or ollama/&lt;name&gt; to try one on this computer first.</small>
                  </span>
                </label>
                <label className="console-toggle wizard-choice">
                  <input type="radio" name="hire-ceo" checked={!hire} onChange={() => setHire(false)} />
                  <span>
                    <strong>Not now</strong>
                    <small className="console-hint">The rules size the teams, and you write the issues on GitHub. Hire one later on the console's Team tab.</small>
                  </span>
                </label>
              </div>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <div className="wizard-icon">🎉</div>
            <h2>{company} is open for business</h2>
            <ul className="wizard-list">
              <li>🧠 {ceo ? `${ceo.name} is your CEO.` : hiring ? 'Your CEO studies each floor as soon as you connect it.' : "No CEO for now: hire one any time on the console's Team tab."}</li>
              <li>
                🗂 Press <kbd>O</kbd> for the manager's console: connect a repository on its Floors tab to open your first floor.
              </li>
              <li>
                🖥 <kbd>P</kbd> is your desktop, for chats with the CEO, discussions and the workers' questions; <kbd>H</kbd> shows every control.
              </li>
            </ul>
            <div className="wizard-ends">
              <button className="wizard-go" disabled={busy} onClick={() => void finish(() => showTab('floors'))}>
                ➕ Connect a repository
              </button>
              <button className="console-btn" disabled={busy} onClick={() => void finish()}>
                {busy ? 'Opening the doors…' : 'Just enter the office'}
              </button>
            </div>
          </>
        )}

        {problem && (
          <p className="console-problem" role="alert">
            <span>{problem}</span>
          </p>
        )}

        {step > 0 && (
          <div className="wizard-nav">
            <button className="console-btn ghost" disabled={busy} onClick={() => setStep(step - 1)}>
              ← Back
            </button>
            <span className="console-grow" />
            {step < STEPS.length - 1 && (
              <button className="console-btn good" onClick={next}>
                Next →
              </button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
