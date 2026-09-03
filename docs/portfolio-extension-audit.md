# Creator Portfolio OS Extension Audit

**Package:** `youtube-automation-agent` v2.10.0  
**Audit scope:** Readiness to extend a single YouTube automation agent into a governed portfolio control plane for up to 100 distinct AI creator businesses.  
**Audit status:** Product decision gate required before implementation.

## Stage 1: Architecture map

| Layer | Technology | Entry point | Notes |
|---|---|---|---|
| Server and API | Node.js, Express | `index.js` | A single process serves a static dashboard and global automation routes. |
| Dashboard | Vanilla HTML, CSS, JavaScript | `dashboard/index.html`, `dashboard/app.js` | A single-channel dashboard uses a browser-stored API key when configured. |
| Persistence | SQLite via `sqlite3` | `database/db.js` | One local database at `data/youtube_automation.db`; schema uses `CREATE TABLE IF NOT EXISTS` and limited additive columns. |
| Research and generation | JavaScript agents plus provider adapters | `agents/*.js`, `utils/ai-text-service.js` | Content strategy, scripting, thumbnails, SEO, production, publishing, analytics, and audience engagement are implemented as global services. |
| Media production | FFmpeg, Playwright, provider adapters | `utils/media-generation-service.js`, `utils/video-providers.js` | Includes resumable generation, provenance, scene repair, and Shorts repurposing. |
| Publishing and analytics | Google/YouTube OAuth and APIs | `agents/publishing-scheduling-agent.js`, analytics agent | One in-memory publish queue and one authenticated YouTube client are initialized for the whole application. |
| Scheduling | `node-cron` | `schedules/daily-automation.js` | A single global set of cron jobs drives generation, publication, analytics, experiments, and engagement collection. |
| Credentials | Local JSON files plus environment variables | `utils/credential-manager.js` | One credentials file and one tokens file are shared by the running process. |
| Test and CI | Node test harness, ESLint, GitHub Actions | `test.js`, `.github/workflows/ci.yml` | `npm ci`, lint, and test run on Node 20 in CI. |

The package is a capable, approval-first **single-channel** operating system. It already has high-value foundation components that should be retained: evidence and provenance records, review gating, resumable generation, publish reconciliation, analytics baselines, controlled packaging experiments, audience-comment workflows, and quality checks.

## Foundation fit assessment

| Portfolio requirement | Current package support | Extension needed |
|---|---|---|
| One creator identity | `channel_profiles` stores one hard-coded `default` profile. | Versioned Creator Identity and Business Passport registry. |
| Multiple creator businesses | No creator, vertical, owner, or tenant identifier is present in core content state. | Creator and vertical tables, scoped foreign keys, and creator-aware repository methods. |
| Multiple YouTube accounts | One global `CredentialManager`, one token object, one publishing client. | Account registry and encrypted credential references bound to creator accounts. |
| Shared research fabric | Content strategy, analytics, comments, and learning are strong single-channel loops. | Evidence graph, vertical routing, source deduplication, and creator-specific opportunity packets. |
| Portfolio approvals | Current content review and publishing gates exist. | Role-based approval policies, approval records, and creator/vertical/portfolio authority scopes. |
| Commerce and stores | Outcome and ROI fields exist but no offers, orders, fulfillment, or customer-consent data model. | Offer catalog, product lifecycle, customer-consent, fulfillment, attribution, and refund data contracts. |
| Continuous optimization | Analytics recommendations and growth experiments are present. | Portfolio objective function, budget allocation, controlled store experiments, health states, pivot policy. |
| Synthetic-identity governance | Provenance and YouTube synthetic-media flag exist. | Identity provenance, public disclosure, impersonation protection, platform-specific disclosure checks, and audit history. |
| 100-creator operations | Current scheduler and process use global state and a singleton queue. | Persistent job queue, creator concurrency controls, horizontal-worker safety, quotas, and operational dashboard. |

## Stage 2: Technical audit

### Critical-01 · No mandatory authentication, roles, or creator ownership boundary

