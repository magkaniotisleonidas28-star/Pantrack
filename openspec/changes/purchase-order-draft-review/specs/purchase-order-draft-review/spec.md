## Purpose

Let company managers correct and review purchase-order drafts while preserving their full history and keeping purchasing disabled.

## ADDED Requirements

### Requirement: Audited editing
The system SHALL retain immutable snapshots and actor/time/reason history for saved edits. Source type and supplier/account/location grouping MUST remain fixed; proposal quantities MUST remain unchanged. Prices and quantities SHALL use exact existing validation.

#### Scenario: Edit a reviewed draft
- **WHEN** a manager saves a valid edit with the current revision and a change reason
- **THEN** a new draft revision is saved and prior review no longer applies
- **AND** previous snapshots remain readable

### Requirement: Review-only sign-off
An owner or manager SHALL be able to review their own or another manager's current draft. Review MUST identify the exact revision and MUST NOT authorize sending, reserve budgets/quantities, or change inventory.

#### Scenario: Review incomplete pricing
- **WHEN** a manager acknowledges visible missing-price and fictional-source warnings and reviews a current valid draft
- **THEN** it is labeled reviewed but not approved or sent and unknown prices remain unknown

### Requirement: Isolation and safe retries
All reads and writes MUST enforce company/owner-manager access. Mutations MUST be atomic, revision-guarded and actor-bound idempotent, including commit-time source and membership changes.

#### Scenario: Competing changes
- **WHEN** two different operations target the same revision
- **THEN** exactly one commits and the other reports a conflict without partial history

#### Scenario: Lost response
- **WHEN** the same actor retries an identical operation after its response is lost
- **THEN** the stored original result is returned without another revision

### Requirement: Focused editing experience
The interface SHALL provide one focused editor, inline validation, unsaved-change protection, uncertain-save recovery, spending summary and inspectable revision history on desktop and mobile.

#### Scenario: Stale draft during editing
- **WHEN** another manager changes the draft before a save
- **THEN** the editor preserves entered values and offers the latest saved version for review without overwriting it
