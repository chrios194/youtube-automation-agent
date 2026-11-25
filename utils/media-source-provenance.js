'use strict';

const crypto = require('crypto');
const fs = require('fs');

const ALLOWED_SOURCE_TYPES = new Set([
  'original_created',
  'user_supplied',
  'rights_holder_authorized',
  'youtube_audiovisual_content'
]);
const ACQUISITION_METHOD_BY_SOURCE_TYPE = Object.freeze({
  original_created: 'original_creation',
  user_supplied: 'user_upload',
  rights_holder_authorized: 'rights_holder_delivery',
  youtube_audiovisual_content: 'youtube_approved_transfer'
});
const ALLOWED_ACQUISITION_METHODS = new Set(Object.values(ACQUISITION_METHOD_BY_SOURCE_TYPE));
const FORBIDDEN_ACQUISITION_METHODS = new Set([
  'yt_dlp',
  'browser_extraction',
  'youtubei_js',
  'innertube',
  'undocumented_endpoint',
  'unofficial_transcript_service',
  'scraping',
  'youtube_download',
  'public_url_download'
]);

function isYouTubeUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'youtube.com' || host.endsWith('.youtube.com') ||
      host === 'youtu.be' || host.endsWith('.youtu.be');
  } catch (_error) {
    return false;
  }
}

function validateMediaSourceProvenance(provenance) {
  const blockers = [];
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return ['media source provenance record is missing'];
  }
  if (!ALLOWED_SOURCE_TYPES.has(provenance.sourceType)) {
    blockers.push('media source type must be original_created, user_supplied, rights_holder_authorized, or explicitly approved YouTube audiovisual content');
  }
  if (typeof provenance.acquisitionMethod !== 'string' ||
      !ALLOWED_ACQUISITION_METHODS.has(provenance.acquisitionMethod) ||
      FORBIDDEN_ACQUISITION_METHODS.has(provenance.acquisitionMethod)) {
    blockers.push('an explicit authorized acquisition method is required; yt-dlp, browser extraction, youtubei.js/Innertube, undocumented endpoints, unofficial transcript services, and scraping are prohibited');
  } else if (provenance.sourceType && ACQUISITION_METHOD_BY_SOURCE_TYPE[provenance.sourceType] !== provenance.acquisitionMethod) {
    blockers.push('acquisition method does not match the declared audiovisual source type');
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
  if (provenance.sourceType === 'user_supplied') {
    if (typeof provenance.userConsentRef !== 'string' || !provenance.userConsentRef.trim()) {
      blockers.push('user-supplied media requires a recorded user permission reference');
    }
    if (typeof provenance.licenseOrPermissionRef !== 'string' || !provenance.licenseOrPermissionRef.trim()) {
      blockers.push('user-supplied media requires ownership or license provenance');
    }
  }
  if (provenance.sourceType === 'rights_holder_authorized') {
    if (typeof provenance.licenseOrPermissionRef !== 'string' || !provenance.licenseOrPermissionRef.trim()) {
      blockers.push('rights-holder media requires a license or permission reference');
    }
    if (typeof provenance.rightsHolderAuthorizationRef !== 'string' || !provenance.rightsHolderAuthorizationRef.trim()) {
      blockers.push('rights-holder media requires a rights-holder authorization reference');
    }
  }
  if (provenance.sourceType === 'youtube_audiovisual_content') {
    if (provenance.acquisitionMethod !== 'youtube_approved_transfer') {
      blockers.push('YouTube audiovisual content may only use an explicitly approved transfer method');
    }
    if (typeof provenance.youtubePriorWrittenApprovalRef !== 'string' || !provenance.youtubePriorWrittenApprovalRef.trim()) {
      blockers.push('YouTube audiovisual content requires prior written YouTube approval');
    }
    if (typeof provenance.licenseOrPermissionRef !== 'string' || !provenance.licenseOrPermissionRef.trim()) {
      blockers.push('YouTube audiovisual content also requires source-owner license or permission provenance');
    }
  }
  if (isYouTubeUrl(provenance.sourceRef) &&
      (provenance.sourceType !== 'youtube_audiovisual_content' ||
       provenance.acquisitionMethod !== 'youtube_approved_transfer' ||
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
  ALLOWED_ACQUISITION_METHODS,
  FORBIDDEN_ACQUISITION_METHODS,
  isYouTubeUrl,
  validateMediaSourceProvenance,
  hashFile,
  verifyMediaSourceProvenance
};
