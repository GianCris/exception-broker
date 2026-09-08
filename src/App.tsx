import { useMemo, useState } from 'react';

import { createAcquisitionBrowserApi } from './acquisition/browserClient.js';
import { prepareProof, reviewProof, type ProofScenario } from './demo/proofDemo.js';
import { HomeExperience } from './ui/HomeExperience.js';
import { AcquisitionExperience } from './ui/AcquisitionExperience.js';
import { ProofExperience } from './ui/ProofExperience.js';
import { LiveControlExperience, controlSessionStorageKey } from './ui/LiveControlExperience.js';
import type { LiveControlPublicRecord } from './control/contracts.js';

export const App = () => {
  const [surface, setSurface] = useState<'home' | 'acquisition' | 'control' | 'live-control'>(() => localStorage.getItem(controlSessionStorageKey) ? 'live-control' : 'home');
  const [initialScenario, setInitialScenario] = useState<ProofScenario>('H02');
  const [liveControl, setLiveControl] = useState<LiveControlPublicRecord>();
  const acquisitionApi = useMemo(() => createAcquisitionBrowserApi(), []);
  const goHome = () => setSurface('home');
  const goControl = (scenario: ProofScenario = 'H02') => { setInitialScenario(scenario); setSurface('control'); };
  if (surface === 'home') return <HomeExperience onNavigateAcquisition={() => setSurface('acquisition')} onNavigateControl={goControl} />;
  if (surface === 'live-control') return <LiveControlExperience api={acquisitionApi} {...(liveControl === undefined ? {} : { initial: liveControl })} onNavigateHome={goHome} onNavigateAcquisition={() => setSurface('acquisition')} onNavigateDeterministic={() => goControl()} />;
  return surface === 'control'
    ? <ProofExperience prepare={prepareProof} review={reviewProof} initialScenario={initialScenario} onNavigateHome={goHome} onNavigateAcquisition={() => setSurface('acquisition')} />
    : <AcquisitionExperience api={acquisitionApi} onNavigateHome={goHome} onNavigateControl={() => goControl()} onOpenControl={(record) => { setLiveControl(record); setSurface('live-control'); }} />;
};
