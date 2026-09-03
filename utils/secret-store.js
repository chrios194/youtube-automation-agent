const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

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

module.exports = { FORMAT, encryptObject, decryptObject, readSecretFile, writeSecretFile, atomicWriteJson };
