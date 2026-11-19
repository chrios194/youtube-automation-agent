const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const { assertWorkspaceAccountId, assertIsolatedWorkspaceRuntime, getWorkspaceRuntime } = require('../utils/workspace-runtime');
const { CredentialManager } = require('../utils/credential-manager');
const { ModernAuth } = require('../modern-auth');
const { OAuthServer } = require('../oauth-server');
const { validateManifest, buildAccountEnvironment } = require('../workspace');

const originalEnvironment = { ...process.env };

function resetEnvironment() {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
  delete process.env.WORKSPACE_ID;
  delete process.env.WORKSPACE_ACCOUNT_ID;
  delete process.env.WORKSPACE_ACCOUNT_NAME;
  delete process.env.WORKSPACE_RUNTIME_DIR;
  delete process.env.WORKSPACE_ACCOUNT_ROOT_DIR;
  delete process.env.WORKSPACE_DATA_DIR;
  delete process.env.WORKSPACE_CONFIG_DIR;
  delete process.env.WORKSPACE_STRICT_MODE;
}

test.afterEach(() => resetEnvironment());

function createTwoAccountFixture({ duplicateApiKey = false, duplicateMasterKey = false } = {}) {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'workspace', 'isolation-'));
  const relativeDir = path.relative(path.join(__dirname, '..'), fixtureDir).split(path.sep).join('/');
  const keys = {
    apiA: 'account-a-api-key-12345678901234567890',
    apiB: duplicateApiKey ? 'account-a-api-key-12345678901234567890' : 'account-b-api-key-12345678901234567890',
    masterA: 'account-a-master-key-123456789012345678901234567890',
    masterB: duplicateMasterKey ? 'account-a-master-key-123456789012345678901234567890' : 'account-b-master-key-123456789012345678901234567890'
  };
  fs.writeFileSync(path.join(fixtureDir, 'account-a.env'), [
    `API_KEY=${keys.apiA}`,
    `AGENTTUBE_MASTER_KEY=${keys.masterA}`,
    'OPENAI_API_KEY=account-a-openai-secret'
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(fixtureDir, 'account-b.env'), [
    `API_KEY=${keys.apiB}`,
    `AGENTTUBE_MASTER_KEY=${keys.masterB}`,
    'OPENAI_API_KEY=account-b-openai-secret'
  ].join('\n') + '\n');
  const manifestPath = path.join(fixtureDir, 'workspace.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    workspaceId: 'fixture-isolation',
    accounts: [
      { id: 'account-a', port: 4201, envFile: `${relativeDir}/account-a.env` },
      { id: 'account-b', port: 4202, envFile: `${relativeDir}/account-b.env` }
    ]
  }, null, 2));
  return { fixtureDir, manifestPath };
}


test('accepts safe workspace account identifiers', () => {
  assert.equal(assertWorkspaceAccountId('creator-ai-ops'), 'creator-ai-ops');
  assert.equal(assertWorkspaceAccountId('a1'), 'a1');
});

test('rejects unsafe workspace account identifiers', () => {
  assert.throws(() => assertWorkspaceAccountId('../escape'));
  assert.throws(() => assertWorkspaceAccountId('Creator-Uppercase'));
  assert.throws(() => assertWorkspaceAccountId('a'));
});

test('creates isolated account runtime paths in workspace mode', () => {
  process.env.WORKSPACE_ID = 'creator-pod-alpha';
  process.env.WORKSPACE_ACCOUNT_ID = 'creator-ai-ops';
  process.env.WORKSPACE_ACCOUNT_NAME = 'AI Operations Creator';
  const accountRoot = path.join(process.cwd(), 'runtime', 'creator-pod-alpha', 'creator-ai-ops');
  process.env.WORKSPACE_RUNTIME_DIR = path.dirname(accountRoot);
  process.env.WORKSPACE_ACCOUNT_ROOT_DIR = accountRoot;
  process.env.WORKSPACE_STRICT_MODE = 'true';

  const runtime = getWorkspaceRuntime();
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.accountId, 'creator-ai-ops');
  assert.equal(runtime.accountName, 'AI Operations Creator');
  assert.equal(runtime.strictMode, true);
  assert.match(runtime.dataDir, /creator-ai-ops[\\/]data$/);
  assert.match(runtime.configDir, /creator-ai-ops[\\/]config$/);
});

