import { useEffect, useRef, useState, type RefObject } from 'react';
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

/**
 * The arrival score, in seconds.
 *
 * Home plays this ONCE per mount and then goes quiet for good: the ridge settles out of
 * depth, a signal travels the existing route, each milestone answers as the signal reaches
 * it, and the summit resolves. One score drives all four, so the path and the milestones
 * cannot drift apart — change a number here and the whole sequence still reads.
 *
 * `travel` is the signal's full journey including its run-in before the route and its
 * run-out past the summit, which is why the milestones land inside it rather than at its
 * edges: the head of the signal crosses the route start at ~1.7s and the summit at ~4.2s.
 */
const arrival = { enter: .9, travel: 4.1, one: 1.7, two: 2.95, three: 4.2, summit: 4.3, mist: 5.4 } as const;

/**
 * The resting loop, in seconds. Once the arrival has fully resolved — signal gone, summit
 * bloom returned to nothing — the route keeps ONE quieter current travelling it for as long
 * as Home is mounted: the light emerges at Decision acquired, crosses Execution gate, fades
 * as it reaches Higher ground, and the path rests before the next one sets out.
 *
 * Nothing else replays. This is the path's own life, not the arrival again, which is why it
 * peaks well below the arrival's brightness and why the gap is long enough to read as a
 * pause rather than as a pulse.
 */
const loop = { from: 0, to: 1.12, travel: 5, cycle: 6.6, peak: .66 } as const;

/**
 * The signal's leading edge, as a share of the route: it starts a full body's length before
 * the lower path and ends a body past the summit, so the viewer never sees it appear or
 * vanish — it arrives and it leaves.
 *
 * The body is four dashes of different lengths travelling together, from a wide faint wake
 * to a small bright head. They only read as ONE current of light if their FRONTS coincide,
 * which is why each offset is its own dash length minus the shared front.
 */
const front = { from: -.42, to: 1.42 } as const;
const comet = [
  { key: 'glow', share: .42 },
  { key: 'tail', share: .34 },
  { key: 'body', share: .2 },
  { key: 'head', share: .08 },
] as const;

/**
 * The route's length in SCREEN pixels.
 *
 * The journey SVG is deliberately stretched (preserveAspectRatio="none") and its paths
 * inherit vector-effect: non-scaling-stroke, which moves the dash pattern as well as the
 * stroke width into screen space — pathLength normalisation never reaches it, so a dash
 * authored in viewBox units silently repeats several times along the curve. Measuring once
 * on mount is what lets the signal be ONE body holding a fixed share of the route at any
 * viewport. Only one of the two route variants is displayed, so the measurement takes the
 * first that actually has a screen transform; an environment with no SVG geometry reports
 * nothing and the scene simply rests without its arrival signal.
 */
function useRouteLength(journey: RefObject<SVGSVGElement | null>) {
  const [length, setLength] = useState(0);
  useEffect(() => {
    try {
      for (const path of journey.current?.querySelectorAll('.eb-journey-base') ?? []) {
        const route = path as SVGPathElement;
        const matrix = route.getScreenCTM?.();
        const total = route.getTotalLength?.();
        if (matrix === null || matrix === undefined || !total) continue;
        let measured = 0;
        let previous = route.getPointAtLength(0).matrixTransform(matrix);
        for (let step = 1; step <= 48; step += 1) {
          const point = route.getPointAtLength((total * step) / 48).matrixTransform(matrix);
          measured += Math.hypot(point.x - previous.x, point.y - previous.y);
          previous = point;
        }
        setLength(measured);
        return;
      }
    } catch { /* No SVG geometry engine: the resting scene is still complete without the signal. */ }
  }, [journey]);
  return length;
}

/** Copy, order and position are exactly the existing three milestones; only the arrival
 *  response is new, and it is an opacity lift plus a small swell on the disc — never a move. */
const milestones = [
  { key: 'one', at: arrival.one, swell: 1.15, title: 'Decision acquired', kicker: 'From signal', lead: 'Capture and structure', tail: 'AI-acquired decisions.' },
  { key: 'two', at: arrival.two, swell: 1.15, title: 'Execution gate', kicker: 'Through control', lead: 'Apply operational', tail: 'constraints and review.' },
  { key: 'three', at: arrival.three, swell: 1.26, title: 'Higher ground', kicker: 'Operational reality', lead: 'Decisions grounded', tail: 'in modeled facts.' },
] as const;

