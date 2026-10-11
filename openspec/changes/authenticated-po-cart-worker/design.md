# Design

## Context

Migration 0029 already provides guarded attempts, permanent receipts, exclusive
account-cart ownership and 60-second fenced leases. Transport reuses that service
and its existing quantity/budget reservations.

## Decisions

- Worker scope is immutable company/supplier/account. Bearer credentials contain 256 random bits; D1 stores SHA-256 hashes only. Local private files default to one-hour expiry.
- Rotation revokes old credentials, records audit and preserves identity, fence ownership and operation fingerprints. Revocation/expiry/version/scope predicates run inside each committing batch; reads and replay also reauthenticate.
- `/api/internal/po-cart-worker` requires both preview and worker-transport gates on 127.0.0.1. Browser Origin/Fetch Metadata requests are rejected; sessions and identity headers confer no worker authority. There is no CORS grant.
- Strict GET job query and POST operation schemas accept no identities/scopes. Request bodies are limited to 32 KiB including chunked requests. Responses are private/no-store and omit PO snapshots, notes, members, credentials and audit.
- GET returns a scoped queued/expired candidate or current job status. POST adapts claim/heartbeat/beginAttempt/recordResult/recoverExpired to the existing service, deriving company and worker identity.
- Node client uses HTTP only, redirects disabled, with serialized mutations and 20-second heartbeats. Private journal records UUID intent before sending and fake outcome before publication. Each HTTP operation retries at most three times with the same UUID.
- Only a fresh matching begin acknowledgement and current lease permit the fake call. A resumed/retried begin never permits it. Unknown attempted outcomes are held; known outcomes are safely published. Journal locks prevent concurrent use of one journal.
- Fixture administration is local-only Wrangler; no owner API, remote setup or credential bootstrap over HTTP is added. Windows relies on local account ACLs rather than POSIX mode bits.

## Migration and Rollback

Generate 0030 after 0029; preserve old migrations and all records. Check generated
schema/snapshot/journal, Wrangler splitter, fresh local D1 and a populated 96-table
upgrade. Roll back access by disabling worker transport, preserving credentials,
audit, receipts, jobs, locks and unresolved exposure. Repair schema with a new
migration. Next outcome connects the fictional browser consumer to this transport;
hosted and real execution require separate authorization/evidence.
