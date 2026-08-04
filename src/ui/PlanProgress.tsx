import type { PlanViewModel } from '../presentation/case001ViewModel.js';

const PlanExplanation = ({ plan }: Readonly<{ plan: PlanViewModel }>) => {
  const explanation = plan.explanation;
  if (explanation.kind === 'no-solution') {
    return <div className="no-solution-evidence">
      <div><strong>{explanation.requiredTomorrow}</strong><span>required</span></div>
      <div><strong>{explanation.availableTomorrow}</strong><span>available</span></div>
      <p>Shortfall: <strong>{explanation.shortfall}</strong></p>
    </div>;
  }
  if (explanation.kind === 'final') {
    return <p className="unlock-message">Unlocked after client limit changed from <strong>{explanation.unlockPreviousValue}</strong> to <strong>{explanation.unlockNewValue}</strong></p>;
  }
  return <div className="rejection-evidence">
    <strong>{explanation.proposedSubstitutes} substitutes proposed</strong>
    <span>Client limit: {explanation.clientLimit}</span>
    <p>{explanation.reason}</p>
  </div>;
};

const PlanCard = ({ plan }: Readonly<{ plan: PlanViewModel }>) => (
  <article className={`plan-card${plan.isFinal ? ' final-plan-card' : ''}`} data-testid="plan-card">
    {plan.isFinal ? <p className="final-plan-label">Final approved plan</p> : null}
    <div className="plan-card-heading">
      <div><p className="plan-version">Version {plan.version}</p><h3>{plan.id}</h3></div>
      <span className={`status-badge status-${plan.status.toLowerCase()}`}><span aria-hidden="true">●</span> {plan.statusLabel}</span>
    </div>
    <PlanExplanation plan={plan} />
    <dl className="plan-summary">
      <div><dt>Tomorrow</dt><dd>{plan.tomorrowTotal}</dd></div>
      <div><dt>Later</dt><dd>{plan.originalLater}</dd></div>
      <div><dt>Substitutes</dt><dd>{plan.substituteTomorrow}</dd></div>
      <div><dt>Client cost</dt><dd>{plan.clientAdditionalCost}</dd></div>
    </dl>
    {plan.isFinal ? <div className="final-details">
      <div><p className="detail-title">Tomorrow delivery</p><dl><div><dt>Original units</dt><dd>{plan.originalTomorrow}</dd></div><div><dt>Substitute units</dt><dd>{plan.substituteTomorrow}</dd></div></dl></div>
      <div><p className="detail-title">Later delivery</p><dl><div><dt>Original units</dt><dd>{plan.originalLater}</dd></div><div><dt>Delivery date</dt><dd>{plan.laterDeliveryDate}</dd></div></dl></div>
      <div><p className="detail-title">Cost allocation</p><dl>{plan.costAllocation.map((item) => <div key={item.role}><dt>{item.label}</dt><dd>{item.cost}</dd></div>)}</dl></div>
      {plan.validationPassed ? <p className="validation-badge"><span aria-hidden="true">✓</span> R-01 to R-10 passed</p> : null}
    </div> : null}
  </article>
);

export const PlanProgress = ({ plans }: Readonly<{ plans: readonly PlanViewModel[] }>) => (
  <section className="section" aria-labelledby="plan-progress-title">
    <div className="section-heading"><div><p className="eyebrow">Resolution path</p><h2 id="plan-progress-title">How the exception was resolved</h2></div><p>Each version preserves the decision that led to the approved recovery plan.</p></div>
    <div className="plan-progress">{plans.map((plan) => <div className="plan-step" key={plan.id}><PlanCard plan={plan} /></div>)}</div>
  </section>
);

export const FinalPlanCard = ({ plan }: Readonly<{ plan: PlanViewModel }>) => (
  <section className="section final-plan-result" aria-label="Final approved plan result">
    <PlanCard plan={plan} />
  </section>
);
