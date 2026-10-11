# Design

## Context

Existing v1/v2 POs freeze exact lines; `reviewed` is draft review only. Registry
projections remain review-only. Preview jobs use local files, not application D1.

## Goals / Non-Goals

**Goals:** Provide a server-derived immutable preparation input, explicit state
vocabularies, and repeatable preflight checks before the durable execution slice.

**Non-Goals:** Issue executable grants, persist jobs or reservations, change
review status, expose a new route, or enable real suppliers.

## Decisions

- Separate a strict request (company/PO/expected revision/operation identity)
  from trusted server inputs. Clients cannot supply actor, lines, cap or connection.
- Load POs through the existing D1 draft service and recheck membership after
  loading. A fictional connection is supplied by server code. Real mode is refused
  until production mapping and durable authorization adapters exist.
- Bind the entire saved snapshot plus revision and versioned connection. Canonical
  comparison catches changes to quantities, conversions, mappings, prices, currency,
  account/location and cap even if a caller accidentally reuses a revision.
- Return `authorization: required`. A read-only preflight cannot provide atomic
  commit-time authorization; future jobs must consume a persisted grant under
  transaction guards, leases and reservations. A reviewed PO alone cannot execute.
- Preserve all exact values as strings, verify line arithmetic, refuse unknown
  prices and duplicate SKUs, and return deeply frozen copies.

## Risks / Trade-offs

- Read/preflight race → no executable authority is returned; the durable writer
  must recheck all guards atomically at authorization and before browser writes.
- No real mapping provenance yet → real mode fails closed, including registry POs.
- Existing preview remains independent → its successful demo is never promoted
  to production authority; integration follows durable storage and reservations.

## Migration Plan

No migrations or runtime activation. Rollback removes the unused contract/service;
the documentation decision and existing history can remain.
