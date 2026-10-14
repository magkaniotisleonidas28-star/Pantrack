## ADDED Requirements

### Requirement: Durable atomic fictional permission
The system SHALL persist exact reviewed PO inputs, actor, connection and policy
versions together with quantity commitments, cap reservation, audit and replay
receipt in one transaction. Real connections and missing policies SHALL fail closed.

#### Scenario: Repeated authorization and service restart
- **WHEN** a manager retries an operation or restarts the service
- **THEN** one saved authorization and reservation remain and the receipt includes current status

#### Scenario: Atomic denial and budget races
- **WHEN** concurrent requests exceed outstanding exposure, duplicate a product, or membership is revoked before commit
- **THEN** only eligible transactions commit and failed transactions leave no partial claims

### Requirement: Current truth and conservative commitments
The system SHALL check company/role, original authorizer, PO revision, exact
configuration, applicable proposal/mapping/profile, connection and policy before
permission can be used. It SHALL block competing A/C commitments and recognize
the originating proposal as the same quantity.

#### Scenario: Stale source
- **WHEN** any bound source changes
- **THEN** permission is unusable and unresolved claims remain until safe cancellation

### Requirement: Safe invalidation and cancellation
PO edits or cancellation SHALL invalidate authorization atomically. Only work
whose preparation never started SHALL release commitments and exposure. Canceling
preparation SHALL NOT assert supplier cancellation or affect stock or incoming.

#### Scenario: Cancel and old receipt retry
- **WHEN** a manager cancels then retries the old authorization operation
- **THEN** the historical receipt is returned beside canceled current permission without creating another claim

#### Scenario: Preparation already started
- **WHEN** started permission is canceled or its PO changes
- **THEN** authorization is unusable but reservations remain counted

### Requirement: Company API boundary
The company API SHALL be default-off and loopback-only with owner/manager
authorization, mutation CSRF protection and UUID actor-bound operation identities.
It SHALL derive quantities, cap and connection from server records.

#### Scenario: Untrusted or forbidden caller
- **WHEN** an anonymous, wrong-company, employee, revoked caller or forged input is submitted
- **THEN** the request is denied without disclosing another company's permission or changing claims
