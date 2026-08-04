type AuthorizationChangeView = Readonly<{
  actorLabel: string;
  fieldLabel: string;
  previousValue: number;
  newValue: number;
  reason: string;
  createdAt: string;
}>;

export const AuthorizationChangeCard = ({
  changes,
}: Readonly<{ changes: readonly AuthorizationChangeView[] }>) => (
  <section className="section" aria-labelledby="authorization-title">
    <div className="section-heading compact">
      <div>
        <p className="eyebrow">Constraint update</p>
        <h2 id="authorization-title">Authorization change</h2>
      </div>
    </div>
    <div className="authorization-grid">
      {changes.map((change) => (
        <article className="authorization-card" key={`${change.fieldLabel}-${change.createdAt}`}>
          <div className="authorization-icon" aria-hidden="true">↗</div>
          <div className="authorization-content">
            <p className="authorization-kicker">{change.actorLabel} authorization updated</p>
            <h3>{change.fieldLabel}</h3>
            <div className="value-change" aria-label={`${change.previousValue} changed to ${change.newValue}`}>
              <span>{change.previousValue}</span><span aria-hidden="true">→</span><strong>{change.newValue}</strong>
            </div>
            <p className="reason"><strong>Reason:</strong> {change.reason}</p>
            <time>{change.createdAt}</time>
          </div>
        </article>
      ))}
    </div>
  </section>
);
