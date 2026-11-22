'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const base = require('../config/youtube-api-client-compliance.json');
const {
  getYouTubeComplianceState,
  assertYouTubeComplianceGate,
  assertMadeForKidsDeclaration,
  getDerivedMetricsGateState,
  assertDerivedMetricsGate,
  REQUIRED_API_DATA_POLICY,
  REQUIRED_API_DATA_VERIFICATION
} = require('../utils/youtube-compliance-gate');

function approvedConfig() {
  const config = structuredClone(base);
  config.apiClient.boundaryStatus = 'approved';
  config.apiClient.oauthClientId = 'agenttube-oauth-client';
  config.boundaryReview.status = 'approved';
  config.childDirectedAssessment.status = 'no';
  config.childDirectedAssessment.finalStatus = 'no';
  config.childDirectedAssessment.assessmentStatus = 'final';
  config.childDirectedAssessment.assessor = 'test-reviewer';
  config.childDirectedAssessment.assessedAt = new Date().toISOString();
  config.childDirectedAssessment.intendedAudienceEvidenceRef = 'review:intended-audience';
  config.childDirectedAssessment.productSurfaceEvidenceRefs = ['review:dashboard', 'review:product-features'];
  config.childDirectedAssessment.marketingEvidenceRefs = ['review:marketing'];
  config.childDirectedAssessment.audienceEvidenceRef = 'review:audience';
  config.childDirectedAssessment.ownerAttestationStatus = 'confirmed';
  config.childDirectedAssessment.ownerAttestationEvidenceRef = 'review:owner-attestation';
  config.childDirectedAssessment.evidenceRefs = ['review:product-audience', 'review:dashboard-and-marketing'];
  config.complianceAudit.status = 'approved';
  config.complianceAudit.evidenceRef = 'audit:approved-review-2026-11-15';
  config.apiProject = {
    projectId: 'agenttube-api-project',
    oauthClientId: 'agenttube-oauth-client',
    ownerApiClientId: config.apiClient.id,
    credentialsExclusiveToClient: true,
    projectCountForClient: 1,
    crossClientUniquenessReviewStatus: 'approved',
    crossClientUniquenessEvidenceRef: 'test:cross-client-project-uniqueness'
  };
  config.controls.projectProvisioningAllowed = true;
  config.controls.credentialProvisioningAllowed = true;
  config.controls.publishingAllowed = true;
  config.oauthScopes = {
    ...config.oauthScopes,
    approved: [...config.oauthScopes.requested],
    reviewStatus: 'approved',
    reviewedBy: 'test-fixture',
    reviewedAt: '2026-11-17T00:00:00.000Z',
    evidenceRef: 'test:least-privilege-review'
  };
  config.apiDataHandling = {
    status: 'approved',
    policy: { ...REQUIRED_API_DATA_POLICY, apiDataCollectionAllowed: true, apiDataStorageAllowed: true },
    verification: {
      ...REQUIRED_API_DATA_VERIFICATION,
      deployedEnvironmentRef: 'test:production-environment',
      deployedCommitSha: 'a'.repeat(40),
      storageInventoryEvidenceRef: 'test:storage-inventory',
      retentionJobEvidenceRef: 'test:retention-job',
      analyticsReportingAuthorizationRecheckStatus: 'deployed_and_execution_verified',
      analyticsReportingAuthorizationRecheckEvidenceRef: 'test:analytics-auth-recheck',
      analyticsReportingVideoExistenceRecheckStatus: 'deployed_and_execution_verified',
      analyticsReportingVideoExistenceRecheckEvidenceRef: 'test:analytics-video-existence-recheck',
      userDeletionEvidenceRef: 'test:user-deletion',
      clientRevocationDeletionEvidenceRef: 'test:client-revocation-deletion',
      clientRevocationTokenEvidenceRef: 'test:client-token-revocation',
      googleSettingsRevocationDeletionEvidenceRef: 'test:google-settings-revocation',
      crossAccountAggregationEvidenceRef: 'test:cross-account-disabled',
      crossChannelAggregationEvidenceRef: 'test:cross-channel-disabled',
      crossContentOwnerAggregationEvidenceRef: 'test:cross-content-owner-disabled',
      verifiedAt: new Date().toISOString()
    },
    derivedMetrics: structuredClone(base.apiDataHandling.derivedMetrics)
  };
  config.apiDataAccessReview = {
    status: 'approved',
    unofficialYouTubeScrapingUsed: false,
    undocumentedYouTubeApplicationEndpointsUsed: false,
    youtubeiJsInnertubeUsed: false,
    captionsListReturnsMetadataOnly: true,
    captionsDownloadRequiresVideoEditPermission: true,
    captionsDownloadIsGeneralPublicTranscriptSource: false,
    youtubeAudiovisualContentDownloadedWithoutPriorWrittenApproval: false,
    youtubeAudiovisualContentImportedWithoutPriorWrittenApproval: false,
    youtubeAudiovisualContentBackedUpWithoutPriorWrittenApproval: false,
    youtubeAudiovisualContentCachedWithoutPriorWrittenApproval: false,
    youtubeAudiovisualContentStoredWithoutPriorWrittenApproval: false,
    assetSourceProvenanceRequired: true,
    youtubePublicUrlIsPermissionToDownload: false,
    reviewedCommitSha: 'a'.repeat(40),
    evidenceRef: 'test:youtube-data-access-method-review',
    reviewedAt: new Date().toISOString()
  };
  return config;
}

