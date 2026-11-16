'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const base = require('../config/youtube-api-client-compliance.json');
const {
  getYouTubeComplianceState,
  assertYouTubeComplianceGate,
  assertMadeForKidsDeclaration
} = require('../utils/youtube-compliance-gate');

function approvedConfig() {
  const config = structuredClone(base);
  config.apiClient.boundaryStatus = 'approved';
  config.apiClient.oauthClientId = 'agenttube-oauth-client';
  config.boundaryReview.status = 'approved';
  config.childDirectedAssessment.status = 'no';
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