test('validates a complete workspace manifest with one isolated account', () => {
  const output = execFileSync(
    process.execPath,
    ['workspace.js', 'validate', '--manifest', 'tests/fixtures/workspace/workspace-valid.json'],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
  );
  assert.match(output, /Workspace fixture-pod is valid with 1 account definitions/);
});

test('rejects account data paths that escape the account runtime', () => {
  process.env.WORKSPACE_ACCOUNT_ID = 'creator-ai-ops';
  const accountRoot = path.join(process.cwd(), 'runtime', 'creator-pod-alpha', 'creator-ai-ops');
  process.env.WORKSPACE_RUNTIME_DIR = path.dirname(accountRoot);
  process.env.WORKSPACE_ACCOUNT_ROOT_DIR = accountRoot;
  process.env.WORKSPACE_DATA_DIR = path.join(process.cwd(), 'runtime', 'other-account', 'data');

  assert.throws(() => getWorkspaceRuntime(), /must remain inside/);
});


test('workspace child environments inherit only safe OS variables and each account own secrets', async () => {
  const fixture = createTwoAccountFixture();
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousYoutube = process.env.YOUTUBE_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'parent-openai-secret';
    process.env.GEMINI_API_KEY = 'parent-gemini-secret';
    process.env.YOUTUBE_API_KEY = 'parent-youtube-secret';
    const config = await validateManifest(fixture.manifestPath);
    const accountA = await buildAccountEnvironment(config, config.accounts[0]);
    const accountB = await buildAccountEnvironment(config, config.accounts[1]);
    assert.equal(accountA.OPENAI_API_KEY, 'account-a-openai-secret');
    assert.equal(accountB.OPENAI_API_KEY, 'account-b-openai-secret');
    assert.equal(accountA.GEMINI_API_KEY, undefined);
    assert.equal(accountB.GEMINI_API_KEY, undefined);
    assert.equal(accountA.YOUTUBE_API_KEY, undefined);
    assert.equal(accountB.YOUTUBE_API_KEY, undefined);
    assert.notEqual(accountA.API_KEY, accountB.API_KEY);
    assert.notEqual(accountA.AGENTTUBE_MASTER_KEY, accountB.AGENTTUBE_MASTER_KEY);
    assert.equal(accountA.WORKSPACE_ACCOUNT_ID, 'account-a');
    assert.equal(accountB.WORKSPACE_ACCOUNT_ID, 'account-b');
    assert.ok(accountA.PATH);
  } finally {
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousOpenAI;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousGemini;
    if (previousYoutube === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = previousYoutube;
    fs.rmSync(fixture.fixtureDir, { recursive: true, force: true });
  }
});

