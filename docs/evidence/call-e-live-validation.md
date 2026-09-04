# CALL-E live validation evidence

## Evidence class

This note records operator-observed historical output from two real CALL-E interactions through the productized Operator Sandbox. It is not a bundled original recording or independent provider-side verification. Provider interaction references identify observed calls; they are not authentication or execution authority.

## Run 1 — `OPERATOR-LIVE-V1`

- Acquisition: `REQUEST-OPERATOR-LIVE-b869b060-3ff2-45a4-bac9-a38ec06651ef`
- Provider interaction: `call_gI7f3s9VpXyAcwZIRPiFyg`
- Provider result: `completed`; `taskCompleted=true`; confidence `0.86` / `high`
- Normalized `receivedAt`: `2026-09-04T19:40:27.025Z`
- Normalized outcome: `NEEDS_CLARIFICATION`
- Session disposition: `STOPPED` / `CLARIFICATION_REQUIRED`
- New local effects: zero decision, operation, and event records

Demonstrated chain:

```text
real CALL-E acquisition -> normalized NEEDS_CLARIFICATION -> clarification safe-stop -> zero effects
```

## Run 2 — `OPERATOR-LIVE-V2`

- Acquisition: `REQUEST-OPERATOR-LIVE-5c68abf6-5155-44f5-bd8f-a6522961ede9`
- Provider interaction: `call_RrbWjZWhiseGAiJciEi9Yg`
- Provider result: `completed`; `taskCompleted=true`; confidence `0.95` / `high`
- Normalized `receivedAt`: `2026-09-04T20:23:36.628Z`
- Normalized decision: `APPROVED`
- Review: the exact retained proposal was displayed; the operator explicitly selected `APPLY`
- Reviewer label: `LOCAL-SANDBOX-OPERATOR-NOT-AUTHENTICATED`
- Broker outcome: `ALLOW` / `LINEAGE_RESOLVED`
- New local effects: one APPROVED decision record, one operation record, and one event record, linked to the same acquisition request identity

Demonstrated chain:

```text
real CALL-E acquisition -> normalized APPROVED -> exact retained review -> explicit human APPLY
-> current local Broker/Application evaluation -> ALLOW / LINEAGE_RESOLVED -> traceable local effects
```

The terminal explicitly reported: `Local sandbox only. No external execution.`

## Limits and non-claims

- Operational state was synthetic and pre-trusted; it was not live ERP/WMS state.
- Supplier and Production setup records were synthetic.
- Reviewer identity was local and unauthenticated.
- Lifecycle timestamps came from the local process clock and were not externally attested or claimed as CALL-E server timestamps.
- Decision, operation, event, state, and acquisition-receipt data were in memory, not durable or tamper-evident storage.
- No ERP/WMS write, shipment, fulfillment, or other external operational execution occurred.
- No source or human identity authentication is demonstrated.
- No original transcript, provider recording, secret, or raw unrestricted provider payload is bundled.
- Provider content remained external evidence. It became neither verified operational truth nor execution authority merely because acquisition succeeded.
- These runs are separate from deterministic H01/H02/H03. In particular, live Run 2 observed `APPROVED -> review -> ALLOW`, while deterministic H02 proves a represented `APPROVED -> review -> BLOCK` under different modeled operational facts.
