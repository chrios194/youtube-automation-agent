# YouTube API Client boundary and compliance gate

**Reviewed:** 2026-11-15  
**Product:** AgentTube 3.0.0  
**Repository:** `chrios194/youtube-automation-agent`  
**State:** identified implementation; child-directed assessment and required compliance audit remain incomplete  
**Provisioning/publishing:** disabled

## 1. Actual software boundary

The implemented YouTube API Client candidate is the **AgentTube** Node.js/Express application in this repository. The boundary includes the Express application, CredentialManager OAuth flow, PublishingSchedulingAgent, YouTube Data API v3 adapter, and the workspace launcher that starts account processes from this same product code.

Evidence in the inspected `main` revision (`8f84506b97122d04e0b0960c1910fd2e5a618ab0`):

- `index.js` initializes `PublishingSchedulingAgent` as part of the application.
- `utils/credential-manager.js` creates Google OAuth2 clients and requests YouTube scopes.
- `agents/publishing-scheduling-agent.js` calls `google.youtube({ version: 'v3', auth })` and performs `videos.insert`, `videos.list`, `videos.update`, `thumbnails.set`, and `captions.insert`.
- `docs/multi-account-workspaces.md` describes one AgentTube product launching separate account processes with separate databases, credentials, tokens, schedulers, queues, and analytics.
- `workspace.js` resolves each account to a separate runtime/configuration directory.

**Boundary decision:** workspace accounts are instances of the same AgentTube software product; they do not automatically become separate API Clients. The YouTube channel count, repository count, brand name, or deployment count is not a substitute for the actual software/product boundary. If a genuinely distinct application is later implemented, it requires its own boundary review and exclusive API Project.

This AgentTube workspace model uses one codebase for multiple account processes. It is **not** being adopted as a shared code/repository for AIOS Channels 1–10, because that separate project requires independent channel repositories and code.

## 2. Child-directed assessment

**Status: NOT ASSESSED — provisioning blocked.**

The reviewed product documentation positions AgentTube as a creator/business/operator tool for creators, operators, builders, and business teams. No child-facing product positioning was identified in those reviewed documents. However, the full dashboard, marketing surfaces, actual user demographics, age signals, and applicable-law analysis have not been completed. Therefore this is only a preliminary observation, not a final legal classification.

Do not infer the API Client's child-directed status from a channel name, niche, or a video's Made for Kids status. Assess the software product and any component that targets or directs itself to children, using the factors described in the FTC COPPA guidance and Google's Developer Policies.

Official references:

- Google YouTube API Services Developer Policies: https://developers.google.com/youtube/terms/developer-policies
- FTC COPPA guidance: https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- FTC COPPA Rule: https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa

## 3. Project and credential topology

If AgentTube is approved to use YouTube API credentials, it must use **exactly one API Project for this actual AgentTube API Client**, with credentials exclusive to AgentTube. Do not create one project per channel/account/workspace, share the project with a distinct API Client, or create projects to multiply quota.

The app's account-local user authorization namespace is:

`runtime/<workspaceId>/<accountId>/config/tokens.json`

Each account's `credentials.json` and `tokens.json` remain under its own configuration directory. User authorization tokens must never be copied or reused across accounts. The API Project count is independent of the number of channel token namespaces.

The current OAuth scope list is broad and includes upload, full YouTube, read-only, analytics read-only, and force-SSL scopes. A least-privilege scope-to-feature review is still required before OAuth consent is enabled.

## 4. Made for Kids upload control

The inspected uploader currently hardcodes `selfDeclaredMadeForKids: false` for every upload. That is unsafe because the application can be used to create content for different audiences. The uploader must not silently declare every video as not made for kids.

The remediation in this draft requires an explicit per-video boolean from the human content-review form and carries it through both long-form and Shorts scheduling into the YouTube upload request. Missing or ambiguous declarations block approval/scheduling/upload. The value is not inferred from the channel name or niche.

## 5. Account isolation and environment inheritance

The workspace design already uses separate account runtime directories, SQLite databases, credentials, tokens, schedulers, and queues. The source inspection also found that the launcher inherited the parent process environment wholesale, which could leak provider secrets into every child process; it did not enforce uniqueness of each account's `API_KEY` or `AGENTTUBE_MASTER_KEY`.

The draft remediation restricts inherited variables to a safe OS/runtime allowlist, loads each account's own environment file into only that child, makes the account file authoritative in strict mode, and rejects duplicate account API/master keys.

## 6. CI and release state

The repository's default branch is `main`, but its CI workflow was configured only for `master`. The draft remediation enables CI for pull requests and pushes to both `main` and `master`.

No API Project was created, no OAuth client ID/secret or user token was entered, and no YouTube upload, schedule, comment, or other write action was performed. The default compliance configuration remains blocked until the boundary review, child-directed assessment, required compliance audit/approval, exclusive project mapping, and credential authorization are documented.
