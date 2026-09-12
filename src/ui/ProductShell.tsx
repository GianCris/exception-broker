// The one Exception Broker product shell. Acquisition established it; Control reuses the
// same identity, geometry and environment so both read as one product generation.
// Purely presentational: no domain state, no decisions, no operational claims.

const productLogo = '/images/home/exception-broker-logo-transparent.png';

/** The real Exception Broker mark and wordmark, identical to Acquisition and Home. */
export const ProductBrand = () => (
  <span className="product-brand">
    <img src={productLogo} alt="Exception Broker logo" width="55" height="39" />
    <span><strong>Exception Broker</strong><small>Higher ground for brighter decisions.</small></span>
  </span>
);

/**
 * Sentinel Ridge as environment, not as a card: it closes the branded rail exactly the way
 * Acquisition's flow rail closes. Decorative only — the motif carries no operational meaning.
 */
export const SentinelScene = () => (
  <div className="rail-scene" aria-hidden="true">
    <div className="rail-motif"><q>Higher ground is a choice.</q><span>— The Sentinel</span></div>
  </div>
);
