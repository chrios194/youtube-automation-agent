const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { assertIsolatedWorkspaceRuntime } = require('./workspace-runtime');

const FORMAT = 'agenttube-secret-v1';

function deriveKey(masterKey) {
  if (!masterKey || masterKey.length < 32) {
    throw new Error('AGENTTUBE_MASTER_KEY must be at least 32 characters');
  }
  return crypto.createHash('sha256').update(masterKey, 'utf8').digest();
}

function encryptObject(value, masterKey) {
  const key = deriveKey(masterKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: FORMAT,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function decryptObject(envelope, masterKey) {
  if (!envelope || envelope.format !== FORMAT) throw new Error('Unsupported AgentTube secret envelope');
  const key = deriveKey(masterKey);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

async function atomicWriteJson(filePath, value, mode = 0o600) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, mode);
}

async function readSecretFile(filePath, masterKey) {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  return parsed?.format === FORMAT ? decryptObject(parsed, masterKey) : parsed;
}

async function writeSecretFile(filePath, value, masterKey) {
  if (!masterKey) throw new Error('AGENTTUBE_MASTER_KEY is required to write encrypted secrets');
  await atomicWriteJson(filePath, encryptObject(value, masterKey));
}

function assertWorkspaceSecretPath(filePath, runtime, masterKey) {
  assertIsolatedWorkspaceRuntime(runtime);
  if (typeof masterKey !== 'string' || masterKey.length < 32) {
    throw new Error('AGENTTUBE_MASTER_KEY must be at least 32 characters for strict workspace secret storage');
  }
  const configRoot = path.resolve(runtime.configDir);
  const target = path.resolve(filePath);
  if (!target.startsWith(`${configRoot}${path.sep}`)) {
    throw new Error('Workspace secret file must remain inside the selected account config directory');
  }
  return target;
}

async function resolveWorkspaceSecretPath(filePath, runtime, masterKey, { createParent = false } = {}) {
  const target = assertWorkspaceSecretPath(filePath, runtime, masterKey);
  const accountRoot = path.resolve(runtime.accountRoot || '');
  const configRoot = path.resolve(runtime.configDir);

  if (!runtime.accountRoot) {
    throw new Error('Workspace secret storage requires an explicit account runtime root');
  }

  const realAccountRoot = await fs.realpath(accountRoot);
  if (realAccountRoot !== accountRoot) {
    throw new Error('Workspace account runtime root must not contain symbolic links');
  }

  if (createParent) {
    await fs.mkdir(configRoot, { recursive: true, mode: 0o700 });
  }
  const realConfigRoot = await fs.realpath(configRoot);
  if (realConfigRoot !== configRoot || !realConfigRoot.startsWith(`${realAccountRoot}${path.sep}`)) {
    throw new Error('Workspace secret config directory must remain inside the selected account runtime directory and must not contain symbolic links');
  }

  const parentPath = path.dirname(target);
  if (createParent) {
    await fs.mkdir(parentPath, { recursive: true, mode: 0o700 });
  }
  const realParent = await fs.realpath(parentPath);
  if (realParent !== parentPath || (realParent !== realConfigRoot && !realParent.startsWith(`${realConfigRoot}${path.sep}`))) {
    throw new Error('Workspace secret parent directory must remain inside the account config directory and must not contain symbolic links');
  }

  let targetStat = null;
  try {
    targetStat = await fs.lstat(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (targetStat?.isSymbolicLink()) {
    throw new Error('Workspace secret file must not be a symbolic link');
  }
  if (targetStat && !targetStat.isFile()) {
    throw new Error('Workspace secret path must be a regular file');
  }
  return target;
}

async function readWorkspaceSecretFile(filePath, runtime, masterKey) {
  const target = await resolveWorkspaceSecretPath(filePath, runtime, masterKey);
  const parsed = JSON.parse(await fs.readFile(target, 'utf8'));
  if (parsed?.format !== FORMAT) {
    throw new Error('Plaintext workspace secret files are rejected; an encrypted AgentTube secret envelope is required');
  }
  return decryptObject(parsed, masterKey);
}

async function writeWorkspaceSecretFile(filePath, value, runtime, masterKey) {
  const target = await resolveWorkspaceSecretPath(filePath, runtime, masterKey, { createParent: true });
  await atomicWriteJson(target, encryptObject(value, masterKey));
}

module.exports = {
  FORMAT,
  encryptObject,
  decryptObject,
  readSecretFile,
  writeSecretFile,
  readWorkspaceSecretFile,
  writeWorkspaceSecretFile,
  atomicWriteJson
};
