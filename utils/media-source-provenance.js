'use strict';

const crypto = require('crypto');
const fs = require('fs');

const ALLOWED_SOURCE_TYPES = new Set([
  'original_created',
  'user_supplied',
  'rights_holder_authorized',
  'youtube_audiovisual_content'
]);

function isYouTubeUrl(value) {
  if (typeof value !== 'string') return false;
  return /(?:^|\.)youtube\.com(?:\/|$)|(?:^|\.)youtu\.be(?:\/|$)/i.test(value);
}

function validateMediaSourceProvenance(provenance) {
  const blockers = [];
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return ['media source provenance record is missing'];
  }
  if (!ALLOWED_SOURCE_TYPES.has(provenance.sourceType)) {
    blockers.push('media source type must be original_created, user_supplied, rights_holder_authorized, or explicitly approved YouTube audiovisual content');
  }
  if (typeof provenance.sourceRef !== 'string' || !provenance.sourceRef.trim()) {
    blockers.push('media source reference is missing');
  }
  if (typeof provenance.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(provenance.sha256)) {
    blockers.push('media source requires a SHA-256 file hash');
  }
  for (const field of [
    'downloadedWithoutYouTubePriorWrittenApproval',
    'importedWithoutYouTubePriorWrittenApproval',
    'backedUpWithoutYouTubePriorWrittenApproval',
    'cachedWithoutYouTubePriorWrittenApproval',
    'storedWithoutYouTubePriorWrittenApproval'
  ]) {
    if (provenance[field] !== false) blockers.push(field + ' must be explicitly false');
  }
  if (provenance.publicYouTubeUrlIsPermissionToDownload !== false) {
    blockers.push('a public YouTube URL is not permission to download or repurpose audiovisual content');
  }
  if (provenance.sourceType === 'original_created' &&
      (typeof provenance.creationRecordRef !== 'string' || !provenance.creationRecordRef.trim())) {
    blockers.push('originally created media requires a creation-record reference');
  }
  if (provenance.sourceType === 'user_supplied' &&
      (typeof provenance.userConsentRef !== 'string' || !provenance.userConsentRef.trim())) {
    blockers.push('user-supplied media requires a recorded user permission reference');
  }
  if (provenance.sourceType === 'rights_holder_authorized' &&
      (typeof provenance.licenseOrPermissionRef !== 'string' || !provenance.licenseOrPermissionRef.trim())) {
    blockers.push('rights-holder media requires a license or permission reference');
  }
  if (provenance.sourceType === 'youtube_audiovisual_content' &&
      (typeof provenance.youtubePriorWrittenApprovalRef !== 'string' || !provenance.youtubePriorWrittenApprovalRef.trim())) {
    blockers.push('YouTube audiovisual content requires prior written YouTube approval');
  }
  if (isYouTubeUrl(provenance.sourceRef) &&
      (provenance.sourceType !== 'youtube_audiovisual_content' ||
       typeof provenance.youtubePriorWrittenApprovalRef !== 'string' ||
       !provenance.youtubePriorWrittenApprovalRef.trim())) {
    blockers.push('a public YouTube URL alone cannot establish rights or authorize media retrieval');
  }
  return blockers;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      reject(new Error('media file path is required'));
      return;
    }
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyMediaSourceProvenance(provenance, filePath) {
  const blockers = validateMediaSourceProvenance(provenance);
  if (blockers.length) return { valid: false, blockers, sha256: null };
  let actualHash;
  try {
    actualHash = await hashFile(filePath);
  } catch (error) {
    return { valid: false, blockers: ['media file could not be hashed: ' + error.message], sha256: null };
  }
  if (actualHash !== provenance.sha256.toLowerCase()) {
    return {
      valid: false,
      blockers: ['media file SHA-256 does not match the recorded source provenance'],
      sha256: actualHash
    };
  }
  return { valid: true, blockers: [], sha256: actualHash };
}

module.exports = {
  ALLOWED_SOURCE_TYPES,
  isYouTubeUrl,
  validateMediaSourceProvenance,
  hashFile,
  verifyMediaSourceProvenance
};
