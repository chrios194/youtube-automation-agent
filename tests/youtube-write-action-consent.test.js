'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ACTION_CAPABILITIES,
  hashWritePayload,
  validateWriteActionConsent,
  requireWriteActionConsent
} = require('../utils/youtube-write-action-consent');
const {
  isYouTubeUrl,
  validateMediaSourceProvenance,
  hashFile,
  verifyMediaSourceProvenance
} = require('../utils/media-source-provenance');

function expectedWrite() {
  return {
    apiClientId: 'youtube-automation-agent',
    channelId: 'UC-channel-one',
    apiAction: 'videos.insert',
    capability: 'youtube.publish',
    resourceScope: 'UC-channel-one:new-video',
    authorizingUserId: 'user-123',
    payload: {
      videoMetadata: {
        snippet: { title: 'Approved title', description: 'Approved description', tags: ['one'] },
        status: { privacyStatus: 'private' }
      },
      mediaSha256: 'a'.repeat(64)
    },
    visibility: 'private'
  };
}

function consentFor(expected) {
  return {
    consentId: 'consent-123',
    status: 'approved',
    consentScope: 'single_action',
    apiClientId: expected.apiClientId,
    channelId: expected.channelId,
    apiAction: expected.apiAction,
    capability: expected.capability,
    resourceScope: expected.resourceScope,
    authorizingUserId: expected.authorizingUserId,
    approvedBy: expected.authorizingUserId,
    approvedAt: '2026-11-23T00:00:00.000Z',
    approvedPayloadHash: hashWritePayload(expected.payload),
    approvedVisibility: expected.visibility,
    revokedAt: null,
    consumedAt: null
  };
}

function mediaProvenance(sha256, overrides = {}) {
  return {
    sourceType: 'original_created',
    sourceRef: 'production:prod-001',
    creationRecordRef: 'generation-job:job-001',
    sha256,
    downloadedWithoutYouTubePriorWrittenApproval: false,
    importedWithoutYouTubePriorWrittenApproval: false,
    backedUpWithoutYouTubePriorWrittenApproval: false,
    cachedWithoutYouTubePriorWrittenApproval: false,
    storedWithoutYouTubePriorWrittenApproval: false,
    publicYouTubeUrlIsPermissionToDownload: false,
    ...overrides
  };
}

test('write payload hashing is deterministic across object key order', () => {
  assert.equal(
    hashWritePayload({ b: 2, a: { y: 1, x: 0 } }),
    hashWritePayload({ a: { x: 0, y: 1 }, b: 2 })
  );
});

test('an exact, single-action, channel-scoped consent validates', () => {
  const expected = expectedWrite();
  const validated = validateWriteActionConsent(consentFor(expected), expected, {
    now: new Date('2026-11-23T01:00:00.000Z')
  });
  assert.equal(validated.consentId, 'consent-123');
  assert.equal(validated.approvedPayloadHash, hashWritePayload(expected.payload));
});

test('changed title, description, tags, media hash, or visibility invalidates consent', () => {
  const expected = expectedWrite();
  const consent = consentFor(expected);
  for (const mutate of [
    value => { value.payload.videoMetadata.snippet.title = 'Changed title'; },
    value => { value.payload.videoMetadata.snippet.description = 'Changed description'; },
    value => { value.payload.videoMetadata.snippet.tags.push('new-tag'); },
    value => { value.payload.mediaSha256 = 'b'.repeat(64); },
    value => { value.visibility = 'public'; }
  ]) {
    const changed = structuredClone(expected);
    mutate(changed);
    assert.throws(
      () => validateWriteActionConsent(consent, changed, { now: new Date('2026-11-23T01:00:00.000Z') }),
      error => error.code === 'YOUTUBE_WRITE_ACTION_CONSENT_PAYLOAD_MISMATCH' ||
        error.code === 'YOUTUBE_WRITE_ACTION_CONSENT_VISIBILITY_MISMATCH'
    );
  }
});

test('consent cannot be reused for a different API method, channel, resource, or user', () => {
  const expected = expectedWrite();
  const consent = consentFor(expected);
  for (const field of ['apiAction', 'channelId', 'resourceScope', 'authorizingUserId', 'apiClientId']) {
    const changed = { ...expected, [field]: expected[field] + '-other' };
    assert.throws(
      () => validateWriteActionConsent(consent, changed, { now: new Date('2026-11-23T01:00:00.000Z') }),
      error => error.code.startsWith('YOUTUBE_WRITE_ACTION_CONSENT_')
    );
  }
});

test('revoked, consumed, future-dated, or non-single-action consent is rejected', () => {
  const expected = expectedWrite();
  for (const mutate of [
    consent => { consent.revokedAt = '2026-11-23T00:30:00.000Z'; },
    consent => { consent.consumedAt = '2026-11-23T00:30:00.000Z'; },
    consent => { consent.approvedAt = '2026-11-24T00:00:00.000Z'; },
    consent => { consent.consentScope = 'all_future_actions'; }
  ]) {
    const consent = consentFor(expected);
    mutate(consent);
    assert.throws(
      () => validateWriteActionConsent(consent, expected, { now: new Date('2026-11-23T01:00:00.000Z') }),
      error => error.code.startsWith('YOUTUBE_WRITE_ACTION_CONSENT_')
    );
  }
});

