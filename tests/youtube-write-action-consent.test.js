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
const { PublishingSchedulingAgent } = require('../agents/publishing-scheduling-agent');
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
    singleUse: true,
    persisted: true,
    storageDurable: true,
    storageChannelId: expected.channelId,
    storageEvidenceRef: 'test:durable-channel-local-consent-store',
    finalValuesLocked: true,
    renewedConsentRequiredForChanges: true,
    userControlsFinalValues: true,
    apiClientId: expected.apiClientId,
    channelId: expected.channelId,
    apiAction: expected.apiAction,
    capability: expected.capability,
    resourceScope: expected.resourceScope,
    authorizingUserId: expected.authorizingUserId,
    approvedBy: expected.authorizingUserId,
    approvedAt: '2026-11-23T00:00:00.000Z',
    expiresAt: '2026-11-25T00:00:00.000Z',
    approvedPayloadHash: hashWritePayload(expected.payload),
    approvedVisibility: expected.visibility,
    revokedAt: null,
    consumedAt: null
  };
}

function mediaProvenance(sha256, overrides = {}) {
  const sourceType = overrides.sourceType || 'original_created';
  const methodByType = {
    original_created: 'original_creation',
    user_supplied: 'user_upload',
    rights_holder_authorized: 'rights_holder_delivery',
    youtube_audiovisual_content: 'youtube_approved_transfer'
  };
  return {
    sourceType,
    acquisitionMethod: methodByType[sourceType],
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
    consent => { consent.consentScope = 'all_future_actions'; },
    consent => { consent.singleUse = false; },
    consent => { consent.persisted = false; },
    consent => { consent.storageDurable = false; },
    consent => { consent.finalValuesLocked = false; },
    consent => { consent.renewedConsentRequiredForChanges = false; },
    consent => { consent.userControlsFinalValues = false; },
    consent => { consent.expiresAt = '2026-11-23T00:00:00.000Z'; }
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
  const getConsent = async () => consent;
  getConsent.durable = true;
  getConsent.channelId = expected.channelId;
  const consumeConsent = async (id, context) => {
    assert.equal(id, consent.consentId);
    assert.equal(context.approvedPayloadHash, consent.approvedPayloadHash);
    consumed++;
    return true;
  };
  consumeConsent.atomic = true;
  consumeConsent.channelId = expected.channelId;
  const result = await requireWriteActionConsent({
    ...expected,
    getConsent,
    consumeConsent,
    now: new Date('2026-11-23T01:00:00.000Z')
  });
  assert.equal(result.consumed, true);
  assert.equal(consumed, 1);
});

