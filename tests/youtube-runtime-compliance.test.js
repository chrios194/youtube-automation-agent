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

test('automated comment posting remains prohibited even if a consent provider exists', async () => {
  const service = new AudienceEngagementService({}, { hasYouTubeScope: () => true }, null, {
    getYouTubeComplianceState: () => ({ allowed: true, blockers: [] }),
    apiClientId: 'youtube-automation-agent',
    getWriteActionConsent: async () => ({ status: 'approved' }),
    consumeWriteActionConsent: async () => true,
    getAuthorizingUserId: async () => 'operator',
    insertComment: async () => { throw new Error('must never be called'); }
  });
  assert.deepEqual(service.postingEnabled(), {
    enabled: false,
    reason: 'automated_comment_posting_prohibited'
  });
  await assert.rejects(
    () => service.approveReplyDraft('draft-1', { confirmed: true }),
    error => error.status === 403 && error.code === 'AUTOMATED_ENGAGEMENT_POSTING_PROHIBITED'
  );
  await assert.rejects(
    () => service.defaultInsertComment({ parentId: 'comment-1', text: 'reply' }),
    error => error.status === 403 && error.code === 'AUTOMATED_ENGAGEMENT_POSTING_PROHIBITED'
  );
});
