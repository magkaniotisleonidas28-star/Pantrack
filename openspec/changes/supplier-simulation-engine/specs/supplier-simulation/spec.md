## Purpose

Prove a durable, company-isolated supplier ordering core using fictional suppliers before authorizing any external ordering channel.

## ADDED Requirements

### Requirement: Immutable source and exact quote
The simulation SHALL consume saved v1/v2 replenishment handoffs without recalculating quantities, group by company/supplier/account/location, preserve pack conversions, and require current source versions. Quotes MUST include exact lines, fees, USD totals, expiry and simulated provenance. A changed or expired quote MUST require new approval.

#### Scenario: Requote after approval
- **WHEN** a manager requests a replacement quote
- **THEN** the old approval cannot authorize sending that quote.

#### Scenario: Stale source
- **WHEN** inventory, configuration, settings, proposal revision or Clover health has changed
- **THEN** quote approval and sending fail without supplier invocation.

### Requirement: Server authorization and isolation
Every command and read MUST resolve the authenticated identity and current company membership on the server. Only owners/managers SHALL use the simulation.

#### Scenario: Unprivileged request
- **WHEN** identity is anonymous, an employee, or belongs only to another company
- **THEN** the request is rejected without exposing order data or changing it.

### Requirement: Durable and bounded sending
The engine SHALL persist sending, an exact approval receipt, source holds and a spending reservation atomically before invoking a network-free fake connector. Concurrent requests MUST invoke at most once. Integer USD fixture per-order and UTC-day limits SHALL include unresolved exposure from previous days.

#### Scenario: Concurrent budget claims
- **WHEN** two orders compete for insufficient remaining budget
- **THEN** at most one obtains a reservation and reaches the connector.

#### Scenario: Duplicate source
- **WHEN** a new order or proposal revision reuses an actively held proposal
- **THEN** it cannot send the same quantity again.

### Requirement: Conservative outcome recovery
The durable states SHALL be awaiting_quote, awaiting_approval, approved, sending, unknown, accepted, rejected and canceled. Uncertain, malformed or missing outcomes MUST retain reservations and source holds without automatic resubmission. Only authoritative matching simulated acceptance/rejection SHALL settle an uncertain send. Cancellation SHALL be permitted only before sending.

#### Scenario: Lost response and process restart
- **WHEN** the connector accepts but its response is lost
- **THEN** a restarted engine can reconcile the same reference once without sending again.

#### Scenario: Not found
- **WHEN** reconciliation cannot find an order
- **THEN** exposure and source holds remain reserved for review.

### Requirement: Replay and append-only evidence
Operation IDs MUST bind to the complete command and actor. Identical replay SHALL return the recorded result; conflicting reuse SHALL fail. Quotes, approvals, receipts and events SHALL be immutable, company-scoped evidence.

#### Scenario: Lost database acknowledgment
- **WHEN** a batch commits but its acknowledgment is lost
- **THEN** replay returns the durable receipt without duplicating state or connector calls.

### Requirement: Simulation boundary
The current engine MUST accept only the network-free fictional connector and report simulated provenance. Capability status SHALL distinguish supported, unavailable and unverified. Real purchasing, routes, scheduling, inventory writes and credentials SHALL remain outside this change.

#### Scenario: Real transport injection
- **WHEN** a caller supplies an arbitrary connector object
- **THEN** the simulation refuses it before any transport invocation.