test('default AgentTube configuration blocks project, credential, and publishing actions', () => {
  const state = getYouTubeComplianceState(base);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('child-directed status')));
  assert.ok(state.blockers.some(item => item.includes('API Project')));
  assert.ok(state.blockers.some(item => item.includes('publishing is disabled')));
  assert.throws(
    () => assertYouTubeComplianceGate('OAuth setup', { config: base }),
    error => error.code === 'YOUTUBE_COMPLIANCE_GATE_BLOCKED' && error.status === 409
  );
});

test('unknown child-directed status blocks an otherwise complete project mapping', () => {
  const config = approvedConfig();
  config.childDirectedAssessment.status = 'not_assessed';
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('child-directed status')));
});

test('child-directed API Client cannot enable YouTube write actions', () => {
  const config = approvedConfig();
  config.childDirectedAssessment.status = 'yes';
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('child-directed API Clients')));
});

test('approved non-child-directed API Client requires exactly one exclusive project', () => {
  const config = approvedConfig();
  assert.equal(getYouTubeComplianceState(config).allowed, true);
  config.apiProject.projectCountForClient = 2;
  assert.ok(getYouTubeComplianceState(config).blockers.some(item => item.includes('exactly one API Project')));
});

test('central cross-client API Project uniqueness review is required', () => {
  const config = approvedConfig();
  config.apiProject.crossClientUniquenessReviewStatus = 'not_started';
  config.apiProject.crossClientUniquenessEvidenceRef = null;
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('cross-client API Project uniqueness review')));
});

test('API Project cannot be shared with or owned by another API Client', () => {
  const config = approvedConfig();
  config.apiProject.ownerApiClientId = 'different-api-client';
  assert.ok(getYouTubeComplianceState(config).blockers.some(item => item.includes('owner does not match')));
});

test('OAuth client ID must belong to the one mapped API Project', () => {
  const config = approvedConfig();
  config.apiProject.oauthClientId = 'different-oauth-client';
  assert.ok(getYouTubeComplianceState(config).blockers.some(item => item.includes('does not match')));
});

test('pending or undocumented least-privilege OAuth scope review blocks API access', () => {
  const config = approvedConfig();
  config.oauthScopes.reviewStatus = 'pending_least_privilege_review';
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('least-privilege OAuth scope review')));
});

test('requested OAuth scopes must exactly match the reviewed approved scope set', () => {
  const config = approvedConfig();
  config.oauthScopes.approved = config.oauthScopes.approved.filter(scope => !scope.endsWith('youtube.force-ssl'));
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('do not exactly match')));
});

