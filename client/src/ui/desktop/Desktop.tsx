// The desktop: a computer screen over the view, in place of cubefarm's phone. P or the HUD's Desktop button turns it
// on, and again (or Esc) puts it away. Its apps fill the screen: Chat (the CEO, a conversation per idea), Discussions
// (threads to settle with the CEO, and the workers' questions) and Notices; the taskbar has them with their badges,
// and a clock. It opens on Discussions when something waits on you, else on Chat. Adapted from cubefarm
// client/src/ui/Phone.tsx (MIT): the phone's tabs became apps, and the CEO's single chat became chats and discussions.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useView, type DesktopApp } from '../../world/view';
import { ChatApp } from './ChatApp';
import { waitingCount } from './desk';
import { DiscussionsApp } from './DiscussionsApp';
import { NoticesApp } from './NoticesApp';
import { useCeo } from './parts';
import { useDesktopNews } from './seen';
import './desktop.css';
import './probe';

const APPS: { id: DesktopApp; icon: string; label: string }[] = [
  { id: 'chat', icon: '💬', label: 'Chat' },
  { id: 'discussions', icon: '🗣', label: 'Discussions' },
  { id: 'notices', icon: '🔔', label: 'Notices' },
];

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="dt-clock" aria-label="The time">
      <b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
      <span>{now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>
    </div>
  );
}

export function Desktop({ app }: { app?: DesktopApp }) {
  const close = useView((s) => s.closeOverlay);
  const company = useStore((s) => s.settings.companyName) || 'Marshmallow';
  const ceo = useCeo();
  const news = useDesktopNews();
  // Something waiting on you is why you'd turn it on: it opens there.
  const [current, setCurrent] = useState<DesktopApp>(() => {
    if (app) return app;
    const s = useStore.getState();
    return waitingCount(s.desk.discussions, s.questions) > 0 ? 'discussions' : 'chat';
  });
  useEffect(() => {
    if (app) setCurrent(app);
  }, [app]);
  // Esc puts it away from anywhere, a text box included (P does too, through OfficeKeys, outside one). Marked handled,
  // so the overview doesn't take it as "leave" (Player.tsx); the small forms inside that keep Esc for themselves stop it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const badge: Record<DesktopApp, number> = { chat: news.chats, discussions: news.discussions, notices: current === 'notices' ? 0 : news.notices };
  const sub: Record<DesktopApp, string> = {
    chat: ceo ? `with ${ceo.name}, your CEO` : 'no CEO yet',
    discussions: news.discussions ? `${news.discussions} waiting on you` : 'nothing waiting on you',
    notices: 'from the office and the CEO',
  };
  const shown = APPS.find((a) => a.id === current)!;
  return (
    <div className="panel-backdrop dt-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dt-monitor" role="dialog" aria-modal="true" aria-label="Your desktop">
        <div className="dt-screen">
          <div className="dt-window">
            <header className="dt-window-bar">
              <span className="dt-window-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <h2 className="dt-window-title">
                <span aria-hidden>{shown.icon}</span> {shown.label}
                <span className="dt-window-sub"> · {sub[current]}</span>
              </h2>
              <button className="dt-window-close" onClick={close} aria-label="Put the desktop away" title="Put it away (P or Esc)">
                ✕
              </button>
            </header>
            <div className="dt-window-body" role="tabpanel" aria-label={shown.label}>
              {current === 'chat' && <ChatApp />}
              {current === 'discussions' && <DiscussionsApp />}
              {current === 'notices' && <NoticesApp />}
            </div>
          </div>
          <nav className="dt-taskbar" aria-label="Apps">
            <div className="dt-brand" title={company}>
              <span className="dt-brand-logo" aria-hidden>
                🍡
              </span>
              <span className="dt-brand-name">{company}</span>
            </div>
            <div className="dt-apps" role="tablist">
              {APPS.map((a) => {
                const n = badge[a.id];
                return (
                  <button key={a.id} role="tab" aria-selected={current === a.id} aria-label={n > 0 ? `${a.label}, ${n} new` : a.label} className={`dt-app dt-app-${a.id}${current === a.id ? ' on' : ''}`} onClick={() => setCurrent(a.id)}>
                    <span className="dt-app-icon" aria-hidden>
                      {a.icon}
                      {n > 0 && (
                        <span key={n} className="dt-badge">
                          {n > 99 ? '99+' : n}
                        </span>
                      )}
                    </span>
                    <span className="dt-app-label">{a.label}</span>
                  </button>
                );
              })}
            </div>
            <Clock />
          </nav>
        </div>
        <div className="dt-chin" aria-hidden>
          <span className="dt-led" />
          <span>
            <kbd>P</kbd> or <kbd>Esc</kbd> puts it away · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
          </span>
        </div>
      </section>
    </div>
  );
}
