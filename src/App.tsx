import { simulateCase001 } from './domain/case-001.simulation.js';
import { createCase001ViewModel } from './presentation/case001ViewModel.js';
import { ApprovalCards } from './ui/ApprovalCards.js';
import { AuthorizationChangeCard } from './ui/AuthorizationChangeCard.js';
import { CaseHeader } from './ui/CaseHeader.js';
import { DecisionTrace } from './ui/DecisionTrace.js';
import { FinalPlanCard, PlanProgress } from './ui/PlanProgress.js';

type Case001ViewModel = ReturnType<typeof createCase001ViewModel>;

export const Case001Demo = ({ viewModel }: Readonly<{ viewModel: Case001ViewModel }>) => (
    <div className="app-shell">
      <main>
        <CaseHeader {...viewModel.header} />
        <PlanProgress plans={viewModel.priorPlans} />
        <AuthorizationChangeCard changes={viewModel.authorizationChanges} />
        {viewModel.resolutionAvailable && viewModel.finalPlan !== null ? (
          <>
            <FinalPlanCard plan={viewModel.finalPlan} />
            <ApprovalCards approvals={viewModel.finalApprovals} finalPlanId={viewModel.finalPlan.id} />
          </>
        ) : (
          <section className="section resolution-unavailable" aria-labelledby="resolution-unavailable-title">
            <p className="eyebrow">Resolution status</p>
            <h2 id="resolution-unavailable-title">No final resolution available</h2>
          </section>
        )}
        <DecisionTrace events={viewModel.events} />
      </main>
      <footer>Exception Broker · Decision record generated from the official case simulation</footer>
    </div>
);

export const App = () => <Case001Demo viewModel={createCase001ViewModel(simulateCase001())} />;
