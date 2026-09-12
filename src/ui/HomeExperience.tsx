import { useEffect, useRef, useState } from 'react';
import { motion, MotionConfig, useMotionValue, useReducedMotion } from 'motion/react';
import { proofScenarios, type ProofScenario } from '../demo/proofDemo.js';
import { GuidedWalkthroughAction, ProductTopbar } from './ProductShell.js';
import '../styles/home.css';

const logo = '/images/home/exception-broker-logo.png';
const ridge = '/images/home/sentinel-ridge.png';
const Arrow = () => <svg className="eb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;

function Brand({ compact = false }: Readonly<{ compact?: boolean }>) {
  return <span className={`eb-brand ${compact ? 'eb-brand--compact' : ''}`}>
    <img src={logo} alt="Exception Broker logo" width="55" height="39" />
    <span className="eb-brand-copy"><strong>Exception Broker</strong>{!compact && <small>Higher ground for brighter decisions.</small>}</span>
  </span>;
}

function SentinelScene() {
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  useEffect(() => { if (reducedMotion) { x.set(0); y.set(0); } }, [reducedMotion, x, y]);
  return <div className="eb-sentinel-scene" aria-label="Sentinel Ridge decision path" onPointerMove={(event) => {
    if (reducedMotion || event.pointerType === 'touch') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    x.set(Math.max(-3, Math.min(3, ((event.clientX - bounds.left) / bounds.width - .5) * 6)));
    y.set(Math.max(-2, Math.min(2, ((event.clientY - bounds.top) / bounds.height - .5) * 4)));
  }} onPointerLeave={() => { x.set(0); y.set(0); }}>
    <div className="eb-ridge"><motion.img src={ridge} alt="Sentinel Ridge: a cat watches over a mountain path toward the summit" style={{ x, y, scale: 1.01 }} /></div>
    <div className="eb-wash" aria-hidden="true" />
    <motion.div className="eb-fog" aria-hidden="true" animate={reducedMotion ? { x: 0, y: 0 } : { x: [-3, 3, -3], y: [0, -2, 0] }} transition={{ duration: 26, repeat: reducedMotion ? 0 : Infinity, ease: 'easeInOut' }} />
    <div className="eb-overlay">
      <svg className="eb-journey-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {(['desktop', 'mobile'] as const).map((size) => {
          const d = size === 'desktop' ? 'M 42 84 C 47 77, 49 69, 54 60 S 59 46, 65 29' : 'M 13 88 C 21 80, 29 75, 37 65 S 50 48, 60 26';
          return <g key={size} className={`eb-journey-${size}`}><path className="eb-journey-base" d={d} /><motion.path className="eb-journey-flow" d={d} animate={{ strokeDashoffset: reducedMotion ? 0 : -80 }} transition={{ duration: 18, repeat: reducedMotion ? 0 : Infinity, ease: 'linear' }} /></g>;
        })}
      </svg>
      <span className="eb-summit-halo" aria-hidden="true" />
      <div className="eb-milestone eb-milestone--one"><span className="eb-milestone-number">1</span><div><strong>Decision acquired</strong><small>From signal</small><p>Capture and structure<br />AI-acquired decisions.</p></div></div>
      <div className="eb-milestone eb-milestone--two"><span className="eb-milestone-number">2</span><div><strong>Execution gate</strong><small>Through control</small><p>Apply operational<br />constraints and review.</p></div></div>
      <div className="eb-milestone eb-milestone--three"><span className="eb-milestone-number">3</span><div><strong>Higher ground</strong><small>Operational reality</small><p>Decisions grounded<br />in modeled facts.</p></div></div>
      <blockquote className="eb-quote">“Not every decision<br />should execute.”<cite>— The Sentinel</cite></blockquote>
    </div>
  </div>;
}

/**
 * Home routes three different intents, and they are three different props: Acquire opens
 * Acquisition, See it in action opens the Guided Walkthrough, and the scenario cards open
 * Control PROOF. Primary nav Control is its own intent and resolves to the Control
 * WORKSPACE — Home never sends anyone to H01/H02/H03 by clicking Control.
 */
