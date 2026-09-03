# Global Operations Runbook

## Promotion sequence

1. Validate portfolio and all workspace manifests.
2. Create a Creator Passport for every enabled account.
3. Generate a unique 32+ character `AGENTTUBE_MASTER_KEY` per security boundary and a unique 24+ character API key per account.
4. Configure OAuth/provider credentials inside each account runtime; never copy token files between creators.
5. Run each account's Production Readiness live checks.
6. Produce and approve one private canary video per new account.
7. Verify backup and restore before scheduling public output.
8. Expand creator cohorts gradually; pause the smallest affected boundary when an incident occurs.

## Kill switches

- Stop one creator process for creator-specific incidents.
- Disable one workspace in the portfolio manifest for pod-wide incidents.
- Revoke an OAuth/provider key at the source for credential compromise.
- Keep `DEFAULT_PRIVACY_STATUS=private` until account verification succeeds.

## Data classes

- Creator runtime: credentials, tokens, media, comments, analytics, evidence, approvals.
- Portfolio control plane: creator/pod IDs, policy, health, aggregate metrics, objective configuration.
- External commerce/CRM: customer identity, consent, order, refund, fulfillment, payment data.

Never replicate secrets or buyer data into portfolio snapshots.
