# Exception Broker

Exception Broker coordinates operational exceptions among Supplier, Production, and Client when their constraints prevent a plan from being fulfilled. It preserves the required decisions, authorizations, and approvals so that the outcome is supported by recorded evidence and remains verifiable.

## Project value

A supply exception often requires coordinated decisions from multiple parties. Exception Broker keeps those decisions linked to the correct case, plan, and actor, providing an auditable trail from the initial rejection through final resolution.

## Demo

The demo runs a complete, deterministic scenario in `LOCAL_SIMULATION` mode. It uses local simulated providers: it makes no real phone calls, contacts no external APIs, and does not use paid external services during the demo.

The expected flow is:

```text
PLAN-001 rejected
→ PLAN-002 no solution
→ authorization reviewed 50 → 100
→ PLAN-003 created
→ Supplier, Production and Client approved
→ case resolved
```

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

1. Confirm that `LOCAL SIMULATION` and `NO REAL CALLS` are displayed.
2. Select `Run exception resolution`.
3. Review the case narrative, the nine verified steps, and the final outcome.
4. Open `Decision Trace` to inspect the auditable identifiers.

## What the jury should observe

- PLAN-001 is rejected with evidence of the violated rule.
- PLAN-002 reaches no solution with 250 units available against 300 required.
- The reviewed authorization changes the limit from 50 to 100.
- PLAN-003 is created after the authorization is applied.
- Supplier, Production, and Client record three distinct approvals.
- PLAN-003 is approved and the case is declared resolved only after the flow is complete.
- Decision Trace preserves auditable request, operation, and approval references.
- The entire execution remains in `LOCAL_SIMULATION`, with no real calls or external service usage during the demo.

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
