import type { PlanViewModel } from '../presentation/case001ViewModel.js';

const PlanCard = ({ plan }: Readonly<{ plan: PlanViewModel }>) => (
  <article className="plan-card" data-testid="plan-card">
    <div className="plan-card-heading">
      <div>
        <p className="plan-version">Version {plan.version}</p>
        <h3>{plan.id}</h3>
      </div>
      <span className={`status-badge status-${plan.status.toLowerCase()}`}>
        <span aria-hidden="true">●</span> {plan.statusLabel}
      </span>
    </div>
    <dl className="plan-details">
      <div className="detail-primary">
        <dt>Tomorrow total</dt>
        <dd>{plan.tomorrowTotal} units</dd>
      </div>
      <div><dt>Original tomorrow</dt><dd>{plan.originalTomorrow}</dd></div>
      <div><dt>Substitute tomorrow</dt><dd>{plan.substituteTomorrow}</dd></div>
      <div><dt>Original later</dt><dd>{plan.originalLater}</dd></div>
      <div><dt>Later delivery</dt><dd>{plan.laterDeliveryDate}</dd></div>
      <div><dt>Client additional cost</dt><dd>{plan.clientAdditionalCost}</dd></div>
    </dl>
  </article>
);

export const PlanProgress = ({ plans }: Readonly<{ plans: readonly PlanViewModel[] }>) => (
  <section className="section" aria-labelledby="plan-progress-title">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Resolution path</p>
        <h2 id="plan-progress-title">Plan progress</h2>
      </div>
      <p>Each version preserves the decision history that led to the final outcome.</p>
    </div>
    <div className="plan-progress">
      {plans.map((plan, index) => (
        <div className="plan-step" key={plan.id}>
          <PlanCard plan={plan} />
          {index < plans.length - 1 ? (
            <span className="plan-arrow" aria-hidden="true">→</span>
          ) : null}
        </div>
      ))}
    </div>
  </section>
);
