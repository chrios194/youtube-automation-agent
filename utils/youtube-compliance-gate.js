'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'youtube-api-client-compliance.json');

const REQUIRED_API_DATA_POLICY = Object.freeze({
  otherAuthorizedApiDataMaxStorageDays: 30,
  nonAuthorizedApiDataMaxStorageDays: 30,
  analyticsReportingAuthorizationRecheckDays: 30,
  analyticsReportingVideoExistenceRecheckDays: 30,
  analyticsReportingStatisticsRetentionExceptionRequiresActiveUserConsent: true,
  authorizedAnalyticsReportingDataStorage: 'as_needed_with_30_day_authorization_and_video_existence_recheck',
  userDeletionWithinDays: 7,
  clientRevocationDeletionWithinDays: 7,
  googleSettingsRevocationDeletionWithinDays: 30,
  tokenRevocationImmediateOnClientRevocation: true,
  userDeletionRequestMechanismRequired: true,
  authorizedDataVisibilityScope: 'authorizing_user_and_user_approved_agents_only',
  crossAccountApiDataAggregationAllowed: false,
  crossContentOwnerApiDataAggregationAllowed: false,
  derivedMetricsFromApiDataAllowedWithoutExplicitAuditPermission: false,
  unofficialYouTubeScrapingAllowed: false,
  undocumentedYouTubeApplicationEndpointsAllowed: false,
  youtubeiJsInnertubeAllowed: false,
  captionsListReturnsMetadataOnly: true,
  captionsDownloadRequiresVideoEditPermission: true,
  captionsDownloadIsGeneralPublicTranscriptSource: false,
  analyticsReportingAuthorizationRecheckExecutionRequired: true,
  analyticsReportingVideoExistenceRecheckExecutionRequired: true,
  clientRevocationDeletionEndToEndVerificationRequired: true,
  clientRevocationTokenImmediateVerificationRequired: true
});

const REQUIRED_API_DATA_VERIFICATION = Object.freeze({
  storageInventoryStatus: 'verified',
  retentionJobStatus: 'deployed_and_execution_verified',
  analyticsReportingAuthorizationRecheckStatus: 'deployed_and_execution_verified',
  analyticsReportingVideoExistenceRecheckStatus: 'deployed_and_execution_verified',
  userDeletionStatus: 'end_to_end_verified',
  clientRevocationDeletionStatus: 'end_to_end_verified',
  clientRevocationTokenStatus: 'immediate_revocation_verified',
  googleSettingsRevocationDeletionStatus: 'end_to_end_verified',
  crossAccountAggregationStatus: 'verified_disabled'
});

const REQUIRED_API_DATA_EVIDENCE = Object.freeze([
  'deployedEnvironmentRef',
  'deployedCommitSha',
  'storageInventoryEvidenceRef',
  'retentionJobEvidenceRef',
  'analyticsReportingAuthorizationRecheckEvidenceRef',
  'analyticsReportingVideoExistenceRecheckEvidenceRef',
  'userDeletionEvidenceRef',
  'clientRevocationDeletionEvidenceRef',
  'clientRevocationTokenEvidenceRef',
  'googleSettingsRevocationDeletionEvidenceRef',
  'crossAccountAggregationEvidenceRef',
  'verifiedAt'
]);

