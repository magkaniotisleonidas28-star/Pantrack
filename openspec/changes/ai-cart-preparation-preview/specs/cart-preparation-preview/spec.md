# Spec Delta

## Purpose

Prove exact, recoverable cart preparation in a fictional local supplier storefront before connecting a real supplier account.

## ADDED Requirements

### Requirement: Authorized reviewed draft input
The preview SHALL derive its input from a current reviewed draft, enforce company and owner/manager authorization and CSRF, and bind each job to actor, revision and session.

#### Scenario: Unauthorized start
- **WHEN** an anonymous user, another company member, employee, or cross-origin request starts a job
- **THEN** access is denied without browser changes

#### Scenario: Stale source
- **WHEN** the draft is changed or canceled before completion
- **THEN** the job cannot report ready

### Requirement: Exact recoverable cart changes
The runner MUST verify SKU, pack, quantity and price, preserve unrelated items, reject existing requested items, serialize work per cart, and reconcile uncertain writes before retrying.

#### Scenario: Response lost after add
- **WHEN** a cart write succeeds but its response is lost
- **THEN** resume reads the cart and does not add the item twice

#### Scenario: Ambiguous product or changed price
- **WHEN** a product cannot be matched exactly or its price differs from the reviewed estimate
- **THEN** the job stops for review without substituting

### Requirement: Controlled local browser handoff
The preview MUST restrict browser traffic to the fictional storefront, block checkout submission in code and the fixture server, and hand the same visible session to the manager with automation stopped.

#### Scenario: Verified cart
- **WHEN** independent cart verification succeeds
- **THEN** the manager can inspect the same cart without purchasing or changing inventory

### Requirement: Honest bounded AI evidence
Routine tests SHALL be offline. Real AI evaluation MUST be explicitly invoked, use fictional data only, enforce a cumulative $5 ceiling before calls, and report accuracy, interventions, timing and cost separately from simulated evidence.

#### Scenario: Missing credentials or exhausted budget
- **WHEN** required model configuration is missing or a call cannot fit the remaining conservative budget
- **THEN** evaluation stops and does not claim AI effectiveness