function SentinelScene() {
  const reducedMotion = useReducedMotion();
  const journey = useRef<SVGSVGElement>(null);
  const routeLength = useRouteLength(journey);
  /* The hand-off from the one-time arrival to the endless resting loop. The summit bloom is
     the last thing the arrival does, so its completion IS the moment the arrival is over —
     no clock of Home's own, and nothing to keep in sync with the score. Only the signal
     changes hands; the ridge, the milestones, the bloom and the mist sweep have finished
     their single run and are never re-triggered. */
  const [resting, setResting] = useState(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  useEffect(() => { if (reducedMotion) { x.set(0); y.set(0); } }, [reducedMotion, x, y]);
  return <div className="eb-sentinel-scene" aria-label="Sentinel Ridge decision path" onPointerMove={(event) => {
    if (reducedMotion || event.pointerType === 'touch') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    x.set(Math.max(-3, Math.min(3, ((event.clientX - bounds.left) / bounds.width - .5) * 6)));
    y.set(Math.max(-2, Math.min(2, ((event.clientY - bounds.top) / bounds.height - .5) * 4)));
  }} onPointerLeave={() => { x.set(0); y.set(0); }}>
    {/* ARRIVAL. The ridge comes out of depth rather than out of nothing: it starts a little
        larger and a little dimmer over its own dark ground and settles to its resting frame.
        The pointer parallax keeps x/y; only the settle lives in `animate`. */}
    <div className="eb-ridge"><motion.img src={ridge} alt="Sentinel Ridge: a cat watches over a mountain path toward the summit" style={{ x, y }}
      initial={reducedMotion ? false : { scale: 1.055, opacity: .48 }} animate={{ scale: 1.01, opacity: 1 }}
      transition={reducedMotion ? { duration: 0 } : { scale: { duration: 1.6, ease: [.16, 1, .3, 1] }, opacity: { duration: 1, ease: 'easeOut' } }} /></div>
    <div className="eb-wash" aria-hidden="true" />
    {/* Two depth planes, never one cloud layer. Every property carries its OWN period, so
        drift, lift, swell and luminance never return to the same state together: the air
        keeps changing without the scene ever arriving at a visible loop point. The near
        mist crosses the valley roughly twice as fast as the deep haze and against it, and
        that difference in rate — not the amount of travel — is what reads as depth. */}
    <motion.div className="eb-fog eb-fog--haze" aria-hidden="true"
      animate={reducedMotion ? { x: 0, y: 0, scale: 1, opacity: .2 } : { x: [34, -40, 34], y: [0, 11, 0], scale: [1, 1.07, 1], opacity: [.15, .28, .15] }}
      transition={reducedMotion ? { duration: 0 } : {
        x: { duration: 46, repeat: Infinity, ease: 'easeInOut' }, y: { duration: 59, repeat: Infinity, ease: 'easeInOut' },
        scale: { duration: 63, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 29, repeat: Infinity, ease: 'easeInOut' },
      }} />
    {/* The carrier gives the near mist ONE visible crossing of the valley while the arrival
        plays, on top of — not instead of — the ambient drift it keeps forever. It comes to
        rest at 0 and never runs again, so the resting scene is the ambient system alone. */}
    <motion.div className="eb-fog-carrier" aria-hidden="true"
      initial={reducedMotion ? false : { x: -118 }} animate={{ x: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: arrival.mist, ease: [.24, .6, .32, 1] }}>
      <motion.div className="eb-fog eb-fog--mist"
        animate={reducedMotion ? { x: 0, y: 0, scale: 1, opacity: .3 } : { x: [-58, 54, -58], y: [0, -21, 0], scale: [1.06, 1, 1.06], opacity: [.23, .42, .23] }}
        transition={reducedMotion ? { duration: 0 } : {
          x: { duration: 27, repeat: Infinity, ease: 'easeInOut' }, y: { duration: 37, repeat: Infinity, ease: 'easeInOut' },
          scale: { duration: 47, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 19, repeat: Infinity, ease: 'easeInOut' },
        }} />
    </motion.div>
    <div className="eb-overlay">
      <svg ref={journey} className="eb-journey-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {(['desktop', 'mobile'] as const).map((size) => {
          const d = size === 'desktop' ? 'M 42 84 C 47 77, 49 69, 54 60 S 59 46, 65 29' : 'M 13 88 C 21 80, 29 75, 37 65 S 50 48, 60 26';
          /* The path already travels; what it lacked was light. The luminance breath runs on
             its own short period, so the route brightens and settles as the air moves over it.
             It sits deliberately below the arrival signal's brightness — ambient life, not
             the protagonist. */
          return <g key={size} className={`eb-journey-${size}`}><path className="eb-journey-base" d={d} /><motion.path className="eb-journey-flow" d={d}
            animate={reducedMotion ? { strokeDashoffset: 0, opacity: .5 } : { strokeDashoffset: -80, opacity: [.26, .6, .26] }}
            transition={reducedMotion ? { duration: 0 } : {
              strokeDashoffset: { duration: 18, repeat: Infinity, ease: 'linear' },
              opacity: { duration: 8.5, repeat: Infinity, ease: 'easeInOut' },
            }} />
            {/* THE SIGNAL. One current of light from the lower route to the summit: first as
                the arrival, then — once that has resolved — forever, quieter. Its four dashes
                share a front, so it reads as a single travelling body with a bright head and
                a soft wake rather than as four strokes.

                The arrival leg leaves past the summit; the resting leg fades at Higher ground
                and waits out the gap at zero, so the restart happens while the body is both
                invisible AND off the route and can never be seen as a jump. */}
            {routeLength > 0 && comet.map(({ key, share }) => {
              const dash = share * routeLength;
              const at = (edge: number) => dash - edge * routeLength;
              const arc = loop.travel / loop.cycle;
              return <motion.path key={key} className={`eb-journey-signal eb-journey-signal--${key}`} d={d}
                style={{ strokeDasharray: `${dash} ${routeLength * 1.7}` }}
                initial={reducedMotion ? false : { strokeDashoffset: at(front.from) }}
                animate={resting
                  ? { strokeDashoffset: [at(loop.from), at(loop.to), at(loop.to)], opacity: [0, loop.peak, loop.peak, 0, 0] }
                  : { strokeDashoffset: at(front.to) }}
                transition={reducedMotion ? { duration: 0 } : resting
                  ? {
                    strokeDashoffset: { duration: loop.cycle, times: [0, arc, 1], ease: 'linear', repeat: Infinity },
                    opacity: { duration: loop.cycle, times: [0, .05, .6, arc, 1], ease: 'easeInOut', repeat: Infinity },
                  }
                  : { delay: arrival.enter, duration: arrival.travel, ease: 'linear' }} />;
            })}
          </g>;
        })}
      </svg>
      {/* Distant light on the summit, not a beacon. Brightness and size breathe on separate
          periods and the halo is diffuse enough that the swell reads as air catching light
          rather than as an orb switching on. */}
      <motion.span className="eb-summit-halo" aria-hidden="true"
        animate={reducedMotion ? { opacity: .36, scale: 1 } : { opacity: [.24, .5, .24], scale: [.95, 1.12, .95] }}
        transition={reducedMotion ? { duration: 0 } : {
          opacity: { duration: 12, repeat: Infinity, ease: 'easeInOut' }, scale: { duration: 16.5, repeat: Infinity, ease: 'easeInOut' },
        }} />
      {/* SUMMIT RESOLUTION. A separate, short-lived light that arrives with the signal,
          swells once over the halo's own position and returns to nothing — the payoff is a
          culmination, not a new resting element, so the quiet Home afterwards is unchanged. */}
      <motion.span className="eb-summit-bloom" aria-hidden="true"
        initial={reducedMotion ? false : { opacity: 0, scale: .62 }} animate={reducedMotion ? { opacity: 0, scale: 1 } : { opacity: [0, .9, 0], scale: [.62, 1.85, 2.4] }}
        transition={reducedMotion ? { duration: 0 } : { delay: arrival.summit, duration: 2.3, times: [0, .42, 1], ease: [.2, .8, .3, 1] }}
        onAnimationComplete={() => { if (!reducedMotion) setResting(true); }} />
      {milestones.map(({ key, at, swell, title, kicker, lead, tail }, index) =>
        <motion.div className={`eb-milestone eb-milestone--${key}`} key={key}
          initial={reducedMotion ? false : { opacity: .4 }} animate={{ opacity: 1 }}
          transition={reducedMotion ? { duration: 0 } : { delay: at, duration: .95, ease: 'easeOut' }}>
          <motion.span className="eb-milestone-number"
            animate={reducedMotion ? { scale: 1 } : { scale: [1, swell, 1] }}
            transition={reducedMotion ? { duration: 0 } : { delay: at, duration: 1.35, times: [0, .32, 1], ease: 'easeInOut' }}>{index + 1}</motion.span>
          <div><strong>{title}</strong><small>{kicker}</small><p>{lead}<br />{tail}</p></div>
        </motion.div>)}
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
