# Multi-Account Workspaces

## Purpose

This release adds a **repeatable workspace launcher** for operating several independent creator-account systems in parallel. It does not convert one local AgentTube instance into a global multi-tenant platform. Instead, each creator account runs in its own isolated process, with its own database, configuration directory, OAuth tokens, approval key, dashboard port, job scheduler, production assets, and analytics history.

> **Workspace model:** One bounded workspace launches multiple independent account processes. Each account process remains a single-channel AgentTube system. Run multiple workspaces when the portfolio grows beyond the operational capacity or risk boundary of one workspace.

This matches the portfolio strategy: scale through controlled, repeatable systems rather than placing every creator identity, channel credential, customer relationship, and automation loop inside one global process.

## What is isolated

| Boundary | Account-level isolation |
|---|---|
| **YouTube authorization** | Each account stores its own `credentials.json` and `tokens.json` under its workspace runtime directory. |
| **Production data** | Each account uses its own SQLite database and generated asset paths. |
| **Automation** | Each account has its own scheduler, queue, content buffer, publishing cadence, and analytics loop. |
| **Dashboard** | Each account is served on its own local port and requires its own API key in workspace strict mode. |
| **Identity and brand** | Each account has its own channel profile, strategy, content history, visual system, approval queue, and provenance records. |
| **Failure containment** | A failed provider call, invalid token, bad schedule, or paused workflow affects the individual account process rather than every account in the workspace. |

## What remains shared by the operator

The workspace launcher starts and monitors the bounded group of processes. The operator may reuse common policies, source libraries, creator-passport templates, prompt assets, and approved offer primitives outside the account runtime directories. Do not share an account database, token file, API key, audience data, or customer data between creators.

## Quick setup

1. Copy the example workspace manifest.

```bash
cp config/workspace.example.json config/workspace.json
```

2. For each account, create the account runtime and environment file shown in the manifest. The environment file must define a unique API key of at least 24 characters, plus any account-specific provider and channel settings.

```bash
mkdir -p runtime/creator-pod-alpha/creator-ai-ops
chmod 700 runtime/creator-pod-alpha/creator-ai-ops
```

Example `runtime/creator-pod-alpha/creator-ai-ops/account.env`:

```env
API_KEY=replace-with-a-unique-long-random-account-key
CHANNEL_NAME=AI Operations Creator
TARGET_AUDIENCE=Small business operators and technical teams
YOUTUBE_REGION=US
DEFAULT_PRIVACY_STATUS=private
OPENAI_API_KEY=replace-with-the-account-or-workspace-approved-provider-key
```

3. Validate the manifest before launching anything.

```bash
npm run workspace:validate
npm run workspace:status
```

4. Configure YouTube authorization for each account with the workspace command. This command starts the existing credential wizard inside the selected account’s runtime environment, so its credentials and tokens are written only inside that account configuration directory.

```bash
node workspace.js credentials --account creator-ai-ops
node workspace.js credentials --account creator-quantum
```

5. Start all enabled accounts, or one selected account.

```bash
npm run workspace:start
node workspace.js start --account creator-ai-ops
```

## Manifest contract

| Field | Required | Description |
|---|---:|---|
| `version` | Yes | Must be `1`. |
| `workspaceId` | Yes | Lowercase workspace identifier. |
| `host` | Yes | Bind host. Use `127.0.0.1` unless a secured reverse proxy and access policy are intentionally configured. |
| `accounts[].id` | Yes | Lowercase account identifier, unique within the workspace. |
| `accounts[].name` | Yes | Operator-readable creator or channel label. |
| `accounts[].enabled` | No | Defaults to enabled. Disabled accounts are validated but not launched. |
| `accounts[].port` | Yes | Unique local port from 1024 through 65535. |
| `accounts[].envFile` | Yes | Account-specific environment file. It must define a unique `API_KEY`. |
| `accounts[].runtimeDir` | No | Defaults to `runtime/<workspaceId>/<accountId>`. It must end with the account identifier. |
| `accounts[].dataDir` / `configDir` | No | When supplied, they must remain inside `runtimeDir`. |

The launcher rejects duplicate account IDs, ports, data paths, configuration paths, unsafe identifiers, missing environment files, weak keys, and directories outside an account runtime root.

## Approval and publication policy

The launcher turns on `WORKSPACE_STRICT_MODE=true`. In this mode, `API_KEY` is mandatory and the account’s analytics, schedule, and API surfaces require that account’s key. The application binds to `127.0.0.1` by default.

This is a **single trusted internal operator model**, not a multi-user authorization system. The existing content review, factual review, rights confirmation, synthetic-media disclosure, and publish approval gates remain active. The workspace launcher does not create a new public account, change a price, send customer communications, or widen publication authority.

## Creator identity and product controls

Before an account is activated, maintain a Creator Identity and Business Passport outside the runtime secret directory. The passport should define the creator’s public identity, synthetic-media transparency text, permitted claims, background narrative boundaries, target audience, brand system, show formats, offer boundaries, and restricted topics.

For the lean release, use the existing channel system only for content production and YouTube learning. Maintain commerce and customer data in a separate approved system until the portfolio control-plane phase adds offer, consent, fulfillment, and attribution domains. Do not store buyer data in the channel database.

## Operational limits

The launcher supports at most 12 account processes per workspace. This is an intentionally conservative operational cap for the lean release. Use separate workspaces to isolate creator pods by vertical, operator, security boundary, or platform account owner.

The launcher does not provide cross-account queue balancing, pooled model budgets, centralized account analytics, or role-based user access. Those are deliberate future portfolio-control-plane features. This release proves isolated repeatable account systems first.

## Incident response

| Event | First action |
|---|---|
| One account publishes incorrectly | Pause or stop that account process. Review its evidence, approval, rights, and schedule records. Do not stop unrelated accounts. |
| One token is revoked or invalid | Re-authorize only that account. Do not copy tokens from another account. |
| A provider is unavailable | Keep the account in draft or recovery state. Do not silently publish simulation output. |
| A creator identity or disclosure issue is discovered | Pause that creator, correct or remove affected public content according to platform policies, preserve the audit record, and review the passport before restarting. |
| A workspace manifest fails validation | Do not launch. Fix the collision, unsafe path, missing file, or API key requirement reported by the validator. |

## Transition to the portfolio control plane

A later centralized portfolio layer should consume account-level exports or approved read-only API events. It should not directly merge all account databases, credentials, customer data, or approval keys. The migration threshold is reached when shared portfolio analytics, cross-creator experiments, commerce attribution, multi-user roles, or worker orchestration require capabilities that a bounded independent workspace cannot provide safely.