test('duplicate or empty OAuth scopes are rejected', () => {
  const config = approvedConfig();
  config.oauthScopes.requested.push(config.oauthScopes.requested[0]);
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('non-empty, unique list')));
});

test('Made for Kids declaration must be an explicit boolean for every video', () => {
  assert.equal(assertMadeForKidsDeclaration(true), true);
  assert.equal(assertMadeForKidsDeclaration(false), false);
  for (const value of [undefined, null, 'false', 0]) {
    assert.throws(
      () => assertMadeForKidsDeclaration(value),
      error => error.code === 'MADE_FOR_KIDS_DECLARATION_REQUIRED'
    );
  }
});


test('API Data handling controls are mandatory even when the API Client project is otherwise approved', () => {
  const config = approvedConfig();
  delete config.apiDataHandling;
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('API Data handling policy and verification evidence are missing')));
});

test('API Data policy enforces 30-day refresh windows and 7/30-day deletion deadlines', () => {
  const config = approvedConfig();
  config.apiDataHandling.policy.userDeletionWithinDays = 8;
  config.apiDataHandling.policy.googleSettingsRevocationDeletionWithinDays = 31;
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('userDeletionWithinDays')));
  assert.ok(state.blockers.some(item => item.includes('googleSettingsRevocationDeletionWithinDays')));
});

test('client-initiated revocation requires immediate token revocation and deletion within seven days', () => {
  const config = approvedConfig();
  config.apiDataHandling.policy.tokenRevocationImmediateOnClientRevocation = false;
  config.apiDataHandling.verification.clientRevocationTokenStatus = 'not_verified';
  config.apiDataHandling.verification.clientRevocationDeletionStatus = 'not_verified';
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('tokenRevocationImmediateOnClientRevocation')));
  assert.ok(state.blockers.some(item => item.includes('clientRevocationDeletionStatus')));
  assert.ok(state.blockers.some(item => item.includes('clientRevocationTokenStatus')));
});

test('unverified storage inventory and retention execution block API Data access', () => {
  const config = approvedConfig();
  config.apiDataHandling.verification.storageInventoryStatus = 'not_verified';
  config.apiDataHandling.verification.retentionJobStatus = 'configured_not_executed';
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('storageInventoryStatus')));
  assert.ok(state.blockers.some(item => item.includes('retentionJobStatus')));
});

test('user deletion and Google Security Settings revocation require end-to-end evidence', () => {
  const config = approvedConfig();
  config.apiDataHandling.verification.userDeletionStatus = 'not_verified';
  config.apiDataHandling.verification.googleSettingsRevocationDeletionStatus = 'not_verified';
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('userDeletionStatus')));
  assert.ok(state.blockers.some(item => item.includes('googleSettingsRevocationDeletionStatus')));
});

test('cross-account, cross-channel, and cross-content-owner API Data aggregation each require explicit deployed disablement evidence', () => {
  const cases = [
    ['crossAccountApiDataAggregationAllowed', 'crossAccountAggregationStatus'],
    ['crossChannelApiDataAggregationAllowed', 'crossChannelAggregationStatus'],
    ['crossContentOwnerApiDataAggregationAllowed', 'crossContentOwnerAggregationStatus']
  ];
  for (const [policyField, verificationField] of cases) {
    const config = approvedConfig();
    config.apiDataHandling.policy[policyField] = true;
    config.apiDataHandling.verification[verificationField] = 'enabled';
    const state = getYouTubeComplianceState(config);
    assert.equal(state.allowed, false);
    assert.ok(state.blockers.some(item => item.includes(policyField)));
    assert.ok(state.blockers.some(item => item.includes(verificationField)));
  }
});

test('API Data deployment evidence must be fresh and cannot be future-dated', () => {
  const config = approvedConfig();
  const now = new Date();
  config.apiDataHandling.verification.verifiedAt = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const stale = getYouTubeComplianceState(config, { now });
  assert.equal(stale.allowed, false);
  assert.ok(stale.blockers.some(item => item.includes('older than the 30-day internal evidence refresh window')));

  config.apiDataHandling.verification.verifiedAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const future = getYouTubeComplianceState(config, { now });
  assert.equal(future.allowed, false);
  assert.ok(future.blockers.some(item => item.includes('timestamp is in the future')));
});

