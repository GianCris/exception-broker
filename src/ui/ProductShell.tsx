import { useEffect, useRef, useState, type ReactNode } from 'react';

// The one Exception Broker product shell. Home, Acquisition, deterministic Control and
// Live Control all render THIS topbar, so brand, navigation and theme cannot drift by a
// pixel between routes. Purely presentational: no domain state, no decisions, no
// operational claims. The contextual right-hand slot is the only per-route difference,
// and it is laid out so that changing it never moves the brand or the navigation.

const productLogo = '/images/home/exception-broker-logo-transparent.png';

/** The real Exception Broker mark and wordmark — the same asset on every surface. */
export const ProductBrand = () => (
  <span className="product-brand">
    <img src={productLogo} alt="Exception Broker logo" width="55" height="39" />
    <span><strong>Exception Broker</strong><small>Higher ground for brighter decisions.</small></span>
  </span>
);

const ShellArrow = () => (
  <svg className="shell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
);

type ThemeMode = 'system' | 'light' | 'dark';
const themeStorageKey = 'exception-broker-theme';
const isThemeMode = (value: string | null): value is ThemeMode => value === 'system' || value === 'light' || value === 'dark';

export const ThemeControl = () => {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try { const stored = window.localStorage.getItem(themeStorageKey); return isThemeMode(stored) ? stored : 'system'; } catch { return 'system'; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  const effectiveTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.dataset.themeMode = mode;
    return () => { delete document.documentElement.dataset.theme; delete document.documentElement.dataset.themeMode; };
  }, [effectiveTheme, mode]);
  const changeMode = (next: ThemeMode) => {
    setMode(next);
    try { window.localStorage.setItem(themeStorageKey, next); } catch { /* Rendering remains deterministic when storage is unavailable. */ }
  };
  return <label className="theme-control"><span>Theme</span><select aria-label="Theme" value={mode} onChange={(event) => changeMode(event.target.value as ThemeMode)}>
    <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
  </select></label>;
};

/**
 * The learning entry point, in the topbar's one contextual slot.
 *
 * The internal name stays GuidedWalkthroughAction because the route, the flow module and
 * the scenario are still the guided walkthrough; what the user is offered is called the
 * INTERACTIVE DEMO, and that is the only commercial name for the learning mode anywhere in
 * the product. One component renders it, so Home, Acquisition and the empty Control Gate
 * cannot drift in label, geometry or material.
 */
export const GuidedWalkthroughAction = ({ onOpen }: Readonly<{ onOpen: () => void }>) => (
  <button type="button" className="shell-slot product-cta" onClick={onOpen}>Interactive demo <ShellArrow /></button>
);

/**
 * A context indicator, never an action: it states which truth the current surface carries.
 * It wears the same chassis as the action above — same height, radius, padding rhythm and
 * trailing-edge position — so the topbar reads as one system whose right-hand state
 * changes, rather than as four separately designed boxes.
 */
export const SurfaceContext = ({ label, detail, ariaLabel }: Readonly<{ label: string; detail: string; ariaLabel?: string }>) => (
  <span className="shell-slot proof-mode" {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}><b>{label}</b><span>{detail}</span></span>
);

/**
 * The primary modules are Home, Acquisition and Control, and only those three can be the
 * active module. 'walkthrough' (guided learning) and 'control-proof' (deterministic
 * verification) are surfaces, not primary modules: both deliberately mark none of the
 * three as active. Marking Control active on the proof would claim that Control means
 * H01/H02/H03, which is exactly what it does not mean — Control means the workspace for an
 * acquired decision. The nav geometry is identical in every case.
 */
export type ProductSurface = 'home' | 'acquisition' | 'control' | 'control-proof' | 'walkthrough';

export const ProductTopbar = ({ surface, onNavigateHome, onNavigateAcquisition, onNavigateControl, context }: Readonly<{
  surface: ProductSurface;
  onNavigateHome?: (() => void) | undefined;
  onNavigateAcquisition?: (() => void) | undefined;
  onNavigateControl?: (() => void) | undefined;
  context?: ReactNode;
}>) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);
  const go = (navigate?: () => void) => () => { setMenuOpen(false); navigate?.(); };
  const current = (value: ProductSurface) => surface === value ? { 'aria-current': 'page' as const } : {};
  return <header className="product-topbar">
    <button type="button" className="product-home-link" onClick={go(onNavigateHome)} aria-label="Exception Broker home"><ProductBrand /></button>
    <nav id="product-navigation" className={`product-nav${menuOpen ? ' is-open' : ''}`} aria-label="Primary navigation">
      <button type="button" onClick={go(onNavigateHome)} {...current('home')}>Home</button>
      <button type="button" onClick={go(onNavigateAcquisition)} {...current('acquisition')}>Acquisition</button>
      <button type="button" onClick={go(onNavigateControl)} {...current('control')}>Control</button>
    </nav>
    <div className="product-topbar-actions">
      {context}
      <ThemeControl />
      <button ref={menuButton} type="button" className="product-menu" onClick={() => setMenuOpen(!menuOpen)}
        aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="product-navigation">
        {menuOpen ? '×' : '☰'}
      </button>
    </div>
  </header>;
};

/**
 * Sentinel Ridge as environment, not as a card: it closes the branded rail exactly the way
 * Acquisition's flow rail closes. Decorative only — the motif carries no operational meaning.
 */
export const SentinelScene = () => (
  <div className="rail-scene" aria-hidden="true">
    <div className="rail-motif"><q>Higher ground is a choice.</q><span>— The Sentinel</span></div>
  </div>
);
