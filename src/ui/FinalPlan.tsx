type FinalPlanView = Readonly<{
  id: string;
  originalTomorrow: number;
  substituteTomorrow: number;
  originalLater: number;
  laterDeliveryDate: string;
  clientAdditionalCost: string;
  costAllocation: readonly Readonly<{ role: string; label: string; cost: string }>[];
  validationPassed: boolean;
}>;

export const FinalPlan = ({ plan }: Readonly<{ plan: FinalPlanView | null }>) => {
  if (plan === null) return null;

  return (
    <section className="section final-plan-section" aria-labelledby="final-plan-title" data-testid="final-plan">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Approved resolution · {plan.id}</p>
          <h2 id="final-plan-title">Final plan</h2>
        </div>
        {plan.validationPassed ? (
          <span className="validation-badge"><span aria-hidden="true">✓</span> R-01 to R-10 passed</span>
        ) : null}
      </div>
      <div className="final-plan-grid">
        <article className="delivery-card delivery-tomorrow">
          <p className="card-label">Tomorrow</p>
          <div className="delivery-total">{plan.originalTomorrow + plan.substituteTomorrow}<small> units</small></div>
          <dl>
            <div><dt>Original units</dt><dd>{plan.originalTomorrow}</dd></div>
            <div><dt>Substitute units</dt><dd>{plan.substituteTomorrow}</dd></div>
          </dl>
        </article>
        <article className="delivery-card">
          <p className="card-label">Later delivery</p>
          <div className="delivery-total">{plan.originalLater}<small> units</small></div>
          <dl><div><dt>Delivery date</dt><dd>{plan.laterDeliveryDate}</dd></div></dl>
        </article>
        <article className="cost-card">
          <div className="client-cost">
            <span>Client additional cost</span>
            <strong>{plan.clientAdditionalCost}</strong>
          </div>
          <p className="card-label">Cost allocation</p>
          <dl>
            {plan.costAllocation.map((allocation) => (
              <div key={allocation.role}><dt>{allocation.label}</dt><dd>{allocation.cost}</dd></div>
            ))}
          </dl>
        </article>
      </div>
    </section>
  );
};