function getApiDataHandlingBlockers(apiDataHandling, now = new Date()) {
  if (!apiDataHandling || typeof apiDataHandling !== 'object' || Array.isArray(apiDataHandling)) {
    return ['deployed API Data handling policy and verification evidence are missing'];
  }

  const blockers = [];
  if (apiDataHandling.status !== 'approved') {
    blockers.push('API Data handling controls are not approved');
  }

  const policy = apiDataHandling.policy || {};
  for (const [field, expected] of Object.entries(REQUIRED_API_DATA_POLICY)) {
    if (policy[field] !== expected) blockers.push('API Data handling policy is not compliant for ' + field);
  }
  if (policy.apiDataCollectionAllowed !== true) blockers.push('YouTube API Data collection is not approved');
  if (policy.apiDataStorageAllowed !== true) blockers.push('YouTube API Data storage is not approved');

  const verification = apiDataHandling.verification;
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) {
    blockers.push('deployed API Data handling verification evidence is missing');
    return blockers;
  }

  for (const [field, expected] of Object.entries(REQUIRED_API_DATA_VERIFICATION)) {
    if (verification[field] !== expected) {
      blockers.push('API Data deployment verification is incomplete for ' + field);
    }
  }
  for (const field of REQUIRED_API_DATA_EVIDENCE) {
    if (typeof verification[field] !== 'string' || !verification[field].trim()) {
      blockers.push('API Data deployment verification evidence is missing for ' + field);
    }
  }

  if (typeof verification.deployedCommitSha !== 'string' || !/^[a-f0-9]{40}$/.test(verification.deployedCommitSha)) {
    blockers.push('API Data verification requires the exact deployed 40-character commit SHA');
  }

  const verifiedAt = verification.verifiedAt;
  if (typeof verifiedAt !== 'string' ||
      !Number.isFinite(Date.parse(verifiedAt)) ||
      !(verifiedAt.endsWith('Z') || /[+-][0-9]{2}:[0-9]{2}$/.test(verifiedAt))) {
    blockers.push('API Data verification requires a timezone-qualified timestamp');
  } else {
    const verifiedAtMs = Date.parse(verifiedAt);
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!Number.isFinite(nowMs)) {
      blockers.push('API Data verification clock is invalid');
    } else if (verifiedAtMs > nowMs + 60_000) {
      blockers.push('API Data verification timestamp is in the future');
    } else if (nowMs - verifiedAtMs > 30 * 24 * 60 * 60 * 1000) {
      blockers.push('API Data verification is older than the 30-day internal evidence refresh window');
    }
  }

  return blockers;
}

