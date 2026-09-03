const PLATFORM_CAPABILITIES = Object.freeze({
  youtube: Object.freeze({ publish: true, schedule: true, analytics: true, comments: true, syntheticMediaDisclosure: true, status: 'implemented' }),
  tiktok: Object.freeze({ publish: false, schedule: false, analytics: false, comments: false, syntheticMediaDisclosure: true, status: 'adapter-required' }),
  instagram: Object.freeze({ publish: false, schedule: false, analytics: false, comments: false, syntheticMediaDisclosure: true, status: 'adapter-required' })
});

function getPlatformCapabilities(platform) {
  const key = String(platform || '').toLowerCase();
  if (!PLATFORM_CAPABILITIES[key]) throw new Error(`Unsupported platform: ${platform}`);
  return PLATFORM_CAPABILITIES[key];
}

function assertPlatformAction(platform, action) {
  const capabilities = getPlatformCapabilities(platform);
  if (!['publish', 'schedule', 'analytics', 'comments'].includes(action)) throw new Error(`Unknown platform action: ${action}`);
  if (!capabilities[action]) throw new Error(`${platform} ${action} is not implemented; install an approved adapter before enabling it`);
  return true;
}

module.exports = { PLATFORM_CAPABILITIES, getPlatformCapabilities, assertPlatformAction };
