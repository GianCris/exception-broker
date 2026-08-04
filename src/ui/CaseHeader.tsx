type CaseHeaderProps = Readonly<{
  caseId: string;
  requestedQuantity: number;
  targetDeliveryDate: string;
  status: string;
  statusLabel: string;
}>;

export const CaseHeader = ({
  caseId,
  requestedQuantity,
  targetDeliveryDate,
  status,
  statusLabel,
}: CaseHeaderProps) => (
  <header className="case-header">
    <div className="brand-row">
      <span className="brand-mark" aria-hidden="true">EB</span>
      <span className="brand-name">Exception Broker</span>
    </div>
    <div className="header-content">
      <div>
        <p className="eyebrow">Material shortage · {caseId}</p>
        <h1>Resolution overview</h1>
        <p className="commercial-copy">
          Three-party exception resolution through constraint-aware calls.
        </p>
      </div>
      <span className={`status-badge status-${status.toLowerCase()}`}>
        <span aria-hidden="true">●</span> {statusLabel}
      </span>
    </div>
    <dl className="case-metrics">
      <div>
        <dt>Total order</dt>
        <dd>{requestedQuantity.toLocaleString()} units</dd>
      </div>
      <div>
        <dt>Target deadline</dt>
        <dd>{targetDeliveryDate}</dd>
      </div>
      <div>
        <dt>Final status</dt>
        <dd>{statusLabel}</dd>
      </div>
    </dl>
  </header>
);
