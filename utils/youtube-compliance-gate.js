'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'youtube-api-client-compliance.json');

function loadYouTubeComplianceConfig(filePath = DEFAULT_CONFIG_PATH) {
  const resolved = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function getYouTubeComplianceState(config) {
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

  if (current.schemaVersion !== 1) blockers.push('compliance configuration schema version must equal 1');
  if (typeof client.id !== 'string' || !client.id.trim()) blockers.push('actual API Client identity is missing');
  if (client.boundaryStatus !== 'approved' || boundary.status !== 'approved') blockers.push('actual API Client boundary review is not approved');
  if (!Array.isArray(boundary.evidenceRefs) || boundary.evidenceRefs.length === 0) blockers.push('actual API Client boundary evidence is missing');
  if (!['yes', 'no'].includes(child.status)) blockers.push('child-directed status has not been assessed as yes or no');
  if (child.status === 'yes') blockers.push('child-directed API Clients cannot use this publishing client for YouTube write actions');
  if (!['approved', 'not_required'].includes(audit.status) || typeof audit.evidenceRef !== 'string' || !audit.evidenceRef.trim()) {
    blockers.push('required compliance audit or reasoned not-required determination is not documented');
  }

  if (client.needsCredentials === true) {
    if (typeof project.projectId !== 'string' || !project.projectId.trim()) blockers.push('exactly one API Project has not been assigned to this API Client');
    if (project.projectCountForClient !== 1) blockers.push('this API Client must map to exactly one API Project');
    if (project.ownerApiClientId !== client.id) blockers.push('API Project owner does not match this API Client');
    if (project.credentialsExclusiveToClient !== true) blockers.push('API credentials are not documented as exclusive to this API Client');
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
  if (child.status === 'no' && (!Array.isArray(child.evidenceRefs) || child.evidenceRefs.length === 0)) {
    blockers.push('a not-child-directed assessment requires supporting evidence');
  }

  return { allowed: blockers.length === 0, blockers, config: current };
}

function assertYouTubeComplianceGate(action = 'YouTube API access', options = {}) {
  const state = getYouTubeComplianceState(options.config);
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
  loadYouTubeComplianceConfig,
  getYouTubeComplianceState,
  assertYouTubeComplianceGate,
  assertMadeForKidsDeclaration
};
