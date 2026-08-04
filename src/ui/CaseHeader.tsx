type CaseHeaderProps = Readonly<{
  caseLabel: string;
  title: string;
  requestedQuantity: number;
  participantCount: number;
  targetDeliveryDate: string;
  status: string;
  statusLabel: string;
}>;

const BrokerMark = () => (
  <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="3" cy="5" r="1.5" /><circle cx="3" cy="12" r="1.5" /><circle cx="3" cy="19" r="1.5" />
    <path d="M4.5 5 10 11.1M4.5 12H10M4.5 19 10 12.9" />
    <circle cx="11.5" cy="12" r="2" /><path d="M13.5 12H17M17 12l1.6 1.8L22 9.5" />
  </svg>
);

export const CaseHeader = ({
  caseLabel, title, requestedQuantity, participantCount, targetDeliveryDate, status, statusLabel,
}: CaseHeaderProps) => (
  <header className="case-header">
    <div className="brand-row"><BrokerMark /><span className="brand-name">Exception Broker</span></div>
    <div className="header-content">
      <div>
        <p className="case-label">{caseLabel}</p>
        <h1>{title}</h1>
        <p className="commercial-copy">Three parties.<br />Three constraints.<br />One approved recovery plan.</p>
      </div>
      <span className={`status-badge status-${status.toLowerCase()}`}><span aria-hidden="true">✓</span> {statusLabel}</span>
    </div>
    <dl className="case-metrics">
      <div><dt>Requested units</dt><dd>{requestedQuantity.toLocaleString()}</dd></div>
      <div><dt>Participants</dt><dd>{participantCount}</dd></div>
      <div><dt>Target deadline</dt><dd>{targetDeliveryDate}</dd></div>
      <div><dt>Final status</dt><dd>{statusLabel}</dd></div>
    </dl>
  </header>
);
