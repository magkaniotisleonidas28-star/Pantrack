## ADDED Requirements

### Requirement: Immutable authenticated worker scope
The system SHALL derive worker identity and immutable company/supplier/account
scope from a current hashed bearer credential, independently of manager sessions.

#### Scenario: Credential revoked immediately before commit
- **WHEN** credential status, expiry or identity version becomes invalid before the committing batch
- **THEN** the entire transition rolls back without changing jobs, commitments, stock or incoming

#### Scenario: Wrong scope requests historical operations
- **WHEN** another company, supplier or account credential queries, mutates or replays a job
- **THEN** it cannot discover the job or retrieve its details or receipts

### Requirement: Private expiring credential lifecycle
The system SHALL generate 256-bit local secrets in ignored private files, store
only hashes, default expiry to one hour, audit rotation/revocation and retain identity.

#### Scenario: Rotate a worker credential
- **WHEN** the local fixture rotates a credential
- **THEN** the same worker identity can replay existing receipts and old credentials stop working

### Requirement: Restricted worker HTTP boundary
The system SHALL expose only needed job/lease/line/budget/attempt/result data through
a default-off loopback endpoint with strict schemas, 32 KiB request limit, no browser
CORS grant and private uncached success/error responses.

#### Scenario: Ambient browser identity
- **WHEN** an unauthenticated client supplies cookies or forged identity headers
- **THEN** it gains no worker access

### Requirement: Durable HTTP-only fake worker
The worker SHALL use serialized HTTP mutations, 60-second leases, 20-second
heartbeats, private durable operation UUIDs and at most three retries per operation.
It SHALL have no D1 binding or database credential.

#### Scenario: Lost attempt acknowledgement
- **WHEN** beginAttempt commits but its HTTP acknowledgement is lost or replayed
- **THEN** the worker performs no new provider call and retains uncertainty for review

#### Scenario: Restart with known result
- **WHEN** the fake provider outcome was journaled before a crash
- **THEN** restart publishes it safely with one attempt, result and provider call at most

### Requirement: Conservative recovery and cancellation
The system SHALL requeue only valid never-attempted expired work. Attempted or
uncertain work retains cart ownership, quantity commitments and budget exposure.

#### Scenario: Cancel while provider work is pending
- **WHEN** a stale worker publishes after manager cancellation
- **THEN** its result is rejected and canceled work cannot be revived
