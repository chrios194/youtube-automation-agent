'use strict';

const crypto = require('crypto');

const ACTION_CAPABILITIES = Object.freeze({
  'videos.insert': 'youtube.publish',
  'videos.update': 'youtube.schedule',
  'thumbnails.set': 'youtube.thumbnail.upload',
  'captions.insert': 'youtube.captions.upload'
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])])
    );
  }
  return value;
}

function hashWritePayload(payload) {
  if (payload === undefined) {
    throw new TypeError('An exact submitted payload is required for write-action consent');
  }
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableValue(payload)))
    .digest('hex');
}

function fail(code, message) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  throw error;
}

function isTimezoneQualified(value) {
  return typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    (value.endsWith('Z') || /[+-][0-9]{2}:[0-9]{2}$/.test(value));
}

function validateWriteActionConsent(consent, expected, options = {}) {
  if (!consent || typeof consent !== 'object' || Array.isArray(consent)) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_REQUIRED', 'A persisted, action-specific user consent record is required');
  }
  const capability = ACTION_CAPABILITIES[expected.apiAction];
  if (!capability || expected.capability !== capability) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_INVALID', 'The requested YouTube API method is not mapped to the approved write capability');
  }
  for (const field of ['apiClientId', 'channelId', 'apiAction', 'resourceScope', 'authorizingUserId']) {
    if (typeof expected[field] !== 'string' || !expected[field].trim()) {
      fail('YOUTUBE_WRITE_ACTION_CONSENT_CONTEXT_MISSING', 'Write-action consent context is missing ' + field);
    }
  }
  if (consent.status !== 'approved' || consent.consentScope !== 'single_action') {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_INVALID', 'Consent must be approved and limited to one specific action');
  }
  if (consent.singleUse !== true || consent.persisted !== true || consent.storageDurable !== true ||
      consent.storageChannelId !== expected.channelId ||
      typeof consent.storageEvidenceRef !== 'string' || !consent.storageEvidenceRef.trim()) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_NOT_DURABLE_SINGLE_USE', 'Consent must be a persisted, durable, channel-local, single-use record with storage evidence');
  }
  if (consent.finalValuesLocked !== true ||
      consent.renewedConsentRequiredForChanges !== true ||
      consent.userControlsFinalValues !== true) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_FINAL_VALUES_NOT_LOCKED', 'The user must control and lock every submitted value; any change requires renewed consent');
  }
  if (consent.apiClientId !== expected.apiClientId ||
      consent.channelId !== expected.channelId ||
      consent.apiAction !== expected.apiAction ||
      consent.capability !== expected.capability ||
      consent.resourceScope !== expected.resourceScope) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_SCOPE_MISMATCH', 'Consent does not match the exact API Client, channel, method, capability, and resource');
  }
  if (consent.authorizingUserId !== expected.authorizingUserId ||
      consent.approvedBy !== expected.authorizingUserId) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_USER_MISMATCH', 'The authenticated authorizing user must be the person who approved the exact action');
  }
  if (typeof consent.consentId !== 'string' || !consent.consentId.trim()) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_ID_MISSING', 'A durable consent record ID is required');
  }
  if (!isTimezoneQualified(consent.approvedAt) || !isTimezoneQualified(consent.expiresAt)) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_TIMESTAMP_INVALID', 'Consent approval and expiry require timezone-qualified timestamps');
  }
  const now = options.now instanceof Date ? options.now.getTime() : Date.parse(options.now || new Date().toISOString());
  if (!Number.isFinite(now) || Date.parse(consent.approvedAt) > now + 60_000 || Date.parse(consent.expiresAt) <= now) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_TIMESTAMP_INVALID', 'Consent approval or expiry timestamp is invalid');
  }
  if (consent.revokedAt != null || consent.consumedAt != null) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_REVOKED_OR_CONSUMED', 'Revoked or previously consumed consent cannot authorize another write');
  }
  const expectedHash = hashWritePayload(expected.payload);
  if (consent.approvedPayloadHash !== expectedHash) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_PAYLOAD_MISMATCH', 'Submitted values or media bytes differ from the exact payload the user approved');
  }
  const visibility = expected.visibility == null ? null : expected.visibility;
  if ((consent.approvedVisibility == null ? null : consent.approvedVisibility) !== visibility) {
    fail('YOUTUBE_WRITE_ACTION_CONSENT_VISIBILITY_MISMATCH', 'Submitted visibility differs from the exact visibility the user approved');
  }
  return {
    consentId: consent.consentId,
    apiClientId: consent.apiClientId,
    channelId: consent.channelId,
    apiAction: consent.apiAction,
    capability: consent.capability,
    resourceScope: consent.resourceScope,
    authorizingUserId: consent.authorizingUserId,
    approvedPayloadHash: expectedHash,
    approvedVisibility: visibility
  };
}

async function requireWriteActionConsent(input = {}) {
  const {
    getConsent,
    consumeConsent,
    now,
    ...expected
  } = input;
  if (typeof getConsent !== 'function' || typeof consumeConsent !== 'function') {
    fail(
      'YOUTUBE_WRITE_ACTION_CONSENT_PROVIDER_UNAVAILABLE',
      'No trusted, persistent, one-use user-consent provider is configured; YouTube write actions remain disabled'
    );
  }
  if (getConsent.durable !== true || getConsent.channelId !== expected.channelId ||
      consumeConsent.atomic !== true || consumeConsent.channelId !== expected.channelId) {
    fail(
      'YOUTUBE_WRITE_ACTION_CONSENT_PROVIDER_NOT_DURABLE_CHANNEL_LOCAL_ATOMIC',
      'Consent lookup must use durable channel-local storage and consumption must be atomic for the same channel'
    );
  }
  const consent = await getConsent({
    apiClientId: expected.apiClientId,
    channelId: expected.channelId,
    apiAction: expected.apiAction,
    capability: expected.capability,
    resourceScope: expected.resourceScope,
    authorizingUserId: expected.authorizingUserId,
    approvedPayloadHash: hashWritePayload(expected.payload),
    approvedVisibility: expected.visibility == null ? null : expected.visibility
  });
  const validated = validateWriteActionConsent(consent, expected, { now });
  const consumed = await consumeConsent(consent.consentId, {
    ...expected,
    approvedPayloadHash: validated.approvedPayloadHash
  });
  if (consumed !== true) {
    fail(
      'YOUTUBE_WRITE_ACTION_CONSENT_REPLAY_OR_REVOCATION',
      'Consent could not be atomically consumed; it may be revoked, expired, or already used'
    );
  }
  return { ...validated, consumed: true };
}

module.exports = {
  ACTION_CAPABILITIES,
  stableValue,
  hashWritePayload,
  validateWriteActionConsent,
  requireWriteActionConsent
};
