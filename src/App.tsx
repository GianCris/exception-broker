import { createLocalSimulationInput, runDemo } from './demo/demoRunner.js';
import { DemoExperience } from './ui/DemoExperience.js';

export const App = () => (
  <DemoExperience runner={runDemo} createInput={createLocalSimulationInput} />
);
