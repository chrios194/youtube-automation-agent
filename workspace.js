#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { ACCOUNT_ID_PATTERN } = require('./utils/workspace-runtime');

const ROOT = __dirname;
const DEFAULT_MANIFEST = path.join(ROOT, 'config', 'workspace.json');

function parseEnvFile(text) {
  const output = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}

function fail(message) {
  const error = new Error(message);
  error.code = 'WORKSPACE_CONFIG_ERROR';
  throw error;
}

function parseArgs(argv) {
  const [command = 'validate', ...rest] = argv;
  const options = { command, manifestPath: DEFAULT_MANIFEST, accountIds: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === '--manifest') {
      options.manifestPath = path.resolve(rest[index + 1] || '');
      index += 1;
    } else if (value === '--account') {
      options.accountIds.push(rest[index + 1] || '');
      index += 1;
    } else if (value === '--help' || value === '-h') {
      options.command = 'help';
    } else {
      fail(`Unknown argument: ${value}`);
    }
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  node workspace.js validate [--manifest config/workspace.json]',
    '  node workspace.js status [--manifest config/workspace.json]',
    '  node workspace.js credentials --account account-id [--manifest config/workspace.json]',
    '  node workspace.js start [--manifest config/workspace.json] [--account account-id]'
  ].join('\n');
}

function resolveFromRoot(relativeOrAbsolutePath) {
  return path.resolve(ROOT, relativeOrAbsolutePath);
}

async function readManifest(manifestPath) {
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch (error) {
    fail(`Unable to read workspace manifest ${manifestPath}: ${error.message}`);
  }
  return { manifestPath, manifest: parsed };
}

async function validateManifest(manifestPath) {
  const { manifest } = await readManifest(manifestPath);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('Workspace manifest must be a JSON object');
  if (manifest.version !== 1) fail('Workspace manifest version must be 1');
  if (typeof manifest.workspaceId !== 'string' || !ACCOUNT_ID_PATTERN.test(manifest.workspaceId)) {
    fail('workspaceId must use lowercase letters, numbers, and hyphens (2-63 characters)');
  }
  if (!Array.isArray(manifest.accounts) || manifest.accounts.length < 1) fail('Workspace manifest requires at least one account');
  if (manifest.accounts.length > 12) fail('A lean workspace supports at most 12 account processes');

  const seenIds = new Set();
  const seenPorts = new Set();
  const seenDataDirs = new Set();
  const seenConfigDirs = new Set();
  const normalizedAccounts = [];

  for (const raw of manifest.accounts) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Every account entry must be an object');
    const id = String(raw.id || '');
    if (!ACCOUNT_ID_PATTERN.test(id)) fail(`Account id is invalid: ${id || '(missing)'}`);
    if (seenIds.has(id)) fail(`Duplicate account id: ${id}`);
    seenIds.add(id);

    const port = Number(raw.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) fail(`Account ${id} requires a port from 1024 to 65535`);
    if (seenPorts.has(port)) fail(`Duplicate account port: ${port}`);
    seenPorts.add(port);

    if (typeof raw.envFile !== 'string' || !raw.envFile.trim()) fail(`Account ${id} requires envFile`);
    const envFile = resolveFromRoot(raw.envFile);
    if (!fs.existsSync(envFile)) fail(`Account ${id} envFile does not exist: ${envFile}`);
    const parsedEnv = parseEnvFile(await fsp.readFile(envFile, 'utf8'));
    if (!parsedEnv.API_KEY || parsedEnv.API_KEY.trim().length < 24) {
      fail(`Account ${id} envFile must define an API_KEY of at least 24 characters`);
    }
    if (!parsedEnv.AGENTTUBE_MASTER_KEY || parsedEnv.AGENTTUBE_MASTER_KEY.trim().length < 32) {
      fail(`Account ${id} envFile must define AGENTTUBE_MASTER_KEY of at least 32 characters for encrypted secrets`);
    }

    const accountRoot = resolveFromRoot(raw.runtimeDir || path.join('runtime', manifest.workspaceId, id));
    const dataDir = path.resolve(raw.dataDir ? resolveFromRoot(raw.dataDir) : path.join(accountRoot, 'data'));
    const configDir = path.resolve(raw.configDir ? resolveFromRoot(raw.configDir) : path.join(accountRoot, 'config'));
    if (!dataDir.startsWith(`${accountRoot}${path.sep}`) || !configDir.startsWith(`${accountRoot}${path.sep}`)) {
      fail(`Account ${id} dataDir and configDir must be inside the account runtimeDir`);
    }
    if (seenDataDirs.has(dataDir) || seenConfigDirs.has(configDir)) fail(`Account ${id} reuses another account's data or config path`);
    seenDataDirs.add(dataDir);
    seenConfigDirs.add(configDir);

    normalizedAccounts.push({
      id,
      name: String(raw.name || id),
      enabled: raw.enabled !== false,
      port,
      envFile,
      accountRoot,
      dataDir,
      configDir
    });
  }

  return {
    workspaceId: manifest.workspaceId,
    host: manifest.host || '127.0.0.1',
    accounts: normalizedAccounts
  };
}