test('workspace rejects reused API keys across accounts', async () => {
  const fixture = createTwoAccountFixture({ duplicateApiKey: true });
  try {
    await assert.rejects(() => validateManifest(fixture.manifestPath), /reuses another account's API_KEY/);
  } finally {
    fs.rmSync(fixture.fixtureDir, { recursive: true, force: true });
  }
});

test('workspace rejects reused master encryption keys across accounts', async () => {
  const fixture = createTwoAccountFixture({ duplicateMasterKey: true });
  try {
    await assert.rejects(() => validateManifest(fixture.manifestPath), /reuses another account's AGENTTUBE_MASTER_KEY/);
  } finally {
    fs.rmSync(fixture.fixtureDir, { recursive: true, force: true });
  }
});


test('YouTube OAuth and token access fail closed outside strict per-account workspace mode', async () => {
  assert.throws(() => assertIsolatedWorkspaceRuntime(), error => error.code === 'YOUTUBE_WORKSPACE_REQUIRED' && error.status === 403);
  assert.throws(() => new ModernAuth(), error => error.code === 'YOUTUBE_WORKSPACE_REQUIRED' && error.status === 403);
  assert.throws(() => new OAuthServer(), error => error.code === 'YOUTUBE_WORKSPACE_REQUIRED' && error.status === 403);

  const credentials = new CredentialManager();
  assert.throws(() => credentials.getYouTubeAuth(), error => error.code === 'YOUTUBE_WORKSPACE_REQUIRED');
  await assert.rejects(() => credentials.authenticateYouTube(), error => error.code === 'YOUTUBE_WORKSPACE_REQUIRED');
  await assert.rejects(() => credentials.setupYouTubeCredentials(), error => error.code === 'YOUTUBE_WORKSPACE_REQUIRED');
});

test('legacy OAuth entrypoints resolve only to the selected strict account config directory', () => {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'workspace', 'oauth-isolation-'));
  try {
    const accountRoot = path.join(fixtureDir, 'runtime', 'account-a');
    const configDir = path.join(accountRoot, 'config');
    process.env.WORKSPACE_ID = 'fixture-isolation';
    process.env.WORKSPACE_ACCOUNT_ID = 'account-a';
    process.env.WORKSPACE_RUNTIME_DIR = path.join(fixtureDir, 'runtime');
    process.env.WORKSPACE_ACCOUNT_ROOT_DIR = accountRoot;
    process.env.WORKSPACE_DATA_DIR = path.join(accountRoot, 'data');
    process.env.WORKSPACE_CONFIG_DIR = configDir;
    process.env.WORKSPACE_STRICT_MODE = 'true';

    const runtime = assertIsolatedWorkspaceRuntime();
    assert.equal(runtime.accountId, 'account-a');
    assert.equal(runtime.configDir, configDir);

    const modern = new ModernAuth();
    const oauth = new OAuthServer();
    for (const entrypoint of [modern, oauth]) {
      assert.equal(entrypoint.credentialsPath, path.join(configDir, 'credentials.json'));
      assert.equal(entrypoint.tokensPath, path.join(configDir, 'tokens.json'));
      assert.ok(entrypoint.credentialsPath.startsWith(configDir + path.sep));
      assert.ok(entrypoint.tokensPath.startsWith(configDir + path.sep));
    }
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});


test('root mode never loads or overwrites the shared YouTube token file', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'workspace', 'root-token-isolation-'));
  const tokensPath = path.join(fixtureDir, 'tokens.json');
  const original = JSON.stringify({ youtube: { refresh_token: 'legacy-shared-token' } });
  fs.writeFileSync(tokensPath, original);
  try {
    const manager = new CredentialManager({ runtime: getWorkspaceRuntime(), tokensPath });
    await manager.loadTokens();
    assert.deepEqual(manager.tokens, {});
    manager.tokens = { youtube: { refresh_token: 'must-not-be-written' } };
    await assert.rejects(
      () => manager.saveTokens(),
      error => error.code === 'YOUTUBE_WORKSPACE_REQUIRED' && error.status === 403
    );
    assert.equal(fs.readFileSync(tokensPath, 'utf8'), original);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('strict workspace stores encrypted YouTube tokens only under the account config directory', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'workspace', 'encrypted-token-isolation-'));
  try {
    const accountRoot = path.join(fixtureDir, 'runtime', 'account-a');
    const configDir = path.join(accountRoot, 'config');
    process.env.WORKSPACE_ID = 'fixture-isolation';
    process.env.WORKSPACE_ACCOUNT_ID = 'account-a';
    process.env.WORKSPACE_RUNTIME_DIR = path.join(fixtureDir, 'runtime');
    process.env.WORKSPACE_ACCOUNT_ROOT_DIR = accountRoot;
    process.env.WORKSPACE_DATA_DIR = path.join(accountRoot, 'data');
    process.env.WORKSPACE_CONFIG_DIR = configDir;
    process.env.WORKSPACE_STRICT_MODE = 'true';

    const runtime = assertIsolatedWorkspaceRuntime();
    const tokensPath = path.join(configDir, 'tokens.json');
    const masterKey = 'a'.repeat(32);
    const writer = new CredentialManager({ runtime, tokensPath, masterKey });
    writer.tokens = { youtube: { refresh_token: 'account-a-refresh-token' } };
    await writer.saveTokens();

    const encrypted = fs.readFileSync(tokensPath, 'utf8');
    assert.doesNotMatch(encrypted, /account-a-refresh-token/);

    const reader = new CredentialManager({ runtime, tokensPath, masterKey });
    await reader.loadTokens();
    assert.equal(reader.tokens.youtube.refresh_token, 'account-a-refresh-token');
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});
