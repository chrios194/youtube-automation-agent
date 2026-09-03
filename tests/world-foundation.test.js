const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { encryptObject, decryptObject } = require('../utils/secret-store');
const { loadPortfolio, summarize } = require('../portfolio/control-plane');

const KEY = 'a-very-long-test-master-key-that-is-not-production';

test('secret envelope round trips and never stores plaintext', () => {
  const input = { token: 'super-secret-value', nested: { clientSecret: 'hidden' } };
  const encrypted = encryptObject(input, KEY);
  assert.equal(encrypted.format, 'agenttube-secret-v1');
  assert.equal(JSON.stringify(encrypted).includes('super-secret-value'), false);
  assert.deepEqual(decryptObject(encrypted, KEY), input);
  assert.throws(() => decryptObject(encrypted, `${KEY}-wrong`));
});

test('portfolio validates multiple isolated workspace pods without secret aggregation', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'agenttube-portfolio-'));
  const workspace = path.join(temp, 'workspace.json');
  await fsp.writeFile(workspace, JSON.stringify({ version: 1, workspaceId: 'pod-one', accounts: [{ id: 'creator-one' }, { id: 'creator-two' }] }));
  const portfolio = path.join(temp, 'portfolio.json');
  await fsp.writeFile(portfolio, JSON.stringify({ version: 1, portfolioId: 'world', limits: { maxCreators: 5 }, workspaces: [{ id: 'pod-one', manifest: workspace, vertical: 'education' }] }));
  const config = await loadPortfolio(portfolio, path.join(__dirname, '..'));
  assert.deepEqual(summarize(config), { portfolioId: 'world', workspaceCount: 1, enabledWorkspaceCount: 1, totalAccounts: 2, maxCreators: 5, verticals: ['education'] });
});

const { assertPlatformAction } = require('../utils/platform-capabilities');

test('unsupported platform actions fail closed', () => {
  assert.equal(assertPlatformAction('youtube', 'publish'), true);
  assert.throws(() => assertPlatformAction('tiktok', 'publish'), /not implemented/);
  assert.throws(() => assertPlatformAction('instagram', 'analytics'), /not implemented/);
});