function formatAccount(account) {
  return `${account.id.padEnd(20)} ${String(account.port).padEnd(6)} ${account.enabled ? 'enabled' : 'disabled'}  ${account.name}`;
}

function buildAccountEnvironment(config, account) {
  return {
    ...process.env,
    WORKSPACE_ID: config.workspaceId,
    WORKSPACE_ACCOUNT_ID: account.id,
    WORKSPACE_ACCOUNT_NAME: account.name,
    WORKSPACE_RUNTIME_DIR: path.dirname(account.accountRoot),
    WORKSPACE_ACCOUNT_ROOT_DIR: account.accountRoot,
    WORKSPACE_DATA_DIR: account.dataDir,
    WORKSPACE_CONFIG_DIR: account.configDir,
    WORKSPACE_ENV_FILE: account.envFile,
    WORKSPACE_HOST: config.host,
    WORKSPACE_STRICT_MODE: 'true',
    PORT: String(account.port)
  };
}

async function ensureAccountDirectories(account) {
  await Promise.all([
    fsp.mkdir(account.dataDir, { recursive: true, mode: 0o700 }),
    fsp.mkdir(account.configDir, { recursive: true, mode: 0o700 })
  ]);
}

async function setupAccountCredentials(config, selectedIds) {
  if (selectedIds.length !== 1) fail('credentials requires exactly one --account identifier');
  const account = config.accounts.find(candidate => candidate.id === selectedIds[0]);
  if (!account) fail(`Account was not found: ${selectedIds[0]}`);
  await ensureAccountDirectories(account);

  const child = spawn(process.execPath, ['utils/credential-manager.js', 'setup'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: buildAccountEnvironment(config, account)
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Credential setup exited with code ${code}`)));
  });
}

async function startWorkspace(config, selectedIds) {
  const selected = config.accounts.filter(account => account.enabled && (!selectedIds.length || selectedIds.includes(account.id)));
  if (!selected.length) fail('No enabled accounts matched the requested selection');
  const children = [];

  for (const account of selected) {
    await ensureAccountDirectories(account);

    const child = spawn(process.execPath, ['index.js'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: buildAccountEnvironment(config, account)
    });
    children.push({ account, child });
    child.once('exit', (code, signal) => {
      console.log(`[workspace:${account.id}] exited with ${signal || code}`);
    });
  }

  const stop = signal => {
    for (const { child } of children) child.kill(signal);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  await Promise.all(children.map(({ child }) => new Promise(resolve => child.once('exit', resolve))));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') {
    console.log(usage());
    return;
  }
  if (!['validate', 'status', 'credentials', 'start'].includes(options.command)) fail(`Unknown command: ${options.command}`);

  const config = await validateManifest(options.manifestPath);
  if (options.command === 'validate') {
    console.log(`Workspace ${config.workspaceId} is valid with ${config.accounts.length} account definitions.`);
    return;
  }
  if (options.command === 'status') {
    console.log(`Workspace: ${config.workspaceId}`);
    console.log('Account ID           Port   State    Name');
    for (const account of config.accounts) console.log(formatAccount(account));
    return;
  }
  if (options.command === 'credentials') {
    await setupAccountCredentials(config, options.accountIds);
    return;
  }
  await startWorkspace(config, options.accountIds);
}

main().catch(error => {
  console.error(`Workspace launcher error: ${error.message}`);
  process.exitCode = 1;
});
