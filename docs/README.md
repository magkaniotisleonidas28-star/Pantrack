# Pantrack documentation

Start with these documents:

- [Current status](CURRENT_STATUS.md) — authoritative progress summary, open
  blockers, and the next work to perform.
- [Local development](LOCAL_DEVELOPMENT.md) — installation, local D1, fixture
  authentication, verification, reset, and recovery.
- [Milestone roadmap](PANTRACK_MILESTONES.md) — M0–M12 dependencies, scope, and
  acceptance criteria, including the three-person work split and individual
  checklists.
- [AI-driven development](AI_DEVELOPMENT.md) — task packets, session types,
  verification levels, concurrent-agent rules, review prompts, and handoffs.
- [M2 setup and review](M2_SETUP.md) — Supabase configuration and development
  provider review notes; check current status for remaining hosted work.
- [Authentication decision](decisions/0001-m2-authentication.md) — chosen M2
  architecture, session model, roles, invitations, and migration constraints.

Historical evidence includes [M0 local](M0_LOCAL_EVIDENCE.md),
[M1 CI](M1_CI_EVIDENCE.md), [M2 local](M2_LOCAL_EVIDENCE.md),
[M3 local](M3_LOCAL_EVIDENCE.md), and [M4 B4 local](M4_B4_LOCAL_EVIDENCE.md).
These records are snapshots, not current status. The
[branch consolidation record](BRANCH_CONSOLIDATION.md) explains how the former
milestone branches were reviewed and incorporated into `main`. The
[September 19 readiness assessment](MILESTONE_READINESS.md) is also historical;
its approved M2 permissions matrix remains a decision reference.

Operator-facing integration contracts live under `public/` because the
application links to them directly:

- [Clover setup](../public/clover-setup-guide.md)
- [Register adapter and ingestion](../public/register-integration-guide.md)
- [Vendor connector protocol](../public/vendor-connector-guide.md)

Passing local or hosted repository checks does not establish that a third-party
service, supplier, payment flow, scheduler, or café pilot works. Each milestone
records the external evidence required before making that claim.
