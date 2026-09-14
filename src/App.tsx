import { useEffect, useMemo, useState } from 'react';

import { createAcquisitionBrowserApi } from './acquisition/browserClient.js';
import { prepareProof, reviewProof, type ProofScenario } from './demo/proofDemo.js';
import { HomeExperience } from './ui/HomeExperience.js';
import { AcquisitionExperience } from './ui/AcquisitionExperience.js';
import { ControlGateExperience } from './ui/ControlGateExperience.js';
import { GuidedWalkthroughExperience, walkthroughHash } from './ui/GuidedWalkthroughExperience.js';
import { ProofExperience } from './ui/ProofExperience.js';
import { LiveControlExperience, controlSessionStorageKey } from './ui/LiveControlExperience.js';
import type { LiveControlPublicRecord } from './control/contracts.js';

/**
 * The commercial product model, as surfaces.
 *
 * Acquire -> Control, Learn -> Walkthrough, Verify -> Proof. Each term means exactly one
 * thing, so CONTROL WORKSPACE and CONTROL PROOF are separate surfaces reached by separate
 * intents: 'control' and 'live-control' are the workspace for an acquired decision,
 * 'control-proof' is the independent deterministic H01/H02/H03 verification surface.
 * Primary Control navigation resolves to the workspace and never to the proof.
 */
type Surface = 'home' | 'acquisition' | 'control' | 'live-control' | 'control-proof' | 'walkthrough';

const readHash = () => { try { return window.location.hash; } catch { return ''; } };
const storedControlSession = () => { try { return localStorage.getItem(controlSessionStorageKey); } catch { return null; } };

/**
 * A direct walkthrough link has to work for a judge or a demo on any browser, including one
 * that previously used Live Control — so #walkthrough takes precedence when choosing the
 * initial surface. It only takes precedence: the stored live session is read, never written
 * or cleared, and it is still there when the walkthrough is left.
 */
const initialSurface = (): Surface => readHash() === walkthroughHash ? 'walkthrough'
  : storedControlSession() ? 'live-control' : 'home';

export const App = () => {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [initialScenario, setInitialScenario] = useState<ProofScenario>('H02');
  const [liveControl, setLiveControl] = useState<LiveControlPublicRecord>();
  const acquisitionApi = useMemo(() => createAcquisitionBrowserApi(), []);
  const goHome = () => setSurface('home');
  const goAcquisition = () => setSurface('acquisition');
  const goWalkthrough = () => setSurface('walkthrough');
  const goControlProof = (scenario: ProofScenario = 'H02') => { setInitialScenario(scenario); setSurface('control-proof'); };

  /**
   * The Control Workspace resolver — the single answer to "the user asked for Control".
   *
   * A currently held Live Control record is used first; otherwise the persisted session
   * pointer hands the existing Live Control restoration/recovery path its own work, which
   * is what produces the honest "Live Control recovery locked" state when live access is
   * gone. Only when neither exists is there genuinely nothing to work on, and Control says
   * so through its Gate. No record is ever fabricated, and deterministic proof is never an
   * answer to this question.
   */
  const goControlWorkspace = () => setSurface(liveControl !== undefined || storedControlSession() !== null ? 'live-control' : 'control');

  /**
   * The walkthrough owns the hash while it is open and releases it on the way out, so a
   * refresh after leaving never reopens it. replaceState keeps Back/Forward free of
   * duplicate walkthrough entries, and the step is deliberately not encoded anywhere.
   */
  useEffect(() => {
    try {
      const { pathname, search, hash } = window.location;
      if (surface === 'walkthrough') { if (hash !== walkthroughHash) history.replaceState(null, '', `${pathname}${search}${walkthroughHash}`); }
      else if (hash === walkthroughHash) history.replaceState(null, '', `${pathname}${search}`);
    } catch { /* Surface state stays authoritative when history is unavailable. */ }
  }, [surface]);

  useEffect(() => {
    const sync = () => { if (readHash() === walkthroughHash) setSurface('walkthrough'); };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  if (surface === 'home') return <HomeExperience onNavigateAcquisition={goAcquisition} onNavigateControl={goControlWorkspace} onNavigateControlProof={goControlProof} onNavigateWalkthrough={goWalkthrough} />;
  if (surface === 'walkthrough') return <GuidedWalkthroughExperience onNavigateHome={goHome} onNavigateAcquisition={goAcquisition} onNavigateControl={goControlWorkspace} onNavigateControlProof={() => goControlProof()} />;
  if (surface === 'live-control') return <LiveControlExperience api={acquisitionApi} {...(liveControl === undefined ? {} : { initial: liveControl })} onNavigateHome={goHome} onNavigateAcquisition={goAcquisition} onNavigateControl={goControlWorkspace} />;
  if (surface === 'control') return <ControlGateExperience onNavigateHome={goHome} onNavigateAcquisition={goAcquisition} onNavigateWalkthrough={goWalkthrough} onNavigateProof={() => goControlProof()} />;
  return surface === 'control-proof'
    ? <ProofExperience prepare={prepareProof} review={reviewProof} initialScenario={initialScenario} onNavigateHome={goHome} onNavigateAcquisition={goAcquisition} onNavigateControl={goControlWorkspace} />
    : <AcquisitionExperience api={acquisitionApi} onNavigateHome={goHome} onNavigateControl={goControlWorkspace} onNavigateWalkthrough={goWalkthrough} onOpenControl={(record) => { setLiveControl(record); setSurface('live-control'); }} />;
};
