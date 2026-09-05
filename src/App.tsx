import { useMemo, useState } from 'react';

import { createAcquisitionBrowserApi } from './acquisition/browserClient.js';
import { prepareProof, reviewProof } from './demo/proofDemo.js';
import { AcquisitionExperience } from './ui/AcquisitionExperience.js';
import { ProofExperience } from './ui/ProofExperience.js';
import { LiveControlExperience, controlSessionStorageKey } from './ui/LiveControlExperience.js';
import type { LiveControlPublicRecord } from './control/contracts.js';

export const App = () => {
  const [surface, setSurface] = useState<'acquisition' | 'control' | 'live-control'>(() => localStorage.getItem(controlSessionStorageKey) ? 'live-control' : 'control');
  const [liveControl, setLiveControl] = useState<LiveControlPublicRecord>();
  const acquisitionApi = useMemo(() => createAcquisitionBrowserApi(), []);
  if (surface === 'live-control') return <LiveControlExperience api={acquisitionApi} {...(liveControl === undefined ? {} : { initial: liveControl })} onNavigateAcquisition={() => setSurface('acquisition')} onNavigateDeterministic={() => setSurface('control')} />;
  return surface === 'control'
    ? <ProofExperience prepare={prepareProof} review={reviewProof} onNavigateAcquisition={() => setSurface('acquisition')} />
    : <AcquisitionExperience api={acquisitionApi} onNavigateControl={() => setSurface('control')} onOpenControl={(record) => { setLiveControl(record); setSurface('live-control'); }} />;
};
