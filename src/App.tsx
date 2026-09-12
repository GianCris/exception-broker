import { useEffect, useMemo, useState } from 'react';

import { createAcquisitionBrowserApi } from './acquisition/browserClient.js';
import { prepareProof, reviewProof, type ProofScenario } from './demo/proofDemo.js';
import { HomeExperience } from './ui/HomeExperience.js';
import { AcquisitionExperience } from './ui/AcquisitionExperience.js';
import { GuidedWalkthroughExperience, walkthroughHash } from './ui/GuidedWalkthroughExperience.js';
import { ProofExperience } from './ui/ProofExperience.js';
import { LiveControlExperience, controlSessionStorageKey } from './ui/LiveControlExperience.js';
import type { LiveControlPublicRecord } from './control/contracts.js';

type Surface = 'home' | 'acquisition' | 'control' | 'live-control' | 'walkthrough';

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
  const goControl = (scenario: ProofScenario = 'H02') => { setInitialScenario(scenario); setSurface('control'); };

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

  if (surface === 'home') return <HomeExperience onNavigateAcquisition={goAcquisition} onNavigateControl={goControl} onNavigateWalkthrough={goWalkthrough} />;
  if (surface === 'walkthrough') return <GuidedWalkthroughExperience onNavigateHome={goHome} onNavigateAcquisition={goAcquisition} onNavigateControl={() => goControl()} />;
  if (surface === 'live-control') return <LiveControlExperience api={acquisitionApi} {...(liveControl === undefined ? {} : { initial: liveControl })} onNavigateHome={goHome} onNavigateAcquisition={goAcquisition} onNavigateDeterministic={() => goControl()} />;
  return surface === 'control'
    ? <ProofExperience prepare={prepareProof} review={reviewProof} initialScenario={initialScenario} onNavigateHome={goHome} onNavigateAcquisition={goAcquisition} />
    : <AcquisitionExperience api={acquisitionApi} onNavigateHome={goHome} onNavigateControl={() => goControl()} onNavigateWalkthrough={goWalkthrough} onOpenControl={(record) => { setLiveControl(record); setSurface('live-control'); }} />;
};