test('final child-directed assessment requires product, marketing, audience, and owner evidence', () => {
  const config = approvedConfig();
  config.childDirectedAssessment.ownerAttestationStatus = 'pending';
  config.childDirectedAssessment.productSurfaceEvidenceRefs = [];
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('final child-directed assessment')));
});

test('boundary review requires at least three source evidence references', () => {
  const config = approvedConfig();
  config.boundaryReview.evidenceRefs = ['one'];
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('at least three source evidence references')));
});


test('unofficial scraping, undocumented YouTube Application endpoints, and Innertube block API access', () => {
  for (const field of ['unofficialYouTubeScrapingUsed', 'undocumentedYouTubeApplicationEndpointsUsed', 'youtubeiJsInnertubeUsed']) {
    const config = approvedConfig();
    config.apiDataAccessReview[field] = true;
    const state = getYouTubeComplianceState(config);
    assert.equal(state.allowed, false);
    assert.ok(state.blockers.some(item => item.includes('YouTube API data-access method review is not compliant for ' + field)));
  }
});

test('YouTube API data-access method review must match the deployed commit and carry evidence', () => {
  const config = approvedConfig();
  config.apiDataAccessReview.reviewedCommitSha = 'b'.repeat(40);
  let state = getYouTubeComplianceState(config);
  assert.ok(state.blockers.some(item => item.includes('does not match the exact deployed commit')));
  config.apiDataAccessReview.reviewedCommitSha = 'a'.repeat(40);
  config.apiDataAccessReview.evidenceRef = '';
  state = getYouTubeComplianceState(config);
  assert.ok(state.blockers.some(item => item.includes('evidence is missing')));
});

test('official captions endpoints are not a general public-video transcript source', () => {
  const config = approvedConfig();
  config.apiDataAccessReview.captionsDownloadIsGeneralPublicTranscriptSource = true;
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('captionsDownloadIsGeneralPublicTranscriptSource')));
});

test('API Data collection and storage must be explicitly approved', () => {
  const config = approvedConfig();
  config.apiDataHandling.policy.apiDataCollectionAllowed = false;
  let state = getYouTubeComplianceState(config);
  assert.ok(state.blockers.includes('YouTube API Data collection is not approved'));
  config.apiDataHandling.policy.apiDataCollectionAllowed = true;
  config.apiDataHandling.policy.apiDataStorageAllowed = false;
  state = getYouTubeComplianceState(config);
  assert.ok(state.blockers.includes('YouTube API Data storage is not approved'));
});

test('Analytics/Reporting statistics exception requires active consent and 30-day auth/video rechecks', () => {
  const config = approvedConfig();
  config.apiDataHandling.policy.analyticsReportingStatisticsRetentionExceptionRequiresActiveUserConsent = false;
  config.apiDataHandling.policy.analyticsReportingVideoExistenceRecheckDays = 31;
  config.apiDataHandling.verification.analyticsReportingVideoExistenceRecheckStatus = 'not_verified';
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('analyticsReportingStatisticsRetentionExceptionRequiresActiveUserConsent')));
  assert.ok(state.blockers.some(item => item.includes('analyticsReportingVideoExistenceRecheckDays')));
  assert.ok(state.blockers.some(item => item.includes('analyticsReportingVideoExistenceRecheckStatus')));
});


test('YouTube API Data-derived metrics are disabled by default', () => {
  const config = approvedConfig();
  const state = getDerivedMetricsGateState(config.apiDataHandling);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('disabled by default')));
  assert.throws(
    () => assertDerivedMetricsGate('analytics scores', { config }),
    error => error.code === 'YOUTUBE_DERIVED_METRICS_GATE_BLOCKED'
  );
  assert.equal(getYouTubeComplianceState(config).allowed, true);
});

