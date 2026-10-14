# Purchasing supplier registry

## Purpose

Provide company-isolated reusable suppliers and exact supplier-specific inventory mappings for review-only purchase-order drafts.

## ADDED Requirements

### Requirement: Authorized versioned supplier profiles
Managers and owners SHALL create, edit, archive and inspect supplier profiles, accounts and delivery locations. Every change MUST retain actor, reason, time and immutable version history. Anonymous, employee and foreign-company access MUST be denied; mutation membership MUST be rechecked at commit. Missing estimates and unknown email acceptance MUST remain explicit.

#### Scenario: Archive a supplier
- **WHEN** a manager archives a supplier
- **THEN** it is unavailable for new draft selections and its profile and prior draft history remain readable

### Requirement: Exact supplier-specific mappings
Mappings SHALL link company inventory items to supplier/account/location SKUs with independently configured exact packs and optional estimates. The server MUST validate scoped units and current inventory configuration. Different suppliers SHALL support different packs for the same item. Duplicate active group SKUs and stale or incompatible mappings MUST be rejected without inventory changes.

#### Scenario: Different supplier packs
- **WHEN** two suppliers map one item using packs of six and twelve each
- **THEN** their draft quantities use their respective frozen conversions without changing the item's purchase configuration

### Requirement: Atomic auditable replay
Registry changes MUST atomically save version, audit and actor/payload-bound operation receipts. Stale versions and changed retries MUST fail; lost-response retries MUST return the original result.

#### Scenario: Concurrent edit
- **WHEN** two different operations edit the same expected version
- **THEN** only one commits and no partial losing version or event is saved

### Requirement: Frozen registry-backed drafts
Drafts SHALL resolve current profile and mappings on the server and freeze their complete references and exact values. Archived, stale, mixed-group and duplicate-product selections MUST fail at commit. Existing drafts and fictional proposal contracts MUST remain compatible and unchanged. A separate versioned mapping projection SHALL support future replenishment integration without recalculating proposals.

#### Scenario: Later supplier edit
- **WHEN** a supplier email, address, estimate or pack is edited after a draft is saved
- **THEN** the saved draft retains its original supplier, mapping versions and exact quantities

### Requirement: Local review boundary
The registry and draft UI MUST default off and MUST NOT approve, reserve, send, change inventory or mutate proposal history. Reported supplier email acceptance MUST NOT enable submission.

#### Scenario: Incomplete ordering setup
- **WHEN** a manager saves an unknown-email-acceptance supplier and a missing-price draft
- **THEN** incomplete setup is clearly warned and no supplier or inventory action occurs
