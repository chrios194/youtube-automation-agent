# YouTube API Data handling gate — 2026-11-21

**Application:** YouTube Automation Agent / AgentTube v3 publisher  
**Status:** blocked, draft branch only; no API Project, OAuth credential, user token, API Data collection, storage, or publishing is authorized.

## Policy requirements

- Other Authorized API Data and Non-Authorized API Data: refresh or delete within 30 calendar days.
- Limited Analytics API / Reporting API / statistics exception: specific consent from an active user; recheck both authorization and video existence every 30 calendar days.
- User-requested deletion: as soon as possible, within 7 calendar days.
- User revokes through this API Client: revoke the token immediately and delete related Authorized API Data as soon as possible, within 7 calendar days.
- User revokes through Google Security Settings: delete all related API Data as soon as possible, within 30 calendar days.
- No unofficial scraping or undocumented YouTube Application endpoints, including youtubei.js/Innertube.
- captions.list returns caption-track metadata only; captions.download requires the authorized user to have permission to edit the video and is not a public-video transcript endpoint.
- No cross-account, cross-channel, or cross-content-owner API Data aggregation. The central dashboard may see operational metadata only.

Official policy: https://developers.google.com/youtube/terms/developer-policies/

## Explicit deployment-verification gate

The publisher's `utils/youtube-compliance-gate.js` now requires:
- exact deployed environment reference and deployed 40-character commit SHA;
- complete deployed storage inventory and evidence;
- 30-day retention-job execution evidence;
- Analytics authorization and video-existence recheck execution evidence;
- end-to-end user deletion evidence;
- immediate token revocation and client-revocation deletion evidence;
- Google Security Settings revocation deletion evidence;
- separate, explicit cross-account, cross-channel, and cross-content-owner aggregation-disabled statuses and evidence;
- timezone-qualified verification timestamp no older than 30 days.

The latest change adds explicit `crossChannelAggregationStatus`, `crossContentOwnerAggregationStatus`, `crossChannelAggregationEvidenceRef`, and `crossContentOwnerAggregationEvidenceRef`. A generic cross-account flag is not accepted as proof of cross-channel or cross-content-owner isolation.

## Source findings and limitations

- The publisher is one actual Node.js/Express API Client application if it continues to use YouTube Data API and Analytics API. It is not one API Client per channel.
- The default `main` branch still contains legacy OAuth/token paths and a hardcoded Made-for-Kids false path. Do not use it.
- The compliance draft branch enforces isolated workspace paths and fail-closed project/data gates. Its current config remains unapproved and has no API Project ID or OAuth client ID.
- The branch's current workflow inventory still shows no CI run or commit status. The new cross-channel/content-owner gate changes are therefore **not tested by GitHub CI**.
- No exact deployed storage inventory, retention execution, analytics rechecks, user deletion, immediate token revocation, client-revocation deletion, Google Security Settings deletion, or cross-channel/content-owner aggregation-disabled runtime evidence has been obtained.
- The PR remains draft/unmerged. No deployment was verified.

## Current provisioning state

- API Client source boundary: identified; deployment and owner review unresolved.
- Child-directed status: NOT ASSESSED; owner attestation and audience evidence pending.
- API Project: null.
- OAuth client ID/secret: none provisioned.
- User tokens: none provisioned.
- API Data collection/storage: not approved.
- Publishing: disabled.
- Cross-account/cross-channel/cross-content-owner aggregation: disabled.

**Decision:** keep the gate closed. Do not create an API Project, OAuth credentials, user tokens, or enable API Data collection/storage or publishing until the actual deployment, child-directed assessment, compliance audit and every required deployed control are verified.
