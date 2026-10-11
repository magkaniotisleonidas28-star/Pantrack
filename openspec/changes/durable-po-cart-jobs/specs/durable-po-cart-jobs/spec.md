## ADDED Requirements

### Requirement: Durable isolated jobs reuse permission
The system SHALL save one immutable job per authorization with actor-bound replay,
current server authorization and no additional quantity or spending reservation.

#### Scenario: Duplicate enqueue after a lost response
- **WHEN** a manager repeats the same enqueue operation
- **THEN** the original receipt and current job state are returned with one job and unchanged reservations

### Requirement: Fenced exclusive cart ownership
The system SHALL serialize jobs by company/supplier/account across locations and
connection versions with 60-second server-time leases and monotonic fencing tokens.

#### Scenario: Worker loses its lease
- **WHEN** a worker publishes after expiry or ownership transfer
- **THEN** its transition is rejected and cannot revive the old lease

### Requirement: Attempts precede provider calls
The system SHALL atomically record an immutable line attempt and mark permission
started using current membership/source guards before invoking a fake provider.

#### Scenario: Source changes immediately before commit
- **WHEN** membership, PO, mapping, configuration, connection or policy changes before an attempted write commits
- **THEN** no attempt, authorization start or provider call occurs

### Requirement: Uncertainty retains ownership and exposure
The system SHALL recover never-attempted expired work to the same queue entry and
hold any attempted expired work for review without automatic replay.

#### Scenario: Crash after provider call
- **WHEN** a process restarts without a recorded result for an attempt
- **THEN** the job requires review and retains its cart, commitments and budget exposure

### Requirement: Cancellation and invalidation stop work
The system SHALL propagate authorization cancellation/invalidation atomically,
release only never-started work and reject late results. Preparation does not confirm
or cancel a supplier purchase and does not change inventory.

#### Scenario: Cancel started preparation
- **WHEN** a manager cancels a job with a recorded attempt
- **THEN** further work stops while ownership and reservations remain unresolved
