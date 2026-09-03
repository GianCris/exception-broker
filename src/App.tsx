import { prepareProof, reviewProof } from './demo/proofDemo.js';
import { ProofExperience } from './ui/ProofExperience.js';

export const App = () => (
  <ProofExperience prepare={prepareProof} review={reviewProof} />
);
