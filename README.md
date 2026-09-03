# Exception Broker

Exception Broker is an execution-control layer that separates AI-acquired decisions from authority to change operational state.

A successful AI interaction is not authority to execute.

The current implementation demonstrates this boundary deterministically across Supplier, Production, and Client recovery scenarios.

## Project value

When operational authority is fragmented across systems and parties, an AI can obtain a valid decision that still must not execute. Exception Broker provides the control boundary between acquired intent and authoritative action.

It checks exact plan version and lineage currentness, authorization, modeled physical feasibility, and exact review binding before applicable local state mutation. It exposes inspectable local decision, operation, and event records—not a persistent or tamper-evident audit store.

## Demo

The default browser demo uses deterministic evidence and explicit synthetic decisions. It makes no real phone calls or external API requests. Configured ERP/WMS source identities are not live integrations; source identity and stable configuration are trusted upstream, not authenticated here.

The independent scenarios are:

- H02: an APPROVED decision is blocked by modeled physical infeasibility.
- H01: an independently supportable recovery reaches exact local plan-lineage resolution after the required explicit reviews.
- H03: conflicting physical evidence prevents trusted operational state from being established.

CASE-001 remains retained legacy simulation proof, not the default UI or a mandatory generalized workflow. No scenario ships goods or writes to ERP/WMS systems.

The separate historical CALL-E panel reports operator-confirmed live interactions: Run #4 returned structured NEEDS_CLARIFICATION, reached mapper/Bridge, and stopped without application; Run #5 completed with null structured output and failed closed. Live CALL-E APPROVED/REJECTED → review → mutation is not demonstrated. These runs did not generate H01/H02/H03; no original recording is bundled.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`.
- npm.

## Installation

Install the exact dependencies recorded in `package-lock.json`:

```sh
npm ci
```

## Local execution

Start the application:

```sh
npm run dev
```

Open the `Local` URL reported by Vite in a browser. On the screen:

1. Confirm the local in-memory demonstration label. H02 is selected initially.
2. Inspect the proposal, configured evidence, and represented decision before selecting `Apply reviewed decision` or `Discard`.
3. Inspect the actual broker outcome and effects of that attempt. Expand the bound review and operation details for identifiers.
4. Select H01 or H03 to start independent state. H01 requires three separate role reviews; H03 never reaches review.

## What the jury should observe

- Exception Broker blocks application of an APPROVED decision at the local broker boundary when the modeled operational evidence cannot support it: H02 proposes 150 substitutes, authorization permits 180, but physical supply supports only 100. The failed attempt creates no decision, operation, or event records.
- H01 has sufficient physical supply and reaches ALLOW only for the exact approved local plan lineage. Supporting formal, physical, and currentness assessments are snapshot queries, not chronological gate telemetry.
- H03 shows WAIT with conflicting, unaccepted claims and no trusted case or application.
- Registration, partial approval, and authorization changes are not final recovery authorization. Authorization alone does not create supply, a successor, or approval.
- Effects and identifiers are local and inspectable. No external execution, authenticated reviewer identity, or general freshness/latest-inventory guarantee is demonstrated.

## Verification

Run the complete test suite:

```sh
npm test
```

Check the types:

```sh
npm run typecheck
```

Generate the production build:

```sh
npm run build
```
