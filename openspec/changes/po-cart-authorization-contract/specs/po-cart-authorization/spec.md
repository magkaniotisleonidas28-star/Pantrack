# PO cart authorization

## Purpose

Preserve exact saved purchase-order intent at a server-authorized cart preparation
boundary, without treating draft review or fictional preflight as purchase authority.

## ADDED Requirements

### Requirement: Server-scoped preparation preflight
The system SHALL derive actor and current owner/manager membership on the server,
load the current saved PO, and reject client-supplied identity or purchasing lines.

#### Scenario: Unauthorized access
- **WHEN** an anonymous, employee, wrong-company or revoked actor requests preparation inputs
- **THEN** no purchasing input is returned

#### Scenario: Current authorized draft
- **WHEN** a current owner or manager inspects a reviewed fictional PO
- **THEN** exact immutable inputs are returned with authorization still required

### Requirement: Complete immutable binding
Preparation inputs MUST bind company, PO revision, supplier connection version,
account/location, exact lines/conversions/mappings, currency, estimates and cap.
Revalidation SHALL reject changed inputs, inactive connections and canceled sources.

#### Scenario: Stale or changed source
- **WHEN** the revision, lines, mapping, account/location, currency, prices or cap changes
- **THEN** the previous preparation input fails revalidation

#### Scenario: Exact values
- **WHEN** quantities or estimates are invalid, duplicate, unknown or inconsistent
- **THEN** preflight holds the PO without calculating new purchasing quantities

### Requirement: Separate authority and states
The system SHALL keep cart, commercial purchase and delivery state separate.
Fictional preflight MUST NOT authorize real mode, checkout, confirmation, spending
reservations or inventory changes. Durable grants and reservations remain required.

#### Scenario: Real execution attempted
- **WHEN** fictional or review-only inputs are used for a real supplier mode
- **THEN** the request is refused and no external operation occurs
