const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const { assertWorkspaceAccountId, getWorkspaceRuntime } = require('../utils/workspace-runtime');

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