export const HomeExperience = ({ onNavigateAcquisition, onNavigateControl, onNavigateControlProof, onNavigateWalkthrough }: Readonly<{
  onNavigateAcquisition: () => void;
  onNavigateControl: () => void;
  onNavigateControlProof: (scenario?: ProofScenario) => void;
  onNavigateWalkthrough: () => void;
}>) => {
  const homeTitle = useRef<HTMLHeadingElement>(null);
  const goHome = () => { homeTitle.current?.focus(); homeTitle.current?.scrollIntoView?.({ block: 'start' }); };
  return <MotionConfig reducedMotion="user"><div className="eb-page">
    <ProductTopbar surface="home" onNavigateHome={goHome} onNavigateAcquisition={onNavigateAcquisition} onNavigateControl={onNavigateControl}
      context={<GuidedWalkthroughAction onOpen={onNavigateWalkthrough} />} />
    <main>
      <section className="eb-hero" aria-labelledby="home-title">
        <SentinelScene />
        <div className="eb-hero-grid">
          <div className="eb-copy">
            <p className="eb-eyebrow">Execution control for AI-acquired decisions</p>
            <h1 ref={homeTitle} tabIndex={-1} id="home-title">Decisions need <em>guardrails</em> to reach reality.</h1>
            <p className="eb-lede">Acquire decisions through AI. Review them exactly.<br /> Let operational reality decide what can execute.</p>
            <div className="eb-cta-row"><button type="button" className="eb-primary" onClick={onNavigateAcquisition}>Acquire a decision <Arrow /></button><button type="button" className="eb-secondary" onClick={onNavigateWalkthrough}><span aria-hidden="true">▷</span> See it in action</button></div>
            <div className="eb-values" aria-label="Product values"><span><b>Higher ground</b><small>A better perspective</small></span><span><b>Clearer paths</b><small>Guided decisions</small></span><span><b>Stronger outcomes</b><small>Possible together</small></span></div>
          </div>
          <aside className="eb-scenarios" aria-labelledby="scenario-heading">
            <div className="eb-scenario-head"><div><h2 id="scenario-heading">See the control boundary in action</h2><p>Deterministic scenarios · configured evidence · local effects only.</p></div><button type="button" className="eb-scenario-link" onClick={() => onNavigateControlProof()}>View all scenarios <Arrow /></button></div>
            <div className="eb-scenario-list">{proofScenarios.map((scenario) => <button type="button" className="eb-scenario" key={scenario.id} onClick={() => onNavigateControlProof(scenario.id)}>
              <span className="eb-scenario-mark" aria-hidden="true">◇</span><span className="eb-scenario-copy"><strong>{scenario.title}</strong><span>{scenario.description}</span></span><span className="eb-outcome">Open proof <i>→</i> <b>{scenario.id}</b></span><Arrow />
            </button>)}</div>
          </aside>
        </div>
      </section>
      <section className="eb-acquisition" aria-labelledby="home-acquisition-title">
        <div className="eb-acquisition-intro"><h2 id="home-acquisition-title">Real decision acquisition</h2><p>From conversation to evidence for exact review.</p></div>
        <div className="eb-steps">
          <div className="eb-step"><span className="eb-step-icon" aria-hidden="true">≋</span><span><b><em>1</em> Transcript</b><small>Inspect conversation<br />evidence from CALL-E.</small></span></div><Arrow />
          <div className="eb-step"><span className="eb-step-icon" aria-hidden="true">▤</span><span><b><em>2</em> Evidence</b><small>Retain the provider’s<br />structured result.</small></span></div><Arrow />
          <div className="eb-step"><span className="eb-step-icon" aria-hidden="true">◇</span><span><b><em>3</em> Decision</b><small>Review usable decisions.<br />Otherwise, stop safely.</small></span></div>
        </div>
        <div className="eb-acquisition-action"><button type="button" className="eb-primary eb-primary--small" onClick={onNavigateAcquisition}>Start acquisition <Arrow /></button><span>Live access required · no external execution</span></div>
      </section>
    </main>
    <footer className="eb-footer"><div className="eb-footer-main">
      <button type="button" className="eb-footer-brand" onClick={goHome} aria-label="Exception Broker home"><Brand compact /></button>
      <div className="eb-footer-column"><b>Product</b><button type="button" onClick={goHome}>Home</button><button type="button" onClick={onNavigateAcquisition}>Acquisition</button><button type="button" onClick={onNavigateControl}>Control</button></div>
      <div className="eb-footer-column"><b>Explore</b>{proofScenarios.map((scenario) => <button type="button" key={scenario.id} onClick={() => onNavigateControlProof(scenario.id)}>Proof {scenario.id}</button>)}</div>
      <div className="eb-footer-column"><b>Proof boundary</b><span>Configured evidence</span><span>Exact review</span><span>Local application</span></div>
      <div className="eb-footer-motto">Exceptional<br />thinking in practice</div>
    </div><div className="eb-footer-bottom"><span>Exception Broker · Decision acquisition ≠ authority to execute</span><span>Controlled local proof · no external execution</span></div></footer>
  </div></MotionConfig>;
};