**Severity:** Critical  
**Location:** `index.js:215-227`, `index.js:375-382`, `index.js:419-467`, `index.js:475-520`, `dashboard/app.js:23-50`  
**Affected surfaces:** Dashboard, analytics, schedules, content generation, publication, strategy, approvals, settings, and all future creator data.  
**Steps to reproduce:** Start the service without `API_KEY`. The server explicitly allows all mutating routes to continue. Any party able to reach the service can call a mutation such as `POST /generate` or `POST /publish/:contentId`. Even when `API_KEY` is configured, all authority is reduced to one shared static secret and read endpoints remain unscoped.  
**Root cause:** `requireAPIKey()` calls `next()` when `API_KEY` is absent; it has no user identity, role, session, resource ownership, creator scope, or audit actor. The dashboard stores a static secret in browser local storage.  
**Recommended fix:** Add mandatory operator authentication, server-side sessions or signed access tokens, role and creator-scope authorization, creator ownership checks on every read and write, and immutable approval actor records. Do not use a shared browser-stored API key as the portfolio access model.  
**Effort:** Large  
**Status:** Open, product decision required.

### Critical-02 · Global single-channel schema and credential model cannot isolate creator businesses

**Severity:** Critical  
**Location:** `database/db.js:37-625`, `database/db.js:666-714`, `database/db.js:697-713`, `utils/credential-manager.js:9-16`, `utils/credential-manager.js:84-90`, `utils/credential-manager.js:133-152`, `agents/publishing-scheduling-agent.js:8-43`  
**Affected surfaces:** Creator identity, channel accounts, content, publishing, analytics, audience comments, learning, budgets, offers, customer data, and audit records.  
**Steps to reproduce:** The database initializes one `channel_profiles` row with `id = 'default'`. Core records, including strategies, productions, schedules, analytics, comments, learning recommendations, and settings, do not carry a creator or tenant key. The credential manager writes one YouTube credential and one token object to global files, while the publishing agent initializes one YouTube client and one in-memory queue.  
**Root cause:** The application was designed as a single locally operated channel, not a portfolio system.  
**Recommended fix:** Introduce first-class portfolio, vertical, creator, creator-account, and authority records. Add creator scoping to all persistent content, media, publishing, analytics, learning, experiment, and commerce entities. Replace global credential objects with per-account credential references and account-bound clients.  
**Effort:** Large  
**Status:** Open, product decision required.

### High-03 · Current migration approach is not safe for portfolio-scale schema evolution

**Severity:** High  
**Location:** `database/db.js:34-653`, `database/db.js:655-664`  
**Affected surfaces:** Existing installations, creator onboarding, audit history, release rollout, rollback, and data repair.  
**Steps to reproduce:** The schema is created with `CREATE TABLE IF NOT EXISTS`; the only additive migration helper restricts `ALTER TABLE` to three existing tables. No migration version table, backup checkpoint, rollback procedure, or data backfill mechanism is present.  
**Root cause:** The codebase evolved as a local single-instance tool with additive setup initialization rather than controlled application migrations.  
**Recommended fix:** Add ordered migration files, a schema-version ledger, transaction or backup boundaries, idempotent data backfills, and tested downgrade or recovery instructions. Do not retrofit creator scoping directly into existing rows without a migration plan.  
**Effort:** Large  
**Status:** Open.

### High-04 · Global scheduler and in-memory publishing queue prevent safe multi-creator concurrency

**Severity:** High  
**Location:** `schedules/daily-automation.js:30-108`, `schedules/daily-automation.js:188-238`, `agents/publishing-scheduling-agent.js:13-15`, `agents/publishing-scheduling-agent.js:35-43`, `agents/publishing-scheduling-agent.js:127-190`  
**Affected surfaces:** Scheduling, publishing, analytics, experiments, quotas, retries, and horizontal scaling.  
**Steps to reproduce:** The scheduler creates one set of global cron tasks. It reads one channel strategy and global settings. The publisher loads all queue records into process memory, tracks one publish queue, and initializes one YouTube client. A restart or a second process cannot safely coordinate portfolio-wide processing through that in-memory state.  
**Root cause:** Global job orchestration is coupled to one process and one channel.  
**Recommended fix:** Move scheduling, queue claims, retries, and status transitions to durable creator-scoped jobs with idempotency keys, leases, account quotas, and worker concurrency limits. Use a persistent queue or transactional job table before activating multiple workers.  
**Effort:** Large  
**Status:** Open.

