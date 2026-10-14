# Purchase-order drafts

## Purpose

Provide durable company-isolated purchase-order drafts and history as the foundation for future reviewed supplier email ordering.

## ADDED Requirements

### Requirement: Authorized durable drafts
The system SHALL let authenticated company managers and owners create and inspect persistent drafts. Anonymous users, other-company members and employees MUST NOT access purchasing details or mutate drafts. Authorization MUST be checked again at mutation commit.

#### Scenario: Forbidden purchasing access
- **WHEN** an employee or a member of another company requests PO details
- **THEN** access is denied without revealing any PO data

### Requirement: Exact manual and proposal lines
The system SHALL support manual inventory and non-stock lines and drafts from saved v1/v2 proposals. Inventory conversions MUST be derived from saved company-owned configuration; proposal quantities, revisions, SKUs, estimates and conversions MUST remain unchanged. Unsafe, canceled, invalidated, duplicate or mixed-group proposal sources MUST be rejected without modifying upstream history.

#### Scenario: Save a proposal draft
- **WHEN** a manager selects current saved proposal revisions belonging to one supplier/account/location
- **THEN** the saved draft preserves their complete immutable handoffs and exact whole-pack quantities

#### Scenario: Manual non-stock line
- **WHEN** a manager saves a non-stock line
- **THEN** it is explicitly classified as non-stock and has no inventory conversion or product mapping

### Requirement: Immutable history and replay
The system SHALL retain the original supplier/delivery snapshot, a stable PO reference, lines, warnings, draft spending cap and an immutable creation/cancellation audit. Commands MUST be atomic and replay-safe; a reused operation ID with changed payload or actor MUST fail.

#### Scenario: Lost save acknowledgment
- **WHEN** a committed save loses its response and the manager retries the same operation
- **THEN** the original result is returned without creating another draft or audit event

### Requirement: Review-only boundary
The preview MUST default off and SHALL display drafts as not sent. Creating, reading or canceling a draft MUST NOT send email, approve a purchase, reserve budget, hold proposal quantities, change inventory or alter proposal history.

#### Scenario: Cancel a draft
- **WHEN** a manager cancels a saved draft with the current revision and a reason
- **THEN** its immutable snapshot and history remain readable and no supplier or inventory action occurs
