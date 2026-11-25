"use strict";

const YOUTUBE_OAUTH_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl"
]);

module.exports = { YOUTUBE_OAUTH_SCOPES };