### High-05 · Credential storage and least-privilege controls are inadequate for a multi-account portfolio

**Severity:** High  
**Location:** `utils/credential-manager.js:12-16`, `utils/credential-manager.js:29-54`, `utils/credential-manager.js:84-152`, `.gitignore:7-24`  
**Affected surfaces:** YouTube account access, AI provider keys, token rotation, creator account revocation, incident response, and operator separation.  
**Steps to reproduce:** The credential manager reads and writes unencrypted JSON files under `config/`. Although `.gitignore` excludes these files, every running process with filesystem access can read the same global credentials. No account-level encryption reference, rotation metadata, access record, revocation state, or delegated permission boundary exists.  
**Root cause:** Local file configuration is suitable for a personal single-channel install but not a portfolio with many account owners and operators.  
**Recommended fix:** Store only credential references in application data. Use a server-side secret store or encrypted envelope storage, per-account authorization, rotation and revocation metadata, and explicit ownership and recovery roles.  
**Effort:** Large  
**Status:** Open, product decision required.

### High-06 · Commerce, customer-consent, offer, and fulfillment controls are absent

**Severity:** High  
**Location:** `database/db.js:37-625`, `index.js:431-440`, `README.md:146-152`  
**Affected surfaces:** Digital products, custom deliverables, customer data, pricing, refunds, subscriptions, attribution, and self-optimizing stores.  
**Steps to reproduce:** The application tracks outcome metrics and known production costs but has no database model or approval routes for offers, terms, orders, buyers, entitlement, consent, refunds, or fulfillment.  
**Root cause:** The current package is a channel automation product, not a commerce platform.  
**Recommended fix:** Add a separated commerce domain with creator-scoped offers, explicit terms and consent versions, purchase and fulfillment events, attribution links, refund states, and human-gated price and policy changes.  
**Effort:** Large  
**Status:** Open, product decision required.

### Medium-07 · Dashboard access pattern stores a shared authority secret in browser local storage

**Severity:** Medium  
**Location:** `dashboard/app.js:23-50`  
**Affected surfaces:** Browser operator access and future portfolio data.  
**Steps to reproduce:** Enter `API_KEY` in the dashboard prompt. The value is stored in `localStorage` and sent as a request header. It represents the same authority for every mutating action.  
**Root cause:** The dashboard implements a convenience key prompt rather than a user-authentication and authorization flow.  
**Recommended fix:** Replace static browser-stored credentials with authenticated sessions, short-lived server-issued access tokens, CSRF protection for cookie sessions, login/logout controls, and role-aware navigation.  
**Effort:** Medium  
**Status:** Open.

### Medium-08 · Tests are broad but do not establish tenancy, authorization, migration, or isolated persistent-state safety

**Severity:** Medium  
**Location:** `test.js:17-103`, `test.js:105-180`, `.github/workflows/ci.yml:25-32`  
**Affected surfaces:** Portfolio access control, cross-creator leakage, migration integrity, background-job claims, commerce, and regression safety.  
**Steps to reproduce:** The test harness exercises numerous single-channel features, but it creates `Database` instances using the default on-disk path and contains no creator, role, migration-version, job-lease, account-scope, or customer-consent tests. CI runs lint and `npm test` only.  
**Root cause:** The suite predates the portfolio domain and does not isolate a multi-tenant application contract.  
**Recommended fix:** Add isolated temporary-database fixtures, creator-scoping tests, authorization matrices, migration/backfill tests, durable-job concurrency tests, contract tests for adapters, and end-to-end approval-flow tests.  
**Effort:** Large  
**Status:** Open.

### Medium-09 · Current dashboard and API vocabulary represent one channel rather than portfolio operations

