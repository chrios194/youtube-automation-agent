# AgentTube World Release Architecture

## What “world-ready” means

AgentTube should be able to operate a portfolio of creator businesses without turning one model failure, credential leak, bad prompt, provider outage, or accidental publication into a portfolio-wide incident. The production architecture therefore remains **federated**: one creator account per isolated runtime, bounded workspace pods, and a portfolio control plane that coordinates policy and decisions without pooling raw secrets or customer data.

## Invariants

1. **Identity is explicit.** Every creator has a Creator Identity & Business Passport describing public identity, disclosure, editorial point of view, shows, restricted claims, offers, and platform permissions.
2. **Publication is approval-first.** Private is the default; simulated media, missing narration, unresolved rights, factual-review failures, or uncertain uploads cannot publish.
3. **Secrets never become portfolio data.** OAuth tokens and provider credentials remain inside each creator runtime. `AGENTTUBE_MASTER_KEY` encrypts local credential files in strict deployments.
4. **Scale by pods, not one giant process.** Each workspace is deliberately bounded. The portfolio manifest can coordinate many pods while preserving failure containment.
5. **Optimization is outcome-aware.** Views are an input, not the objective. The portfolio objective balances qualified attention, trust, retention, revenue, cost, and profit.
6. **Learning is evidence-backed.** Simulated analytics never become learning evidence. Cross-creator learnings must be abstracted patterns, not leaked creator/customer data.
7. **Platforms are capabilities, not assumptions.** YouTube is implemented. TikTok, Instagram/Reels, commerce, and additional destinations enter through explicit adapters with platform-specific publishing, analytics, rights, and disclosure contracts.
8. **Humans govern irreversible actions.** New channels, public publication, identity changes, price changes, buyer communications, refunds, and materially new claims remain human-authorized unless a future policy explicitly and safely delegates them.

## Runtime topology

`Portfolio -> Workspace Pod -> Creator Account -> Production / Review / Publish / Learn`

The portfolio layer stores only manifest metadata, policy, objective definitions, aggregate health, and export-safe metrics. Creator runtimes store production assets, account analytics, evidence, approval records, and credentials.

## Global creator-business loop

`Signal -> Opportunity packet -> Show/format router -> Research -> Script -> Assets -> Rights/fact/disclosure review -> Publish -> Distribution -> Audience feedback -> Analytics -> Outcome/ROI -> Learning -> Next opportunity`

This retains AgentTube’s existing research-to-learning loop and extends it with the operating-system concepts developed in the Creator Media OS: recurring shows, trigger-driven research, business offers, multi-platform distribution, analytics actionization, and portfolio resource allocation.

## Release gates

A deployment is not “world-ready” merely because unit tests pass. The operator must also complete account-level live readiness checks for each enabled provider and YouTube account, verify backup/restore, review the Creator Passport, confirm default-private publication, and run a canary creator through research -> production -> review -> scheduled private upload -> analytics retrieval before widening the cohort.

## Deliberate non-goals in this package

This release does not claim live TikTok/Instagram publishing without those platform credentials and API approvals. It does not put customer PII in AgentTube. It does not silently autonomize public publishing or commercial decisions. Those are integration/delegation steps, not code-completeness shortcuts.
