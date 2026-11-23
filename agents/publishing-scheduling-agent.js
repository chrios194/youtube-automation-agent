const { google } = require('googleapis');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { Logger } = require('../utils/logger');
const { assertValidYouTubeMetadata } = require('../utils/youtube-metadata-validator');
const { getYouTubeComplianceState, assertYouTubeComplianceGate, assertMadeForKidsDeclaration } = require('../utils/youtube-compliance-gate');
const { requireWriteActionConsent, hashWritePayload } = require('../utils/youtube-write-action-consent');
const { verifyMediaSourceProvenance } = require('../utils/media-source-provenance');

class PublishingSchedulingAgent {
  constructor(db, credentials, options = {}) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('PublishingScheduling');
    this.youtube = null;
    this.publishQueue = [];
    this.getYouTubeComplianceState = options.getYouTubeComplianceState || getYouTubeComplianceState;
    this.assertYouTubeComplianceGate = options.assertYouTubeComplianceGate || assertYouTubeComplianceGate;
    this.getWriteActionConsent = options.getWriteActionConsent || null;
    this.consumeWriteActionConsent = options.consumeWriteActionConsent || null;
    this.getAuthorizingUserId = options.getAuthorizingUserId || null;
    this.apiClientId = options.apiClientId || this.getYouTubeComplianceState().config?.apiClient?.id || null;
    this.channelId = options.channelId || process.env.YOUTUBE_CHANNEL_ID || process.env.AIOS_YOUTUBE_CHANNEL_ID || null;
    this.complianceBlocked = false;
  }

  async requireWriteActionConsent(apiAction, capability, resourceScope, payload, visibility = null) {
    const authorizingUserId = typeof this.getAuthorizingUserId === 'function'
      ? await this.getAuthorizingUserId()
      : null;
    return requireWriteActionConsent({
      getConsent: this.getWriteActionConsent,
      consumeConsent: this.consumeWriteActionConsent,
      apiClientId: this.apiClientId,
      channelId: this.channelId,
      apiAction,
      capability,
      resourceScope,
      authorizingUserId,
      payload,
      visibility
    });
  }

  async initialize() {
    this.logger.info('Initializing Publishing & Scheduling Agent...');
    const gate = this.getYouTubeComplianceState();
    if (!gate.allowed) {
      this.complianceBlocked = true;
      this.logger.warn('YouTube publishing remains disabled by the API Client compliance gate: ' + gate.blockers.join('; '));
      await this.loadPublishQueue();
      return true;
    }
    await this.setupYouTubeAPI();
    await this.loadPublishQueue();
    return true;
  }

  async setupYouTubeAPI() {
    try {
      this.assertYouTubeComplianceGate('YouTube API initialization');
      const auth = this.credentials.getYouTubeAuth();
      this.youtube = google.youtube({ version: 'v3', auth });
      this.logger.info('YouTube API initialized');
    } catch (error) {
      this.logger.error('Failed to initialize YouTube API:', error);
      throw error;
    }
  }

  async loadPublishQueue() {
    try {
      const queue = await this.db.getPublishQueue();
      this.publishQueue = queue || [];
      this.logger.info(`Loaded ${this.publishQueue.length} items in publish queue`);
    } catch (error) {
      this.logger.warn('No existing publish queue found');
    }
  }

  async scheduleContent(productionData) {
    try {
      this.assertYouTubeComplianceGate('YouTube scheduling');
      const finalVideo = productionData.assets?.finalVideo;
      if (!finalVideo || finalVideo.simulated || path.extname(finalVideo.path || '').toLowerCase() !== '.mp4') {
        this.logger.warn(`Not scheduling ${productionData.id}: no real video file was produced (placeholder/simulated output). Fix your AI provider keys and FFmpeg, then regenerate.`);
        return null;
      }
      if (!await this.isNarrationReady(productionData.assets?.audio)) {
        this.logger.warn(`Not scheduling ${productionData.id}: narration is missing. Regenerate narration or explicitly confirm an intentional silent video.`);
        return null;
      }
      const selfDeclaredMadeForKids = assertMadeForKidsDeclaration(productionData.selfDeclaredMadeForKids);

      this.logger.info(`Scheduling content: ${productionData.id}`);
      const existing = await this.db.getLatestScheduleEntry?.(productionData.id);
      if (existing) {
        existing.metadata = { ...(existing.metadata || {}), selfDeclaredMadeForKids };
        if (this.db.updateScheduleEntry) await this.db.updateScheduleEntry(existing);
        if (['scheduled', 'paused'].includes(existing.status) && !this.publishQueue.some(entry => entry.id === existing.id)) {
          this.publishQueue.push(existing);
          this.publishQueue.sort((a, b) => new Date(a.publishTime) - new Date(b.publishTime));
        }
        this.logger.info(`Reusing existing ${existing.status} schedule entry for: ${productionData.id}`);
        return existing;
      }

      const scheduleEntry = {
        productionId: productionData.id,
        title: productionData.script.title,
        publishTime: productionData.scheduledPublishTime,
        status: 'scheduled',
        priority: productionData.priority,
        metadata: {
          seo: productionData.seo,
          thumbnail: productionData.assets.thumbnail,
          video: productionData.assets.finalVideo,
          mediaProvenance: productionData.assets.finalVideo.mediaProvenance || null,
          audio: productionData.assets.audio,
          captions: productionData.assets.captions,
          privacyStatus: productionData.privacyStatus || process.env.DEFAULT_PRIVACY_STATUS || 'private',
          containsSyntheticMedia: productionData.containsSyntheticMedia === true,
          selfDeclaredMadeForKids,
          contentType: productionData.contentType || 'long_form',
          sourceProductionId: productionData.sourceProductionId || productionData.id,
          shortClipId: productionData.shortClipId || null
        },
        createdAt: new Date().toISOString()
      };
      
      const saved = await this.db.saveScheduleEntry(scheduleEntry) || scheduleEntry;
      this.publishQueue.push(saved);
      this.publishQueue.sort((a, b) => new Date(a.publishTime) - new Date(b.publishTime));
      
      this.logger.info(`Content scheduled for: ${saved.publishTime}`);
      return saved;
    } catch (error) {
      this.logger.error('Failed to schedule content:', error);
      throw error;
    }
  }

  async publishContent(contentId) {
    try {
      this.assertYouTubeComplianceGate('YouTube publishing');
      let productionBundle = null;
      if (this.db.getLatestReadinessRun) {
        const readiness = await this.db.getLatestReadinessRun();
        if (readiness?.status === 'failed') {
          const failures = readiness.checks
            .filter(check => check.blocking && check.status === 'failed')
            .map(check => check.id);
          const error = new Error(`Publishing is blocked by the production readiness gate. Fix ${failures.join(', ')} and run the check again.`);
          error.status = 409;
          error.code = 'READINESS_BLOCKED';
          throw error;
        }
      }
      if (this.db.getProductionBundle) {
        productionBundle = await this.db.getProductionBundle(contentId);
        if (productionBundle && !['verified', 'not_required'].includes(productionBundle.provenance?.status || 'not_required')) {
          const error = new Error('Publishing is blocked until every factual claim is supported or explicitly waived');
          error.status = 409;
          error.code = 'PROVENANCE_BLOCKED';
          throw error;
        }
      }
      this.logger.info(`Publishing content: ${contentId}`);
      
      let scheduleEntry = this.publishQueue.find(entry =>
        entry.productionId === contentId || entry.id === contentId
      );
      if (!scheduleEntry && this.db.getLatestScheduleEntry) {
        scheduleEntry = await this.db.getLatestScheduleEntry(contentId);
      }
      
      if (!scheduleEntry) {
        throw new Error(`Content not found in queue: ${contentId}`);
      }
      if (scheduleEntry.status === 'published') return scheduleEntry;
      assertMadeForKidsDeclaration(scheduleEntry.metadata?.selfDeclaredMadeForKids);
      if (!await this.isNarrationReady(scheduleEntry.metadata?.audio || productionBundle?.assets?.audio)) {
        const error = new Error('Publishing is blocked because narration is missing or the intentional-silence override is incomplete');
        error.status = 409;
        error.code = 'NARRATION_REQUIRED';
        throw error;
      }
      if (scheduleEntry.youtubeId) {
        return this.reconcileUploadedVideo(scheduleEntry);
      }
      if (['uploading', 'reconciliation_required'].includes(scheduleEntry.status)) {
        const error = new Error('A previous upload may have reached YouTube without returning a video ID. Reconcile the channel before attempting another upload.');
        error.status = 409;
        error.code = 'UPLOAD_OUTCOME_UNKNOWN';
        throw error;
      }

      scheduleEntry.status = 'uploading';
      scheduleEntry.error = null;
      await this.db.updateScheduleEntry(scheduleEntry);
      await this.syncShortStatus(scheduleEntry, 'uploading');
      
      let uploadResult;
      try {
        uploadResult = await this.uploadToYouTube(scheduleEntry);
      } catch (error) {
        if (scheduleEntry.uploadAttempted && this.isUploadOutcomeUnknown(error)) {
          scheduleEntry.status = 'reconciliation_required';
          scheduleEntry.error = 'Upload outcome is unknown; verify the YouTube channel before retrying';
          await this.db.updateScheduleEntry(scheduleEntry);
          await this.syncShortStatus(scheduleEntry, 'reconciliation_required', scheduleEntry.error);
          error.code = 'UPLOAD_OUTCOME_UNKNOWN';
          error.status = 409;
        } else if (error.code && error.code.startsWith('YOUTUBE_WRITE_ACTION_CONSENT')) {
          scheduleEntry.status = 'scheduled';
          scheduleEntry.error = 'Waiting for fresh, explicit, single-action user consent';
          await this.db.updateScheduleEntry(scheduleEntry);
          await this.syncShortStatus(scheduleEntry, 'scheduled', scheduleEntry.error);
        } else {
          scheduleEntry.status = 'failed';
          scheduleEntry.error = error.message;
          await this.db.updateScheduleEntry(scheduleEntry);
          await this.syncShortStatus(scheduleEntry, 'failed', error.message);
        }
        throw error;
      }
      
      // Update database
      scheduleEntry.status = 'published';
      scheduleEntry.publishedAt = new Date().toISOString();
      scheduleEntry.youtubeId = uploadResult.id;
      scheduleEntry.youtubeUrl = `https://www.youtube.com/watch?v=${uploadResult.id}`;
      
      await this.db.updateScheduleEntry(scheduleEntry);
      await this.syncShortStatus(scheduleEntry, 'published');
      
      // Remove from queue
      this.publishQueue = this.publishQueue.filter(entry => entry.productionId !== scheduleEntry.productionId);
      
      this.logger.success(`Content published: ${scheduleEntry.youtubeUrl}`);
      return scheduleEntry;
    } catch (error) {
      this.logger.error('Failed to publish content:', error);
      throw error;
    }
  }

  async uploadToYouTube(scheduleEntry) {
    this.assertYouTubeComplianceGate('YouTube video upload');
    const { metadata } = scheduleEntry;
    const selfDeclaredMadeForKids = assertMadeForKidsDeclaration(metadata.selfDeclaredMadeForKids);
    const validation = assertValidYouTubeMetadata(metadata.seo);
    if (validation.warnings.length) {
      this.logger.warn(`YouTube metadata warnings: ${validation.warnings.join(' ')}`);
    }
    const safeMetadata = validation.value;
    
    // Prepare video metadata
    const videoMetadata = {
      snippet: {
        title: safeMetadata.title,
        description: safeMetadata.description,
        tags: safeMetadata.tags,
        categoryId: safeMetadata.categoryId,
        defaultLanguage: safeMetadata.defaultLanguage,
        defaultAudioLanguage: safeMetadata.defaultAudioLanguage
      },
      status: {
        privacyStatus: metadata.privacyStatus || process.env.DEFAULT_PRIVACY_STATUS || 'private',
        publishAt: scheduleEntry.publishTime,
        selfDeclaredMadeForKids,
        containsSyntheticMedia: metadata.containsSyntheticMedia === true
      }
    };
    
    const mediaCheck = await verifyMediaSourceProvenance(metadata.video.mediaProvenance || metadata.mediaProvenance, metadata.video.path);
    if (!mediaCheck.valid) {
      const error = new Error('YouTube upload is blocked until the exact source media, license/permission, and file hash are verified: ' + mediaCheck.blockers.join('; '));
      error.status = 409;
      error.code = 'MEDIA_SOURCE_PROVENANCE_BLOCKED';
      throw error;
    }
    await this.requireWriteActionConsent(
      'videos.insert',
      'youtube.publish',
      this.channelId + ':new-video',
      { videoMetadata, mediaSha256: mediaCheck.sha256 },
      videoMetadata.status.privacyStatus
    );

    // Resolve the file only after the exact submitted values and media bytes have consent.
    const videoStream = await this.getVideoStream(metadata.video.path);
    scheduleEntry.uploadAttempted = true;
    const videoUpload = await this.youtube.videos.insert({
      part: 'snippet,status',
      requestBody: videoMetadata,
      media: {
        body: videoStream
      }
    });
    
    const videoId = videoUpload.data.id;
    this.logger.info(`Video uploaded with ID: ${videoId}`);
    scheduleEntry.status = 'uploaded';
    scheduleEntry.youtubeId = videoId;
    scheduleEntry.youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    scheduleEntry.error = null;
    await this.db.updateScheduleEntry(scheduleEntry);
    
    // Thumbnail and captions are separate YouTube write actions; never inherit video-upload consent.
    if (metadata.thumbnail && metadata.thumbnail.path) {
      try {
        await this.uploadThumbnail(videoId, metadata.thumbnail.path, metadata.thumbnail.mediaProvenance);
      } catch (error) {
        if ((error.code && error.code.startsWith('YOUTUBE_WRITE_ACTION_CONSENT')) || error.code === 'MEDIA_SOURCE_PROVENANCE_BLOCKED') {
          this.logger.warn('Thumbnail upload skipped because separate user consent or media provenance is missing');
        } else {
          throw error;
        }
      }
    }
    if (metadata.captions && metadata.captions.path) {
      try {
        await this.uploadCaptions(videoId, metadata.captions.path);
      } catch (error) {
        if (error.code && error.code.startsWith('YOUTUBE_WRITE_ACTION_CONSENT')) {
          this.logger.warn('Captions upload skipped because separate user consent is missing');
        } else {
          throw error;
        }
      }
    }
    
    return videoUpload.data;
  }

  async isNarrationReady(audio = {}) {
    if (audio.intentionalSilence === true) {
      return String(audio.silenceReason || '').trim().length >= 10 && Boolean(audio.silenceConfirmedAt);
    }
    if (!audio.path || audio.simulated || String(audio.path).endsWith('.info')) return false;
    try {
      const stats = await fs.stat(audio.path);
      return stats.isFile() && stats.size > 0;
    } catch (_error) {
      return false;
    }
  }

  isUploadOutcomeUnknown(error) {
    const status = Number(error.status || error.response?.status || 0);
    return !status || status >= 500;
  }

  async reconcileUploadedVideo(scheduleEntry) {
    this.assertYouTubeComplianceGate('YouTube upload reconciliation');
    const response = await this.youtube.videos.list({ part: 'id,status', id: scheduleEntry.youtubeId });
    if (!response.data.items?.some(video => video.id === scheduleEntry.youtubeId)) {
      scheduleEntry.status = 'reconciliation_required';
      scheduleEntry.error = 'The recorded YouTube video ID could not be verified';
      await this.db.updateScheduleEntry(scheduleEntry);
      await this.syncShortStatus(scheduleEntry, 'reconciliation_required', scheduleEntry.error);
      const error = new Error('The recorded upload could not be verified on YouTube. Resolve it before attempting another upload.');
      error.status = 409;
      error.code = 'UPLOAD_OUTCOME_UNKNOWN';
      throw error;
    }
    scheduleEntry.status = 'published';
    scheduleEntry.publishedAt = scheduleEntry.publishedAt || new Date().toISOString();
    scheduleEntry.youtubeUrl = scheduleEntry.youtubeUrl || `https://www.youtube.com/watch?v=${scheduleEntry.youtubeId}`;
    scheduleEntry.error = null;
    await this.db.updateScheduleEntry(scheduleEntry);
    await this.syncShortStatus(scheduleEntry, 'published');
    this.publishQueue = this.publishQueue.filter(entry => entry.productionId !== scheduleEntry.productionId);
    this.logger.success(`Reconciled existing YouTube upload: ${scheduleEntry.youtubeUrl}`);
    return scheduleEntry;
  }

  async syncShortStatus(scheduleEntry, status, error = null) {
    const clipId = scheduleEntry.metadata?.shortClipId;
    if (!clipId || !this.db.updateShortClip) return null;
    return this.db.updateShortClip(clipId, {
      status,
      scheduleId: scheduleEntry.id,
      youtubeId: scheduleEntry.youtubeId || null,
      youtubeUrl: scheduleEntry.youtubeUrl || null,
      error
    });
  }

  async getVideoStream(videoPath) {
    try {
      const stats = await fs.stat(videoPath);
      if (!stats.isFile() || path.extname(videoPath).toLowerCase() !== '.mp4') {
        throw new Error('placeholder asset');
      }

      return fsSync.createReadStream(videoPath);
    } catch (error) {
      throw new Error('video file not found — refusing to upload placeholder');
    }
  }
  async uploadThumbnail(videoId, thumbnailPath, mediaProvenance) {
    this.assertYouTubeComplianceGate('YouTube thumbnail upload');
    const mediaCheck = await verifyMediaSourceProvenance(mediaProvenance, thumbnailPath);
    if (!mediaCheck.valid) {
      const error = new Error('Thumbnail upload is blocked until source rights/provenance and file hash are verified: ' + mediaCheck.blockers.join('; '));
      error.status = 409;
      error.code = 'MEDIA_SOURCE_PROVENANCE_BLOCKED';
      throw error;
    }
    const thumbnailBuffer = await fs.readFile(thumbnailPath);
    await this.requireWriteActionConsent(
      'thumbnails.set',
      'youtube.thumbnail.upload',
      this.channelId + ':video:' + videoId + ':thumbnail',
      { videoId, mediaSha256: mediaCheck.sha256 },
      null
    );
    await this.youtube.thumbnails.set({
      videoId,
      media: { body: thumbnailBuffer }
    });
    this.logger.info(`Thumbnail uploaded for video: ${videoId}`);
  }

  async applyVideoPackaging(videoId, packaging = {}) {
    this.assertYouTubeComplianceGate('YouTube video packaging update');
    const title = String(packaging.title || '').trim();
    if (!videoId || !title || title.length > 100 || !packaging.thumbnailPath) {
      const error = new Error('A valid video ID, title, and thumbnail are required for a packaging change');
      error.status = 400;
      error.code = 'PACKAGING_INVALID';
      throw error;
    }
    const mediaCheck = await verifyMediaSourceProvenance(packaging.thumbnailMediaProvenance, packaging.thumbnailPath);
    if (!mediaCheck.valid) {
      const error = new Error('Packaging update is blocked until thumbnail source rights/provenance and file hash are verified: ' + mediaCheck.blockers.join('; '));
      error.status = 409;
      error.code = 'MEDIA_SOURCE_PROVENANCE_BLOCKED';
      throw error;
    }
    const thumbnail = await fs.readFile(packaging.thumbnailPath);
    const current = await this.youtube.videos.list({ part: 'snippet', id: videoId });
    const snippet = current.data.items?.[0]?.snippet;
    if (!snippet) {
      const error = new Error(`YouTube video not found: ${videoId}`);
      error.status = 404;
      error.code = 'PACKAGING_VIDEO_NOT_FOUND';
      throw error;
    }
    const requestBody = {
      id: videoId,
      snippet: {
        title,
        description: snippet.description || '',
        tags: snippet.tags || [],
        categoryId: snippet.categoryId || '22',
        defaultLanguage: snippet.defaultLanguage,
        defaultAudioLanguage: snippet.defaultAudioLanguage
      }
    };
    await this.requireWriteActionConsent(
      'videos.update',
      'youtube.schedule',
      this.channelId + ':video:' + videoId,
      { part: 'snippet', requestBody },
      null
    );
    await this.youtube.videos.update({ part: 'snippet', requestBody });
    try {
      await this.requireWriteActionConsent(
        'thumbnails.set',
        'youtube.thumbnail.upload',
        this.channelId + ':video:' + videoId + ':thumbnail',
        { videoId, mediaSha256: mediaCheck.sha256 },
        null
      );
      await this.youtube.thumbnails.set({ videoId, media: { body: thumbnail } });
    } catch (error) {
      error.status = error.status || 502;
      error.code = 'PACKAGING_PARTIAL_UPDATE';
      error.message = 'The title update was approved and applied, but the separately approved thumbnail update failed: ' + error.message;
      throw error;
    }
    this.logger.info(`Applied separately approved packaging actions to video: ${videoId}`);
    return { videoId, title, thumbnailPath: packaging.thumbnailPath };
  }

  async uploadCaptions(videoId, captionsPath) {
    this.assertYouTubeComplianceGate('YouTube captions upload');
    const captionsContent = await fs.readFile(captionsPath, 'utf8');
    const requestBody = {
      snippet: {
        videoId,
        language: 'en',
        name: 'English Captions',
        isDraft: false
      }
    };
    await this.requireWriteActionConsent(
      'captions.insert',
      'youtube.captions.upload',
      this.channelId + ':video:' + videoId + ':captions',
      { requestBody, captionsPayloadHash: hashWritePayload(captionsContent) },
      null
    );
    await this.youtube.captions.insert({
      part: 'snippet',
      requestBody,
      media: { body: captionsContent }
    });
    this.logger.info(`Captions uploaded for video: ${videoId}`);
  }

  async processPublishQueue() {
    const gate = this.getYouTubeComplianceState();
    if (!gate.allowed) {
      this.complianceBlocked = true;
      this.logger.warn('Publish queue remains paused; no YouTube write actions will run until compliance approval.');
      return 0;
    }
    this.complianceBlocked = false;
    const now = new Date();
    const scheduled = this.publishQueue
      .filter(entry => entry.status === 'scheduled')
      .sort((a, b) => new Date(a.publishTime) - new Date(b.publishTime));
    const readyToPublish = scheduled.filter(entry => new Date(entry.publishTime) <= now);

    if (readyToPublish.length === 0) {
      if (scheduled.length > 0) {
        this.logger.info(`Publish queue: ${scheduled.length} item(s) waiting, next publish at ${scheduled[0].publishTime}`);
      } else {
        this.logger.info('Publish queue is empty — nothing scheduled yet.');
      }
      return 0;
    }

    this.logger.info(`Processing publish queue: ${readyToPublish.length} item(s) ready to publish...`);

    for (const entry of readyToPublish) {
      try {
        await this.publishContent(entry.productionId);
        this.logger.info(`Auto-published: ${entry.title}`);
      } catch (error) {
        if (error.code === 'READINESS_BLOCKED') {
          this.logger.warn(error.message);
          continue;
        }
        this.logger.error(`Failed to auto-publish ${entry.title}:`, error);
        // Mark as failed but don't stop processing other items
        if (error.code !== 'UPLOAD_OUTCOME_UNKNOWN') {
          entry.status = 'failed';
          entry.error = error.message;
          await this.db.updateScheduleEntry(entry);
        }
      }
    }
    
    return readyToPublish.length;
  }

  async getUpcomingSchedule(days = 7) {
    const now = new Date();
    const endDate = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
    
    return this.publishQueue
      .filter(entry => {
        const publishTime = new Date(entry.publishTime);
        return publishTime >= now && publishTime <= endDate;
      })
      .sort((a, b) => new Date(a.publishTime) - new Date(b.publishTime));
  }

  async optimizePublishTimes() {
    // Analyze channel analytics to find optimal publish times
    const analytics = await this.getChannelAnalytics();
    const optimalTimes = this.calculateOptimalTimes(analytics);
    
    // Update scheduled content with better times
    for (const entry of this.publishQueue) {
      if (entry.status === 'scheduled') {
        const currentTime = new Date(entry.publishTime);
        const betterTime = this.findBetterTime(currentTime, optimalTimes);
        
        if (betterTime && betterTime.getTime() !== currentTime.getTime()) {
          entry.publishTime = betterTime.toISOString();
          await this.db.updateScheduleEntry(entry);
          this.logger.info(`Optimized publish time for: ${entry.title}`);
        }
      }
    }
  }

  async getChannelAnalytics() {
    this.assertYouTubeComplianceGate('YouTube channel statistics API Data access');
    try {
      // Get channel analytics for the last 30 days
      const response = await this.youtube.channels.list({
        part: 'statistics',
        mine: true
      });
      
      // In a full implementation, you'd use YouTube Analytics API
      // For now, we'll return simulated data
      return {
        totalViews: response.data.items[0]?.statistics?.viewCount || 0,
        subscribers: response.data.items[0]?.statistics?.subscriberCount || 0,
        videos: response.data.items[0]?.statistics?.videoCount || 0,
        optimalDays: ['Tuesday', 'Wednesday', 'Thursday'], // Most active days
        optimalHours: [14, 15, 16, 20] // Most active hours
      };
    } catch (error) {
      this.logger.error('Failed to get channel analytics:', error);
      return {
        optimalDays: ['Tuesday', 'Wednesday', 'Thursday'],
        optimalHours: [14, 15, 16]
      };
    }
  }

  calculateOptimalTimes(analytics) {
    const { optimalDays, optimalHours } = analytics;
    
    return {
      bestDays: optimalDays,
      bestHours: optimalHours,
      worstDays: ['Monday', 'Friday'],
      worstHours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 22, 23]
    };
  }

  findBetterTime(currentTime, optimalTimes) {
    const currentDay = currentTime.toLocaleDateString('en-US', { weekday: 'long' });
    const currentHour = currentTime.getHours();
    
    // If current time is already optimal, return null
    if (optimalTimes.bestDays.includes(currentDay) && 
        optimalTimes.bestHours.includes(currentHour)) {
      return null;
    }
    
    // Find the next optimal time
    const nextOptimalTime = new Date(currentTime);
    
    // Try to find an optimal hour on the same day
    for (const hour of optimalTimes.bestHours) {
      if (hour > currentHour) {
        nextOptimalTime.setHours(hour, 0, 0, 0);
        if (optimalTimes.bestDays.includes(currentDay)) {
          return nextOptimalTime;
        }
      }
    }
    
    // Find next optimal day
    for (let i = 1; i <= 7; i++) {
      const testDate = new Date(currentTime.getTime() + (i * 24 * 60 * 60 * 1000));
      const testDay = testDate.toLocaleDateString('en-US', { weekday: 'long' });
      
      if (optimalTimes.bestDays.includes(testDay)) {
        testDate.setHours(optimalTimes.bestHours[0], 0, 0, 0);
        return testDate;
      }
    }
    
    return null; // No better time found
  }

  async createPublishingReport() {
    const report = {
      queueStatus: {
        total: this.publishQueue.length,
        scheduled: this.publishQueue.filter(e => e.status === 'scheduled').length,
        published: this.publishQueue.filter(e => e.status === 'published').length,
        failed: this.publishQueue.filter(e => e.status === 'failed').length
      },
      upcomingPublications: await this.getUpcomingSchedule(7),
      recentPublications: this.publishQueue
        .filter(e => e.status === 'published' && 
                new Date(e.publishedAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)),
      performance: await this.getPublishingPerformance(),
      generatedAt: new Date().toISOString()
    };
    
    return report;
  }

  async getPublishingPerformance() {
    const published = this.publishQueue.filter(e => e.status === 'published');
    
    if (published.length === 0) {
      return {
        totalPublished: 0,
        averageScheduleAccuracy: 0,
        publishingFrequency: 0
      };
    }
    
    // Calculate schedule accuracy
    let totalDelay = 0;
    let accuratePublishes = 0;
    
    published.forEach(entry => {
      const scheduledTime = new Date(entry.publishTime);
      const actualTime = new Date(entry.publishedAt);
      const delay = Math.abs(actualTime - scheduledTime) / (1000 * 60); // minutes
      
      totalDelay += delay;
      if (delay <= 5) accuratePublishes++; // Within 5 minutes is considered accurate
    });
    
    const averageDelay = totalDelay / published.length;
    const accuracyRate = (accuratePublishes / published.length) * 100;
    
    return {
      totalPublished: published.length,
      averageScheduleAccuracy: `${accuracyRate.toFixed(1)}%`,
      averageDelay: `${averageDelay.toFixed(1)} minutes`,
      publishingFrequency: this.calculatePublishingFrequency(published)
    };
  }

  calculatePublishingFrequency(published) {
    if (published.length < 2) return 'Insufficient data';
    
    const dates = published.map(p => new Date(p.publishedAt)).sort((a, b) => a - b);
    const totalDays = (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24);
    const frequency = published.length / totalDays;
    
    if (frequency >= 1) return `${frequency.toFixed(1)} videos per day`;
    if (frequency >= 0.14) return `${(frequency * 7).toFixed(1)} videos per week`;
    return `${(frequency * 30).toFixed(1)} videos per month`;
  }

  async emergencyPublish(contentId, delayMinutes = 0) {
    // For urgent publishing needs
    this.logger.info(`Emergency publish requested: ${contentId}`);
    
    const entry = this.publishQueue.find(e => 
      e.productionId === contentId || e.id === contentId
    );
    
    if (!entry) {
      throw new Error(`Content not found: ${contentId}`);
    }
    
    if (delayMinutes > 0) {
      const newPublishTime = new Date(Date.now() + (delayMinutes * 60 * 1000));
      entry.publishTime = newPublishTime.toISOString();
      await this.db.updateScheduleEntry(entry);
      this.logger.info(`Emergency scheduled for: ${entry.publishTime}`);
      return entry;
    } else {
      return await this.publishContent(contentId);
    }
  }

  async pauseScheduledContent(contentId) {
    const entry = this.publishQueue.find(e => 
      e.productionId === contentId || e.id === contentId
    );
    
    if (!entry) {
      throw new Error(`Content not found: ${contentId}`);
    }
    
    entry.status = 'paused';
    await this.db.updateScheduleEntry(entry);
    
    this.logger.info(`Content paused: ${entry.title}`);
    return entry;
  }

  async resumeScheduledContent(contentId, newPublishTime = null) {
    const entry = this.publishQueue.find(e => 
      e.productionId === contentId || e.id === contentId
    );
    
    if (!entry) {
      throw new Error(`Content not found: ${contentId}`);
    }
    
    entry.status = 'scheduled';
    if (newPublishTime) {
      entry.publishTime = new Date(newPublishTime).toISOString();
    }
    
    await this.db.updateScheduleEntry(entry);
    
    this.logger.info(`Content resumed: ${entry.title}`);
    return entry;
  }
}

module.exports = { PublishingSchedulingAgent };