test('derived metrics require the current amendment, Analytics & Reporting audit, standard quota extension, and specific storage approval', () => {
  const config = approvedConfig();
  config.apiDataHandling.derivedMetrics.enabled = true;
  config.apiDataHandling.derivedMetrics.exceptionEnabled = true;
  const blocked = getDerivedMetricsGateState(config.apiDataHandling);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blockers.some(item => item.includes('amendment')));
  assert.ok(blocked.blockers.some(item => item.includes('Analytics & Reporting')));
  assert.ok(blocked.blockers.some(item => item.includes('compliance audit')));
  assert.ok(blocked.blockers.some(item => item.includes('standard quota extension')));
  assert.ok(blocked.blockers.some(item => item.includes('approved metric allowlist')));
});

test('only a fully evidenced, allowlisted derived-metrics exception can pass and storage cannot exceed 36 months', () => {
  const config = approvedConfig();
  Object.assign(config.apiDataHandling.derivedMetrics, {
    enabled: true,
    exceptionEnabled: true,
    additionalPoliciesAmendmentAccepted: true,
    useCase: 'Analytics & Reporting',
    auditStatus: 'approved',
    auditEvidenceRef: 'audit:analytics-reporting',
    standardQuotaExtensionStatus: 'approved',
    standardQuotaExtensionEvidenceRef: 'quota:approved-specific-metrics',
    approvedMetricNames: ['approved_metric_a', 'approved_metric_b'],
    approvedStorageUseRef: 'storage:approved-use',
    distinguishFromRawApiData: true,
    maxStorageMonths: 36,
    crossChannelAggregationAllowed: false,
    crossContentOwnerAggregationAllowed: false,
    centralLeaderboardApiDataAllowed: false
  });
  const state = getDerivedMetricsGateState(config.apiDataHandling);
  assert.equal(state.allowed, true);
  assert.equal(assertDerivedMetricsGate('approved metrics', { config }).allowed, true);
  config.apiDataHandling.derivedMetrics.maxStorageMonths = 37;
  const overLimit = getDerivedMetricsGateState(config.apiDataHandling);
  assert.equal(overLimit.allowed, false);
  assert.ok(overLimit.blockers.some(item => item.includes('no more than 36 calendar months')));
});

test('central leaderboards can use only independently generated non-YouTube operational metrics', () => {
  const config = approvedConfig();
  config.apiDataHandling.policy.centralLeaderboardApiDataAllowed = true;
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('centralLeaderboardApiDataAllowed')));
  const wrongSource = approvedConfig();
  wrongSource.apiDataHandling.policy.centralLeaderboardSource = 'youtube_api_data';
  assert.equal(getYouTubeComplianceState(wrongSource).allowed, false);
});

test('YouTube audiovisual copies, undocumented sources, and missing media provenance block API access', () => {
  for (const field of [
    'youtubeAudiovisualContentDownloadedWithoutPriorWrittenApproval',
    'youtubeAudiovisualContentImportedWithoutPriorWrittenApproval',
    'youtubeAudiovisualContentBackedUpWithoutPriorWrittenApproval',
    'youtubeAudiovisualContentCachedWithoutPriorWrittenApproval',
    'youtubeAudiovisualContentStoredWithoutPriorWrittenApproval'
  ]) {
    const config = approvedConfig();
    config.apiDataAccessReview[field] = true;
    assert.ok(getYouTubeComplianceState(config).blockers.some(item => item.includes(field)));
  }
  const config = approvedConfig();
  config.apiDataAccessReview.assetSourceProvenanceRequired = false;
  assert.ok(getYouTubeComplianceState(config).blockers.some(item => item.includes('assetSourceProvenanceRequired')));
});

test('per-action consent, user-controlled submitted values, and no automated engagement are mandatory', () => {
  const config = approvedConfig();
  config.controls.writeActionConsentRequiredPerApiAction = false;
  config.controls.finalSubmittedValuesUserControlled = false;
  config.controls.automatedEngagementManipulationAllowed = true;
  const state = getYouTubeComplianceState(config);
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.some(item => item.includes('prior specific express user consent')));
  assert.ok(state.blockers.some(item => item.includes('final control')));
  assert.ok(state.blockers.some(item => item.includes('engagement manipulation')));
});
