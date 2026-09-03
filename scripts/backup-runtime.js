#!/usr/bin/env node
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function walk(root, current = root, output = []) {
  for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(root, full, output);
    else if (entry.isFile()) output.push(path.relative(root, full));
  }
  return output;
}

async function main() {
  const args = process.argv.slice(2);
  const sourceArg = args[args.indexOf('--source') + 1];
  const destArg = args[args.indexOf('--destination') + 1];
  if (!sourceArg || !destArg || !args.includes('--source') || !args.includes('--destination')) {
    throw new Error('Usage: node scripts/backup-runtime.js --source <account-runtime-dir> --destination <backup-root>');
  }
  const source = path.resolve(sourceArg);
  const destinationRoot = path.resolve(destArg);
  const stat = await fsp.stat(source);
  if (!stat.isDirectory()) throw new Error('Backup source must be a directory');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(destinationRoot, `${path.basename(source)}-${stamp}`);
  await fsp.mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  await fsp.cp(source, destination, { recursive: true, errorOnExist: true });
  const files = (await walk(destination)).filter(f => f !== 'BACKUP_MANIFEST.json').sort();
  const manifest = { schemaVersion: 1, source, createdAt: new Date().toISOString(), files: {} };
  for (const file of files) manifest.files[file] = await hashFile(path.join(destination, file));
  await fsp.writeFile(path.join(destination, 'BACKUP_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(destination);
}
main().catch(error => { console.error(`Backup failed: ${error.message}`); process.exitCode = 1; });
