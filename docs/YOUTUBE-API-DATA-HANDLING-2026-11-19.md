# YouTube publisher API Data handling — 2026-11-19

**Status: BLOCKED — no API Data collection or storage is approved.** This document records policy and source-review requirements; it does not prove deployment or authorize credentials.

## Prohibited access methods
Do not scrape YouTube Applications or use undocumented YouTube Application endpoints, including youtubei.js/Innertube or undocumented /youtubei routes. Do not use unofficial transcript extraction. Google policy: https://developers.google.com/youtube/terms/developer-policies/ (III.D.6).

## Official captions API
- captions.list returns caption-track metadata only: https://developers.google.com/youtube/data/reference/rest/v3/captions/list
- captions.download requires the authorized user to have permission to edit the video: https://developers.google.com/youtube/data/reference/rest/v3/captions/download
- Neither endpoint is a general public-video transcript source.

## Retention and deletion
- Other Authorized API Data and Non-Authorized API Data must be refreshed or deleted within 30 calendar days.
- The Analytics API/Reporting API/statistics exception requires specific consent from an active user and rechecks of authorization and video existence every 30 calendar days.
- User-requested deletion: as soon as possible and within 7 calendar days.
- Client-initiated revocation: revoke the token immediately and delete related Authorized API Data as soon as possible and within 7 calendar days.
- Google Security Settings revocation: delete all related API Data as soon as possible and within 30 calendar days.

Official source: https://developers.google.com/youtube/terms/developer-policies/ (III.D.3, III.E.4, III.E.7).

## Verification blockers
The current config keeps API Data collection and storage false and marks the data-access method review as not_reviewed. The following are not verified in a deployed environment: storage inventory, retention job execution, Analytics authorization recheck, video-existence recheck, user deletion, immediate token revocation, client-revocation deletion, Google Security Settings revocation deletion, and cross-channel aggregation disabled. No API Data may be enabled until each is verified against the exact deployed environment and commit SHA.

Cross-channel and cross-content-owner API Data aggregation remain disabled. Central dashboards may display operational metadata only. Each channel's user authorization/token namespace and business resources remain isolated.
