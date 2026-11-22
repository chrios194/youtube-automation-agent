'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AnalyticsOptimizationAgent } = require('../agents/analytics-optimization-agent');
const { AudienceEngagementService } = require('../utils/audience-engagement-service');

test('analytics initialization does not create YouTube API clients when deployed API Data controls are unverified', async () => {
  const agent = new AnalyticsOptimizationAgent({}, {}, {
    getYouTubeComplianceState: () => ({ allowed: false, blockers: ['storage inventory not verified'] })
  });
  assert.equal(await agent.initialize(), true);
  assert.equal(agent.complianceBlocked, true);
  assert.equal(agent.youtube, null);
  assert.equal(agent.youtubeAnalytics, null);
});

test('analytics initialization does not run when the derived-metrics exception is disabled', async () => {
  const agent = new AnalyticsOptimizationAgent({}, {}, {
    getYouTubeComplianceState: () => ({ allowed: true, blockers: [] }),
    assertDerivedMetricsGate: () => {
      const error = new Error('derived metrics disabled');
      error.code = 'YOUTUBE_DERIVED_METRICS_GATE_BLOCKED';
      throw error;
    }
  });
  assert.equal(await agent.initialize(), true);
  assert.equal(agent.complianceBlocked, true);
  assert.equal(agent.youtube, null);
  assert.equal(agent.youtubeAnalytics, null);
});

test('comment collection and sentiment analysis fail closed when API Data controls are not approved', async () => {
  const service = new AudienceEngagementService({}, {}, null, {
    getYouTubeComplianceState: () => ({ allowed: false, blockers: ['API Data controls not approved'] }),
    assertYouTubeComplianceGate: action => {
      const error = new Error(action + ' blocked');
      error.code = 'YOUTUBE_COMPLIANCE_GATE_BLOCKED';
      throw error;
    },
    assertDerivedMetricsGate: action => {
      const error = new Error(action + ' blocked');
      error.code = 'YOUTUBE_DERIVED_METRICS_GATE_BLOCKED';
      throw error;
    }
  });
  await assert.rejects(
    () => service.syncVideoComments('video-1'),
    error => error.code === 'YOUTUBE_COMPLIANCE_GATE_BLOCKED'
  );
  await assert.rejects(
    () => service.analyzeVideo('video-1'),
    error => error.code === 'YOUTUBE_COMPLIANCE_GATE_BLOCKED' || error.code === 'YOUTUBE_DERIVED_METRICS_GATE_BLOCKED'
  );
  assert.equal(service.postingEnabled().enabled, false);
});

test('comment reply posting remains disabled without a one-use per-action consent provider', () => {
  const service = new AudienceEngagementService({}, { hasYouTubeScope: () => true }, null, {
    getYouTubeComplianceState: () => ({ allowed: true, blockers: [] }),
    apiClientId: 'youtube-automation-agent'
  });
  assert.deepEqual(service.postingEnabled(), {
    enabled: false,
    reason: 'per_action_user_consent_provider_unavailable'
  });
});
