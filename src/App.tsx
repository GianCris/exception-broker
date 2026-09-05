import { useMemo, useState } from 'react';

import { createAcquisitionBrowserApi } from './acquisition/browserClient.js';
import { prepareProof, reviewProof } from './demo/proofDemo.js';
import { AcquisitionExperience } from './ui/AcquisitionExperience.js';
import { ProofExperience } from './ui/ProofExperience.js';

export const App = () => {
  const [surface, setSurface] = useState<'acquisition' | 'control'>('control');
  const acquisitionApi = useMemo(() => createAcquisitionBrowserApi(), []);
  return surface === 'control'
    ? <ProofExperience prepare={prepareProof} review={reviewProof} onNavigateAcquisition={() => setSurface('acquisition')} />
    : <AcquisitionExperience api={acquisitionApi} onNavigateControl={() => setSurface('control')} />;
};