function loadYouTubeComplianceConfig(filePath = DEFAULT_CONFIG_PATH) {
  const resolved = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function getYouTubeComplianceState(config, options = {}) {
  const now = options.now || new Date();
  const blockers = [];
  let current = config;

  if (!current) {
    try {
      current = loadYouTubeComplianceConfig();
    } catch (error) {
      return {
        allowed: false,
        blockers: ['compliance configuration is missing or invalid: ' + error.message],
        config: null
      };
    }
  }

  const client = current.apiClient || {};
  const boundary = current.boundaryReview || {};
  const child = current.childDirectedAssessment || {};
  const audit = current.complianceAudit || {};
  const project = current.apiProject || {};
  const controls = current.controls || {};
  const namespaces = current.tokenNamespaces || {};
  const oauthScopes = current.oauthScopes || {};

  if (current.schemaVersion !== 1) blockers.push('compliance configuration schema version must equal 1');
  if (typeof client.id !== 'string' || !client.id.trim()) blockers.push('actual API Client identity is missing');
  if (client.boundaryStatus !== 'approved' || boundary.status !== 'approved') blockers.push('actual API Client boundary review is not approved');
  if (!Array.isArray(boundary.evidenceRefs) || boundary.evidenceRefs.filter(value => typeof value === 'string' && value.trim()).length < 3) {
    blockers.push('actual API Client boundary review requires at least three source evidence references');
  }
  const timezoneQualified = value =>
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    (value.endsWith('Z') || /[+-][0-9]{2}:[0-9]{2}$/.test(value));
  const hasRefs = (value, minimum) =>
    Array.isArray(value) && value.filter(item => typeof item === 'string' && item.trim()).length >= minimum;
  if (!['yes', 'no'].includes(child.status)) blockers.push('child-directed status has not been assessed as yes or no');
  if (child.assessmentStatus !== 'final' ||
      child.finalStatus !== child.status ||
      typeof child.assessor !== 'string' || !child.assessor.trim() ||
      !timezoneQualified(child.assessedAt) ||
      typeof child.intendedAudienceEvidenceRef !== 'string' || !child.intendedAudienceEvidenceRef.trim() ||
      !hasRefs(child.productSurfaceEvidenceRefs, 2) ||
      !hasRefs(child.marketingEvidenceRefs, 1) ||
      typeof child.audienceEvidenceRef !== 'string' || !child.audienceEvidenceRef.trim() ||
      child.ownerAttestationStatus !== 'confirmed' ||
      typeof child.ownerAttestationEvidenceRef !== 'string' || !child.ownerAttestationEvidenceRef.trim()) {
    blockers.push('final child-directed assessment requires product, marketing, audience, and owner-attestation evidence');
  }
  if (child.status === 'yes') blockers.push('child-directed API Clients cannot use this publishing client for YouTube write actions');
  if (!['approved', 'not_required'].includes(audit.status) || typeof audit.evidenceRef !== 'string' || !audit.evidenceRef.trim()) {
    blockers.push('required compliance audit or reasoned not-required determination is not documented');
  }
  blockers.push(...getApiDataHandlingBlockers(current.apiDataHandling, now));
  const dataAccessReview = current.apiDataAccessReview || {};
  if (dataAccessReview.status !== 'approved') blockers.push('YouTube API data-access method review is not approved');
  for (const [field, expected] of Object.entries({
    unofficialYouTubeScrapingUsed: false,
    undocumentedYouTubeApplicationEndpointsUsed: false,
    youtubeiJsInnertubeUsed: false,
    captionsListReturnsMetadataOnly: true,
    captionsDownloadRequiresVideoEditPermission: true,
    captionsDownloadIsGeneralPublicTranscriptSource: false
  })) {
    if (dataAccessReview[field] !== expected) blockers.push('YouTube API data-access method review is not compliant for ' + field);
  }
  if (typeof dataAccessReview.evidenceRef !== 'string' || !dataAccessReview.evidenceRef.trim()) blockers.push('YouTube API data-access method review evidence is missing');
  if (dataAccessReview.reviewedCommitSha !== current.apiDataHandling?.verification?.deployedCommitSha) blockers.push('YouTube API data-access method review does not match the exact deployed commit');
  if (!timezoneQualified(dataAccessReview.reviewedAt)) blockers.push('YouTube API data-access method review requires a timezone-qualified timestamp');

  if (client.needsCredentials === true) {
    if (typeof project.projectId !== 'string' || !project.projectId.trim()) blockers.push('exactly one API Project has not been assigned to this API Client');
    if (project.projectCountForClient !== 1) blockers.push('this API Client must map to exactly one API Project');
    if (project.ownerApiClientId !== client.id) blockers.push('API Project owner does not match this API Client');
    if (project.credentialsExclusiveToClient !== true) blockers.push('API credentials are not documented as exclusive to this API Client');
    if (project.crossClientUniquenessReviewStatus !== 'approved' ||
        typeof project.crossClientUniquenessEvidenceRef !== 'string' || !project.crossClientUniquenessEvidenceRef.trim()) {
      blockers.push('central cross-client API Project uniqueness review is not approved with evidence');
    }
    if (typeof project.oauthClientId !== 'string' || !project.oauthClientId.trim()) blockers.push('approved OAuth client ID is missing from the API Project mapping');
    if (client.oauthClientId !== project.oauthClientId) blockers.push('API Client OAuth client ID does not match its exclusive API Project');
  } else if (client.needsCredentials === false) {
    if (project.projectId !== null || project.projectCountForClient !== 0) blockers.push('an API Client that does not need credentials must not have an API Project');
  } else {
    blockers.push('API Client credential requirement must be explicit');
  }

  if (controls.projectProvisioningAllowed !== true) blockers.push('API Project provisioning is disabled');
  if (controls.credentialProvisioningAllowed !== true) blockers.push('OAuth credential provisioning is disabled');
  if (controls.publishingAllowed !== true) blockers.push('YouTube publishing is disabled');
  if (controls.quotaShardingAllowed !== false) blockers.push('quota sharding or project multiplication is not explicitly prohibited');
  if (controls.perChannelProjectCreationAllowed !== false) blockers.push('per-channel API Project creation is not explicitly prohibited');
  if (controls.madeForKidsDeclarationRequiredPerVideo !== true) blockers.push('per-video Made for Kids declaration is not required');
  if (typeof namespaces.pattern !== 'string' || !namespaces.pattern.includes('<accountId>') || namespaces.perAccountIsolated !== true || namespaces.crossAccountTokenReuseAllowed !== false || namespaces.apiProjectCountIndependent !== true) {
    blockers.push('per-account OAuth token isolation is not documented independently of API Project count');
  }
  const requestedScopes = Array.isArray(oauthScopes.requested) ? oauthScopes.requested : [];
  const approvedScopes = Array.isArray(oauthScopes.approved) ? oauthScopes.approved : [];
  const validScopeList = list => list.length > 0 &&
    list.every(scope => typeof scope === 'string' &&
      scope.startsWith('https://www.googleapis.com/auth/') &&
      !/\s/.test(scope)) &&
    new Set(list).size === list.length;
  if (!validScopeList(requestedScopes)) blockers.push('requested OAuth scopes must be a non-empty, unique list of valid Google API scopes');
  if (!validScopeList(approvedScopes)) blockers.push('approved OAuth scopes must be a non-empty, unique list of valid Google API scopes');
  if (oauthScopes.reviewStatus !== 'approved' ||
      typeof oauthScopes.reviewedBy !== 'string' || !oauthScopes.reviewedBy.trim() ||
      !Number.isFinite(new Date(oauthScopes.reviewedAt).getTime()) ||
      typeof oauthScopes.evidenceRef !== 'string' || !oauthScopes.evidenceRef.trim()) {
    blockers.push('least-privilege OAuth scope review is not approved with reviewer, date, and evidence');
  }
  if (validScopeList(requestedScopes) && validScopeList(approvedScopes) &&
      JSON.stringify([...requestedScopes].sort()) !== JSON.stringify([...approvedScopes].sort())) {
    blockers.push('requested OAuth scopes do not exactly match the reviewed approved scope set');
  }

  if (child.status === 'no' && (!Array.isArray(child.evidenceRefs) || child.evidenceRefs.length === 0)) {
    blockers.push('a not-child-directed assessment requires supporting evidence');
  }

  return { allowed: blockers.length === 0, blockers, config: current };
}

function assertYouTubeComplianceGate(action = 'YouTube API access', options = {}) {
  const state = getYouTubeComplianceState(options.config, { now: options.now });
  if (!state.allowed) {
    const error = new Error(action + ' is blocked by the YouTube API Client compliance gate: ' + state.blockers.join('; '));
    error.status = 409;
    error.code = 'YOUTUBE_COMPLIANCE_GATE_BLOCKED';
    error.blockers = state.blockers;
    throw error;
  }
  return state;
}

function assertMadeForKidsDeclaration(value) {
  if (typeof value !== 'boolean') {
    const error = new Error('Select whether this individual video is Made for Kids before approval or upload');
    error.status = 409;
    error.code = 'MADE_FOR_KIDS_DECLARATION_REQUIRED';
    throw error;
  }
  return value;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  REQUIRED_API_DATA_POLICY,
  REQUIRED_API_DATA_VERIFICATION,
  REQUIRED_API_DATA_EVIDENCE,
  getApiDataHandlingBlockers,
  loadYouTubeComplianceConfig,
  getYouTubeComplianceState,
  assertYouTubeComplianceGate,
  assertMadeForKidsDeclaration
};