test('write action remains blocked without a persistent get-and-consume consent provider', async () => {
  const expected = expectedWrite();
  await assert.rejects(
    () => requireWriteActionConsent(expected),
    error => error.code === 'YOUTUBE_WRITE_ACTION_CONSENT_PROVIDER_UNAVAILABLE'
  );
});

test('write consent is atomically consumed once before a write can proceed', async () => {
  const expected = expectedWrite();
  const consent = consentFor(expected);
  let consumed = 0;
  const result = await requireWriteActionConsent({
    ...expected,
    getConsent: async () => consent,
    consumeConsent: async (id, context) => {
      assert.equal(id, consent.consentId);
      assert.equal(context.approvedPayloadHash, consent.approvedPayloadHash);
      consumed++;
      return true;
    },
    now: new Date('2026-11-23T01:00:00.000Z')
  });
  assert.equal(result.consumed, true);
  assert.equal(consumed, 1);
});

test('a consent provider that cannot atomically consume the record blocks the write', async () => {
  const expected = expectedWrite();
  await assert.rejects(
    () => requireWriteActionConsent({
      ...expected,
      getConsent: async () => consentFor(expected),
      consumeConsent: async () => false,
      now: new Date('2026-11-23T01:00:00.000Z')
    }),
    error => error.code === 'YOUTUBE_WRITE_ACTION_CONSENT_REPLAY_OR_REVOCATION'
  );
});


test('automated comment writes are not an allowed YouTube write action', () => {
  assert.equal(ACTION_CAPABILITIES['comments.insert'], undefined);
  const expected = {
    ...expectedWrite(),
    apiAction: 'comments.insert',
    capability: 'youtube.comment.reply',
    resourceScope: 'UC-channel-one:comment:comment-1',
    payload: { parentId: 'comment-1', text: 'Reply text' },
    visibility: null
  };
  assert.throws(
    () => validateWriteActionConsent(consentFor(expected), expected, {
      now: new Date('2026-11-23T01:00:00.000Z')
    }),
    error => error.code === 'YOUTUBE_WRITE_ACTION_CONSENT_INVALID'
  );
});

test('public YouTube URLs are not permission to download audiovisual content', () => {
  assert.equal(isYouTubeUrl('https://www.youtube.com/watch?v=example'), true);
  assert.equal(isYouTubeUrl('https://youtu.be/example'), true);
  const invalid = mediaProvenance('a'.repeat(64), {
    sourceType: 'user_supplied',
    sourceRef: 'https://www.youtube.com/watch?v=example',
    userConsentRef: 'user-upload:123'
  });
  assert.ok(validateMediaSourceProvenance(invalid).some(item => item.includes('public YouTube URL alone')));
});

test('YouTube audiovisual content requires prior written YouTube approval', () => {
  const invalid = mediaProvenance('a'.repeat(64), {
    sourceType: 'youtube_audiovisual_content',
    sourceRef: 'https://www.youtube.com/watch?v=example'
  });
  assert.ok(validateMediaSourceProvenance(invalid).some(item => item.includes('prior written YouTube approval')));
  const approved = mediaProvenance('a'.repeat(64), {
    sourceType: 'youtube_audiovisual_content',
    sourceRef: 'https://www.youtube.com/watch?v=example',
    youtubePriorWrittenApprovalRef: 'approval:written-authorization'
  });
  assert.deepEqual(validateMediaSourceProvenance(approved), []);
});

test('user-supplied and rights-holder media require recorded permission or license provenance', () => {
  const userSupplied = mediaProvenance('a'.repeat(64), { sourceType: 'user_supplied' });
  assert.ok(validateMediaSourceProvenance(userSupplied).some(item => item.includes('user permission reference')));
  const rightsHolder = mediaProvenance('a'.repeat(64), { sourceType: 'rights_holder_authorized' });
  assert.ok(validateMediaSourceProvenance(rightsHolder).some(item => item.includes('license or permission reference')));
});

test('source file hash must match the recorded media provenance', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-media-provenance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'source.mp4');
  fs.writeFileSync(filePath, Buffer.from('original source asset'));
  const sha256 = await hashFile(filePath);
  const valid = await verifyMediaSourceProvenance(mediaProvenance(sha256), filePath);
  assert.equal(valid.valid, true);
  fs.writeFileSync(filePath, Buffer.from('replaced asset'));
  const changed = await verifyMediaSourceProvenance(mediaProvenance(sha256), filePath);
  assert.equal(changed.valid, false);
  assert.ok(changed.blockers.some(item => item.includes('SHA-256')));
});
