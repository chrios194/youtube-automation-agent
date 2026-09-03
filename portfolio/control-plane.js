const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { ACCOUNT_ID_PATTERN } = require('../utils/workspace-runtime');
const { atomicWriteJson } = require('../utils/secret-store');

const PORTFOLIO_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

function fail(message) {
  const error = new Error(message);
  error.code = 'PORTFOLIO_CONFIG_ERROR';
  throw error;
}

function ensureInside(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) fail(`${label} must stay inside portfolio root`);
  return resolved;
}

async function loadPortfolio(manifestPath, repoRoot = path.join(__dirname, '..')) {
  let manifest;
  try { manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8')); }
  catch (error) { fail(`Unable to read portfolio manifest ${manifestPath}: ${error.message}`); }
  if (manifest.version !== 1) fail('Portfolio manifest version must be 1');
  if (!PORTFOLIO_ID_PATTERN.test(String(manifest.portfolioId || ''))) fail('portfolioId is invalid');
  if (!Array.isArray(manifest.workspaces) || !manifest.workspaces.length) fail('Portfolio requires at least one workspace');
  if (manifest.workspaces.length > 100) fail('Portfolio supports at most 100 workspace pods per manifest');

  const rootDir = path.resolve(repoRoot, manifest.rootDir || path.join('runtime', 'portfolio', manifest.portfolioId));
  const ids = new Set();
  const workspacePaths = new Set();
  const workspaces = [];
  let totalAccounts = 0;

  for (const entry of manifest.workspaces) {
    const id = String(entry.id || '');
    if (!ACCOUNT_ID_PATTERN.test(id)) fail(`Workspace id is invalid: ${id || '(missing)'}`);
    if (ids.has(id)) fail(`Duplicate workspace id: ${id}`);
    ids.add(id);
    const manifestFile = path.resolve(repoRoot, entry.manifest);
    if (!fs.existsSync(manifestFile)) fail(`Workspace manifest does not exist: ${manifestFile}`);
    if (workspacePaths.has(manifestFile)) fail(`Workspace manifest reused: ${manifestFile}`);
    workspacePaths.add(manifestFile);
    const workspaceManifest = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
    const count = Array.isArray(workspaceManifest.accounts) ? workspaceManifest.accounts.length : 0;
    totalAccounts += count;
    workspaces.push({ id, manifestFile, enabled: entry.enabled !== false, vertical: String(entry.vertical || 'general'), accountCount: count });
  }

  const maxCreators = Number(manifest.limits?.maxCreators || 100);
  if (!Number.isInteger(maxCreators) || maxCreators < 1 || maxCreators > 10000) fail('limits.maxCreators must be 1..10000');
  if (totalAccounts > maxCreators) fail(`Portfolio defines ${totalAccounts} accounts but maxCreators is ${maxCreators}`);

  return {
    manifestPath: path.resolve(manifestPath), portfolioId: manifest.portfolioId, rootDir,
    workspaces, totalAccounts, limits: { maxCreators },
    governance: manifest.governance || {}, objectives: manifest.objectives || {}
  };
}

function fingerprint(config) {
  return crypto.createHash('sha256').update(JSON.stringify({
    portfolioId: config.portfolioId,
    workspaces: config.workspaces.map(w => [w.id, w.manifestFile, w.enabled, w.vertical]),
    limits: config.limits,
    governance: config.governance,
    objectives: config.objectives
  })).digest('hex');
}

async function writeSnapshot(config) {
  await fsp.mkdir(config.rootDir, { recursive: true, mode: 0o700 });
  const snapshot = {
    schemaVersion: 1,
    portfolioId: config.portfolioId,
    generatedAt: new Date().toISOString(),
    manifestFingerprint: fingerprint(config),
    totalAccounts: config.totalAccounts,
    workspaces: config.workspaces.map(({ manifestFile, ...w }) => ({ ...w, manifest: path.relative(path.dirname(config.manifestPath), manifestFile) })),
    governance: config.governance,
    objectives: config.objectives
  };
  const snapshotPath = ensureInside(config.rootDir, path.join(config.rootDir, 'portfolio-snapshot.json'), 'snapshot');
  await atomicWriteJson(snapshotPath, snapshot, 0o600);
  return snapshotPath;
}

function summarize(config) {
  return {
    portfolioId: config.portfolioId,
    workspaceCount: config.workspaces.length,
    enabledWorkspaceCount: config.workspaces.filter(w => w.enabled).length,
    totalAccounts: config.totalAccounts,
    maxCreators: config.limits.maxCreators,
    verticals: [...new Set(config.workspaces.map(w => w.vertical))].sort()
  };
}

module.exports = { loadPortfolio, writeSnapshot, summarize, fingerprint };