test('a consent provider that cannot atomically consume the record blocks the write', async () => {
  const expected = expectedWrite();
  const getConsent = async () => consentFor(expected);
  getConsent.durable = true;
  getConsent.channelId = expected.channelId;
  const consumeConsent = async () => false;
  consumeConsent.atomic = true;
  consumeConsent.channelId = expected.channelId;
  await assert.rejects(
    () => requireWriteActionConsent({
      ...expected, getConsent, consumeConsent,
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

test('each packaging write consumes its exact consent immediately before that adapter dispatch', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-write-dispatch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const thumbnailPath = path.join(directory, 'thumbnail.jpg');
  fs.writeFileSync(thumbnailPath, Buffer.from('approved original thumbnail'));
  const sha256 = await hashFile(thumbnailPath);
  const events = [];
  const agent = Object.create(PublishingSchedulingAgent.prototype);
  agent.assertYouTubeComplianceGate = () => ({ allowed: true, blockers: [] });
  agent.channelId = 'UC-channel-one';
  agent.logger = { info: () => {} };
  agent.requireWriteActionConsent = async apiAction => {
    events.push('consent:' + apiAction);
    return { consumed: true };
  };
  agent.youtube = {
    videos: {
      list: async () => {
        events.push('read:videos.list');
        return { data: { items: [{ snippet: { description: 'Existing description', tags: ['existing'], categoryId: '22' } }] } };
      },
      update: async () => { events.push('dispatch:videos.update'); }
    },
    thumbnails: {
      set: async () => { events.push('dispatch:thumbnails.set'); }
    }
  };

  await agent.applyVideoPackaging('video-1', {
    title: 'Approved replacement title',
    thumbnailPath,
    thumbnailMediaProvenance: mediaProvenance(sha256)
  });

  assert.deepEqual(events, [
    'read:videos.list',
    'consent:videos.update',
    'dispatch:videos.update',
    'consent:thumbnails.set',
    'dispatch:thumbnails.set'
  ]);
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
    youtubePriorWrittenApprovalRef: 'approval:written-authorization',
    licenseOrPermissionRef: 'license:rights-holder-authorization'
  });
  assert.deepEqual(validateMediaSourceProvenance(approved), []);
});

test('user-supplied and rights-holder media require recorded permission or license provenance', () => {
  const userSupplied = mediaProvenance('a'.repeat(64), {
    sourceType: 'user_supplied', licenseOrPermissionRef: 'license:user-owned-file'
  });
  assert.ok(validateMediaSourceProvenance(userSupplied).some(item => item.includes('user permission reference')));
  const rightsHolder = mediaProvenance('a'.repeat(64), {
    sourceType: 'rights_holder_authorized', rightsHolderAuthorizationRef: 'authorization:holder'
  });
  assert.ok(validateMediaSourceProvenance(rightsHolder).some(item => item.includes('license or permission reference')));
  const validUserSupplied = mediaProvenance('a'.repeat(64), {
    sourceType: 'user_supplied', userConsentRef: 'user-upload:123',
    licenseOrPermissionRef: 'license:user-owned-file'
  });
  assert.deepEqual(validateMediaSourceProvenance(validUserSupplied), []);
  const validRightsHolder = mediaProvenance('a'.repeat(64), {
    sourceType: 'rights_holder_authorized',
    rightsHolderAuthorizationRef: 'authorization:holder',
    licenseOrPermissionRef: 'license:holder'
  });
  assert.deepEqual(validateMediaSourceProvenance(validRightsHolder), []);
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


test('acquisition method is explicit and must match the declared source type', () => {
  const missing = mediaProvenance('a'.repeat(64), { acquisitionMethod: undefined });
  assert.ok(validateMediaSourceProvenance(missing).some(item => item.includes('explicit authorized acquisition method')));
  const mismatch = mediaProvenance('a'.repeat(64), { acquisitionMethod: 'user_upload' });
  assert.ok(validateMediaSourceProvenance(mismatch).some(item => item.includes('does not match the declared audiovisual source type')));
});

test('unofficial acquisition methods are always rejected, even when a YouTube approval reference is present', () => {
  for (const acquisitionMethod of [
    'yt_dlp', 'browser_extraction', 'youtubei_js', 'innertube',
    'undocumented_endpoint', 'unofficial_transcript_service', 'scraping',
    'youtube_download', 'public_url_download'
  ]) {
    const provenance = mediaProvenance('a'.repeat(64), {
      sourceType: 'youtube_audiovisual_content',
      sourceRef: 'https://www.youtube.com/watch?v=example',
      acquisitionMethod,
      youtubePriorWrittenApprovalRef: 'approval:written-authorization',
      licenseOrPermissionRef: 'license:rights-holder-authorization'
    });
    assert.ok(validateMediaSourceProvenance(provenance).some(item => item.includes('prohibited')));
  }
});

test('upload stream is prepared before consent and atomic consent is immediately before videos.insert', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'agents', 'publishing-scheduling-agent.js'), 'utf8');
  const start = source.indexOf('async uploadToYouTube(scheduleEntry)');
  const end = source.indexOf('async isNarrationReady', start);
  const method = source.slice(start, end);
  assert.match(method, /const videoStream = await this\.getVideoStream\(metadata\.video\.path\);[\s\S]*?await this\.requireWriteActionConsent\([\s\S]*?\);[\s\S]*?scheduleEntry\.uploadAttempted = true;\s*const videoUpload = await this\.youtube\.videos\.insert/);
});
