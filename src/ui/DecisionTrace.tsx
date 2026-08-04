import { useId, useState } from 'react';

type EventView = Readonly<{
  id: string;
  date: string;
  time: string;
  type: string;
  typeLabel: string;
  planId?: string | undefined;
  actorId?: string | undefined;
  message: string;
}>;

export const DecisionTrace = ({ events }: Readonly<{ events: readonly EventView[] }>) => {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <section className="section trace-section" aria-labelledby="trace-title">
      <button
        className="trace-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <span><span className="trace-icon" aria-hidden="true">≡</span><strong id="trace-title">View decision trace</strong><small>Audit every decision and constraint update</small></span>
        <span className="toggle-symbol" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <div className="trace-content" id={contentId}>
          <ol className="timeline">
            {events.map((event) => (
              <li key={event.id}>
                <div className="timeline-time"><time>{event.time}</time><span>{event.date}</span></div>
                <div className="timeline-marker" aria-hidden="true" />
                <article className="event-card">
                  <div className="event-meta"><span>{event.typeLabel}</span>{event.planId ? <strong>{event.planId}</strong> : null}{event.actorId ? <strong>{event.actorId}</strong> : null}</div>
                  <p>{event.message}</p>
                </article>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
};
