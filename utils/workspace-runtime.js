const path = require('path');

const ACCOUNT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

function hasWorkspaceAccount() {
  return Boolean(process.env.WORKSPACE_ACCOUNT_ID);
}

function assertWorkspaceAccountId(accountId = process.env.WORKSPACE_ACCOUNT_ID) {
  if (!accountId || !ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error('WORKSPACE_ACCOUNT_ID must use lowercase letters, numbers, and hyphens (2-63 characters)');
  }
  return accountId;
}

function resolveDirectory(value, fallback) {
  const resolved = path.resolve(value || fallback);
  return resolved;
}

function getWorkspaceRuntime() {
  const accountId = process.env.WORKSPACE_ACCOUNT_ID || null;
  const workspaceId = process.env.WORKSPACE_ID || null;
  const rootDir = path.resolve(process.env.WORKSPACE_RUNTIME_DIR || path.join(__dirname, '..', 'runtime'));

  if (!accountId) {
    return {
      enabled: false,
      workspaceId,
      accountId: null,
      accountName: null,
      rootDir,
      dataDir: path.join(__dirname, '..', 'data'),
      configDir: path.join(__dirname, '..', 'config'),
      host: process.env.HOST || '127.0.0.1',
      strictMode: false
    };
  }

  assertWorkspaceAccountId(accountId);
  const accountRoot = process.env.WORKSPACE_ACCOUNT_ROOT_DIR
    ? path.resolve(process.env.WORKSPACE_ACCOUNT_ROOT_DIR)
    : path.resolve(rootDir, accountId);
  if (path.basename(accountRoot) !== accountId) {
    throw new Error('Workspace account runtime directory must end with the workspace account identifier');
  }
  const dataDir = resolveDirectory(process.env.WORKSPACE_DATA_DIR, path.join(accountRoot, 'data'));
  const configDir = resolveDirectory(process.env.WORKSPACE_CONFIG_DIR, path.join(accountRoot, 'config'));

  for (const directory of [dataDir, configDir]) {
    if (!directory.startsWith(`${accountRoot}${path.sep}`) && directory !== accountRoot) {
      throw new Error('Workspace account data and configuration must remain inside the account runtime directory');
    }
  }

  return {
    enabled: true,
    workspaceId,
    accountId,
    accountName: process.env.WORKSPACE_ACCOUNT_NAME || accountId,
    rootDir,
    accountRoot,
    dataDir,
    configDir,
    host: process.env.WORKSPACE_HOST || process.env.HOST || '127.0.0.1',
    strictMode: process.env.WORKSPACE_STRICT_MODE === 'true'
  };
}

module.exports = {
  ACCOUNT_ID_PATTERN,
  assertWorkspaceAccountId,
  getWorkspaceRuntime,
  hasWorkspaceAccount
};
