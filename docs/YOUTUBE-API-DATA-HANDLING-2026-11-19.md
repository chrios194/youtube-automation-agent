# YouTube publisher API Data handling and content-rights gate — 2026-11-24

**Status: BLOCKED — no API Data collection or storage, media copying, derived metrics, or YouTube write actions are approved.** This document records source-level policy controls; it does not prove deployment or authorize credentials.

## Prohibited access methods
Do not scrape YouTube Applications or use undocumented YouTube Application endpoints, including youtubei.js/Innertube or undocumented /youtubei routes. Do not use yt-dlp, browser extraction, unofficial transcript services, or scraping to obtain YouTube audiovisual content or API Data. Google policy: https://developers.google.com/youtube/terms/developer-policies/ (III.D.6).

## Official captions API
- captions.list returns caption-track metadata only: https://developers.google.com/youtube/data/reference/rest/v3/captions/list
- captions.download requires the authorized user to have permission to edit the video: https://developers.google.com/youtube/data/reference/rest/v3/captions/download
- Neither endpoint is a general public-video transcript source.

## Audiovisual content rights and provenance
Do not download, import, back up, cache, or store copies of YouTube audiovisual content without YouTube's prior written approval. A public YouTube URL is not permission to download or repurpose audiovisual content. Use original source files, user-supplied files, or rights-holder assets obtained directly through authorized sources. Record source reference, explicit acquisition method, asset SHA-256, ownership/license evidence, user permission where applicable, and rights-holder authorization where applicable. YouTube-sourced audiovisual content requires both prior written YouTube approval and source-owner license/permission evidence. Even with approval, yt-dlp, browser extraction, youtubei.js/Innertube, undocumented endpoints, unofficial transcript services, and scraping remain prohibited.

## Derived metrics
No scores, rankings, leaderboards, financial projections, sentiment analysis, or other metrics derived from YouTube API Data by default. The narrow exception requires the exact API Client to accept the current Additional Policies amendment for Section 5 / Analytics & Reporting, pass the use-case compliance audit, and obtain Google's standard quota-extension approval for the exact allowlisted metrics and storage. Approved statistical data and derived metrics may be retained for at most 36 calendar months; all other API Data remains under the 30-day refresh/delete rule. Cross-channel and cross-content-owner aggregation remains disabled. Any central leaderboard may use independently generated non-YouTube operational metrics only.

## Retention and deletion
- Other Authorized API Data and Non-Authorized API Data must be refreshed or deleted within 30 calendar days.
- The Analytics API/Reporting API/statistics exception requires specific consent from an active user and rechecks of authorization and video existence every 30 calendar days.
- User-requested deletion: as soon as possible and within 7 calendar days.
- Client-initiated revocation: revoke the token immediately and delete related Authorized API Data as soon as possible and within 7 calendar days.
- Google Security Settings revocation: delete all related API Data as soon as possible and within 30 calendar days.

Official source: https://developers.google.com/youtube/terms/developer-policies/ (III.D.3, III.E.4, III.E.7).

## Write-action consent
No YouTube write action is enabled. Any future write requires prior specific and express consent for the exact action, a durable channel-local record, exact API Client/channel/method/resource/user scope, single use, atomic consumption immediately before adapter dispatch, and replay rejection. The user controls final title, description, tags, visibility, and all submitted values; lock them after approval and obtain renewed consent for any change. Child-Directed API Clients must not perform write-based actions. Automated views, likes, comments, subscriptions, and other engagement manipulation are prohibited. The consent provider remains unconfigured and no YouTube publisher credentials or tokens exist.

## Verification blockers
The current config keeps API Data collection and storage false and marks the data-access method review as unapproved. The following are not verified in a deployed environment: storage inventory, retention job execution, Analytics authorization recheck, video-existence recheck, user deletion, immediate token revocation, client-revocation deletion, Google Security Settings revocation deletion, cross-channel/cross-content-owner aggregation disabled, durable consent-store execution, and audiovisual source-rights controls. No API Data or write action may be enabled until each applicable control is verified against the exact deployed environment and commit SHA.

Cross-channel and cross-content-owner API Data aggregation remain disabled. Central dashboards may display operational metadata only. Each channel's user authorization/token namespace and business resources remain isolated.
