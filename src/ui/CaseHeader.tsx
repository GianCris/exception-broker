type CaseHeaderProps = Readonly<{
  caseLabel: string;
  title: string;
  requestedQuantity: number;
  participantCount: number;
  targetDeliveryDate: string;
  statusLabel: string;
  statusTone: string;
  summary: string;
}>;

export const BrokerMark = () => (
  <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 9V4l4 2.4A9 9 0 0 1 12 6a9 9 0 0 1 3 .4L19 4v5a8 8 0 0 1 1 3.8C20 17.3 16.4 20 12 20s-8-2.7-8-7.2A8 8 0 0 1 5 9Z" />
    <path d="M8.2 12h.1M15.7 12h.1M9.5 15.1c1.7 1.2 3.3 1.2 5 0" />
  </svg>
);

export const CaseHeader = ({
  caseLabel, title, requestedQuantity, participantCount, targetDeliveryDate, statusLabel, statusTone, summary,
}: CaseHeaderProps) => (
  <header className="case-header">
    <div className="brand-row"><BrokerMark /><span className="brand-name">Exception Broker</span></div>
    <div className="header-content">
      <div>
        <p className="case-label">{caseLabel}</p>
        <h1>{title}</h1>
        <p className="commercial-copy">{summary}</p>
      </div>
      <span className={`status-badge status-${statusTone}`}><span aria-hidden="true">●</span> {statusLabel}</span>
    </div>
    <dl className="case-metrics">
      <div><dt>Requested units</dt><dd>{requestedQuantity.toLocaleString()}</dd></div>
      <div><dt>Participants</dt><dd>{participantCount}</dd></div>
      <div><dt>Target deadline</dt><dd>{targetDeliveryDate}</dd></div>
      <div><dt>Final status</dt><dd>{statusLabel}</dd></div>
    </dl>
  </header>
);
