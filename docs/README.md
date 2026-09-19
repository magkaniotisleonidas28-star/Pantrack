# Pantrack documentation

Start with these documents:

- [Current status](CURRENT_STATUS.md) — authoritative progress summary, open
  blockers, and the next work to perform.
- [Local development](LOCAL_DEVELOPMENT.md) — installation, local D1, fixture
  authentication, verification, reset, and recovery.
- [Milestone roadmap](PANTRACK_MILESTONES.md) — M0–M12 dependencies, scope, and
  acceptance criteria.
- [Milestone readiness](MILESTONE_READINESS.md) — detailed evidence and known
  technical gaps.
- [M2 setup and review](M2_SETUP.md) — Supabase configuration and the remaining
  real-provider acceptance walkthrough.
- [Authentication decision](decisions/0001-m2-authentication.md) — chosen M2
  architecture, session model, roles, invitations, and migration constraints.

Historical evidence is recorded in [M0_LOCAL_EVIDENCE.md](M0_LOCAL_EVIDENCE.md),
[M1_CI_EVIDENCE.md](M1_CI_EVIDENCE.md), and
[M2_LOCAL_EVIDENCE.md](M2_LOCAL_EVIDENCE.md). The
[branch consolidation record](BRANCH_CONSOLIDATION.md) explains how the former
milestone branches were reviewed and incorporated into `main`.

Operator-facing integration contracts live under `public/` because the
application links to them directly:

- [Clover setup](../public/clover-setup-guide.md)
- [Register adapter and ingestion](../public/register-integration-guide.md)
- [Vendor connector protocol](../public/vendor-connector-guide.md)

Passing local or hosted repository checks does not establish that a third-party
service, supplier, payment flow, scheduler, or café pilot works. Each milestone
records the external evidence required before making that claim.
