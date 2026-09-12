import { DormantArrow, DormantControlCanvas } from './DormantControlCanvas.js';
import { GuidedWalkthroughAction, ProductTopbar } from './ProductShell.js';

/**
 * Control in its honest empty state.
 *
 * Control is the workspace for an ACQUIRED decision, so when no usable acquired decision
 * or restorable Live Control session exists there is nothing to work on — and the product
 * says exactly that rather than falling back to a deterministic proof case, inventing a
 * decision, or showing a dashboard of nothing.
 *
 * The prerequisite it states is the real one: a usable acquired decision. It is NOT an API
 * key — acquisition can run on the Hosted sandbox or on the user's own provider account —
 * so this surface never asks anyone to configure credentials.
 *
 * It renders inside the dormant Control canvas so the user reads the module they asked
 * for: the Control architecture is visibly there and visibly unavailable. Nothing on it is
 * operational — no disposition, no APPROVED, no quantities, no case — and there is no
 * Sentinel rail, because there is no workspace activity for it to preside over. The three
 * exits are deliberately unequal: acquire, then understand, then verify.
 */
export const ControlGateExperience = ({ onNavigateHome, onNavigateAcquisition, onNavigateWalkthrough, onNavigateProof }: Readonly<{
  onNavigateHome: () => void;
  onNavigateAcquisition: () => void;
  onNavigateWalkthrough: () => void;
  onNavigateProof: () => void;
}>) => (
  <div className="app-shell proof-shell control-surface control-dormant-shell"><div className="control-chassis">
    <ProductTopbar surface="control" onNavigateHome={onNavigateHome} onNavigateAcquisition={onNavigateAcquisition} onNavigateControl={() => undefined}
      context={<GuidedWalkthroughAction onOpen={onNavigateWalkthrough} />} />
    <DormantControlCanvas
      mode="empty"
      titleId="control-gate-title"
      eyebrow="Control"
      title="Control starts with an acquired decision."
      lede="Exception Broker first acquires a usable decision. Control then binds that decision to exact review and evaluates its application against operational reality."
      state="No acquired decision is held in this workspace."
      actions={<>
        <div className="dormant-actions">
          <button type="button" className="gate-primary" onClick={onNavigateAcquisition}>Acquire a decision <DormantArrow /></button>
          <button type="button" className="gate-secondary" onClick={onNavigateWalkthrough}>Interactive demo <DormantArrow /></button>
        </div>
        <button type="button" className="gate-quiet" onClick={onNavigateProof}>Explore Control proof <DormantArrow /></button>
      </>}
    />
  </div></div>
);
