#!/usr/bin/env node
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
async function hashFile(file) { const hash=crypto.createHash('sha256'); const stream=fs.createReadStream(file); for await (const chunk of stream) hash.update(chunk); return hash.digest('hex'); }
async function main() {
  const backup = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('Usage: node scripts/verify-backup.js <backup-directory>');
  const manifest = JSON.parse(await fsp.readFile(path.join(backup, 'BACKUP_MANIFEST.json'), 'utf8'));
  for (const [file, expected] of Object.entries(manifest.files || {})) {
    const actual = await hashFile(path.join(backup, file));
    if (actual !== expected) throw new Error(`Checksum mismatch: ${file}`);
  }
  console.log(`Verified ${Object.keys(manifest.files || {}).length} files in ${backup}`);
}
main().catch(error => { console.error(`Backup verification failed: ${error.message}`); process.exitCode = 1; });
