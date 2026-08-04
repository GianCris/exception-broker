type ApprovalView = Readonly<{ actorId: string; planId: string; roleLabel: string; decision: string; decisionLabel: string; createdAt: string }>;

export const ApprovalCards = ({ approvals, finalPlanId }: Readonly<{ approvals: readonly ApprovalView[]; finalPlanId: string | null }>) => (
  <section className="section" aria-labelledby="approvals-title">
    <div className="section-heading"><div><p className="eyebrow">Three-party consent</p><h2 id="approvals-title">Final approvals</h2></div><p>Supplier, Production and Client approved the same plan: <strong>{finalPlanId}</strong>.</p></div>
    <div className="approval-grid">{approvals.map((approval) => (
      <article className="approval-card" key={`${approval.actorId}-${approval.planId}`}>
        <span className="approval-check" aria-hidden="true">✓</span>
        <div><h3>{approval.roleLabel}</h3><p className="decision-label">{approval.decisionLabel}</p><time>{approval.createdAt}</time></div>
        <span className="decision-code">{approval.planId}</span>
      </article>
    ))}</div>
  </section>
);
