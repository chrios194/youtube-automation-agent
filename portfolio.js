#!/usr/bin/env node
const path = require('path');
const { execFileSync } = require('child_process');
const { loadPortfolio, writeSnapshot, summarize } = require('./portfolio/control-plane');

const ROOT = __dirname;
function parseArgs(argv) {
  const [command = 'validate', ...rest] = argv;
  let manifest = path.join(ROOT, 'config', 'portfolio.json');
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--manifest') manifest = path.resolve(rest[++i] || '');
    else throw new Error(`Unknown argument: ${rest[i]}`);
  }
  return { command, manifest };
}

async function main() {
  const { command, manifest } = parseArgs(process.argv.slice(2));
  if (!['validate', 'status', 'snapshot', 'validate-workspaces'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const config = await loadPortfolio(manifest, ROOT);
  if (command === 'validate') {
    console.log(`Portfolio ${config.portfolioId} is valid: ${config.workspaces.length} pods, ${config.totalAccounts} creator accounts.`);
    return;
  }
  if (command === 'status') {
    console.log(JSON.stringify(summarize(config), null, 2));
    return;
  }
  if (command === 'snapshot') {
    console.log(`Wrote ${await writeSnapshot(config)}`);
    return;
  }
  for (const workspace of config.workspaces.filter(w => w.enabled)) {
    execFileSync(process.execPath, ['workspace.js', 'validate', '--manifest', workspace.manifestFile], { cwd: ROOT, stdio: 'inherit' });
  }
  console.log(`Validated ${config.workspaces.filter(w => w.enabled).length} enabled workspace pods.`);
}
main().catch(error => { console.error(`Portfolio control-plane error: ${error.message}`); process.exitCode = 1; });
