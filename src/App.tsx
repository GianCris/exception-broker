import { simulateCase001 } from './domain/case-001.simulation.js';
import { createCase001ViewModel } from './presentation/case001ViewModel.js';
import { ApprovalCards } from './ui/ApprovalCards.js';
import { AuthorizationChangeCard } from './ui/AuthorizationChangeCard.js';
import { CaseHeader } from './ui/CaseHeader.js';
import { DecisionTrace } from './ui/DecisionTrace.js';
import { FinalPlan } from './ui/FinalPlan.js';
import { PlanProgress } from './ui/PlanProgress.js';

export const App = () => {
  const viewModel = createCase001ViewModel(simulateCase001());

  return (
    <div className="app-shell">
      <main>
        <CaseHeader {...viewModel.header} />
        <PlanProgress plans={viewModel.plans} />
        <AuthorizationChangeCard changes={viewModel.authorizationChanges} />
        <FinalPlan plan={viewModel.finalPlan} />
        <ApprovalCards approvals={viewModel.approvals} />
        <DecisionTrace events={viewModel.events} />
      </main>
      <footer>Exception Broker · Decision record generated from the official case simulation</footer>
    </div>
  );
};