**Severity:** Medium  
**Location:** `dashboard/index.html`, `dashboard/app.js:94-147`, `index.js:475-520`, `database/db.js:537-581`  
**Affected surfaces:** Creator activation, portfolio health, identity review, offer lifecycle, approval queues, and incident response.  
**Steps to reproduce:** The dashboard aggregate returns a single profile, one strategy, global settings, and global pipeline data. The UI has no creator selection, vertical pod, risk status, identity version, offer status, or portfolio health views.  
**Root cause:** The user experience models a single YouTube workspace.  
**Recommended fix:** Add a portfolio dashboard with a creator registry, creator detail view, vertical pod view, approval queue, offer catalog, audit explorer, and health/pivot boards.  
**Effort:** Large  
**Status:** Open.

## Checklist outcomes

| Audit area | Outcome |
|---|---|
| Repository and build integrity | ⚠️ CI has clean install, lint, and tests; portfolio migrations, production deployment, dependency scanning, and rollback procedures are missing. |
| Security and privacy | ❌ Critical gaps in mandatory authentication, authorization, tenant ownership, secret isolation, session handling, and customer-data model. |
| Data integrity and persistence | ❌ Core state is single-channel and schema evolution is not versioned. No creator partition, migration ledger, or durable worker lease exists. |
| API and backend correctness | ⚠️ Several request validators and fail-closed publication checks are present; all resource contracts are global and no portfolio API version or role model exists. |
| Frontend correctness and UX | ⚠️ Existing dashboard escapes untrusted values in the reviewed helper and has meaningful quality feedback; it cannot operate a multi-creator portfolio or provide role-aware approval workflows. |
| Integrations and external dependencies | ⚠️ YouTube upload reconciliation, provider fallback, and readiness checks are thoughtful; account, credential, quota, and failure state remain global. |
| Testing and observability | ⚠️ Broad local system tests and CI exist; no isolated multi-tenant, migration, approval-role, worker-concurrency, or commerce tests exist. |
| Code quality and maintainability | ⚠️ Domain services are reasonably separated, but global state and direct SQLite accessors would create fragile cross-cutting changes without a portfolio domain layer. |

## Stage 3: Product decision gate

Implementation should not begin until the following decisions are confirmed. Each affects data-model migration, authorization, deployment, and account ownership.

| Decision | Option A | Option B | Tradeoff requiring confirmation |
|---|---|---|---|
| **Operator access model** | Single internal operator workspace with an owner and approval roles. | Multi-organization application with separate client workspaces and users. | Option A is much smaller and safer for the first portfolio. Option B requires full tenant isolation, user lifecycle, and organization billing. |
| **Initial platform scope** | YouTube-first, with a platform abstraction that adds Instagram and TikTok adapters later. | Multi-platform publishing in the first release. | YouTube-first reuses the strongest current code and minimizes account, analytics, and disclosure complexity. Multi-platform requires separate approval and analytics contracts immediately. |
| **Portfolio database strategy** | Introduce creator-scoped domains in a durable relational backend and retain a controlled import path from current SQLite data. | Extend the existing SQLite schema in place for all portfolio state. | A durable relational backend better supports 100 creators, concurrent workers, and future multi-user access. In-place SQLite is faster for a local pilot but becomes a scaling constraint. |
| **Credential custody** | Central portfolio owns all creator accounts and stores authorization references in one managed secret boundary. | Each creator or client connects and retains its own account authorization. | Central custody simplifies operations but increases security responsibility. Delegated custody improves separation but requires a full account-connect and revocation experience. |
| **Commerce starting point** | Digital-utility catalog plus scoped paid deliverables, with human approval for offers and pricing. | Full multi-store commerce, subscriptions, affiliates, and enterprise workflows in the first release. | The first option validates product-market fit and fulfillment before building a large billing and compliance surface. |

## Recommendation

**No-Go for direct scale to 100 public creators on the current package.** The current package is fit as a feature-rich single-channel production engine and a useful component of the future portfolio, but it needs a new portfolio control plane before multi-creator use.

The recommended first implementation scope is: **one internal portfolio workspace, YouTube-first, three creator cells, creator-scoped relational state, delegated or centrally governed account authorization chosen explicitly, draft-first publication, and a digital-utility offer catalog with approval-controlled commercial actions.**

No code changes beyond this audit document have been made.
