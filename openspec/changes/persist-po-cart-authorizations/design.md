# Design

## Context

C4 preflight binds reviewed PO inputs but grants no permission. A proposals and
supplier simulations already hold quantities. D1 batches are the atomic boundary.

## Goals / Non-Goals

Remember exact fictional permission across restarts, suppress competing product
claims, and reserve cap exposure under persisted versioned policies. Real mode,
jobs, checkout, production owner controls and inventory effects are excluded.

## Decisions

- Append immutable company connection and budget-policy versions. Missing policy
  fails closed; fixtures explicitly choose $500/order and $1,000 outstanding.
- Save immutable full PO and preflight inputs, policy version, actor, revision,
  audit event and replay receipt in one guarded batch. Database triggers create
  stock commitments and budget reservation and enforce conflicting claims.
- Use one unreleased authorization per PO and one active claim per company/product.
  The originating A proposal is linked, not added to the quantity again. Block
  competing A origins/state commitments and supplier simulation holds in both
  directions. Historical proposal state remains untouched.
- Reuse source guards with exact PO, configuration, proposal/mapping/profile,
  connection, policy and original-authorizer membership checks at commit and use.
- PO edits/cancellation invalidate atomically. Release only before any preparation
  started; other source changes make permission unusable and require explicit safe
  cancellation to release. Cancellation after start retains unresolved exposure.
- An internal guarded start marker lets future consumers record preparation before
  external writes; this is no job claim or browser action. Public API cannot start.
- Permanent operation receipts bind action/input/actor. Retries return historical
  receipt beside current status; never return old authority as current permission.

## Migration Plan

Add tables/guards in 0028; never rewrite 0000–0027. Verify fresh apply, populated
upgrade, historical compatibility, journal/snapshot/schema and D1 local execution.
Rollback disables PANTRACK_CART_PREVIEW; keep records and unresolved claims.
Forward repairs use a new migration, never destructive rollback or reset.

## Risks / Trade-offs

Conservative product serialization may block legitimate overlapping purchases.
Started canceled permission retains exposure until future reconciliation exists.
Read-only validation is advisory; future workers must use an atomic guarded
transition and add leases/fencing before external mutations. Fictional policy is
not real approval, daily/monthly financial control, or M8 acceptance.
