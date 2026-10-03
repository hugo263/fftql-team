'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateHistory } = require('../analytics-history');
const source = fs.readFileSync(path.join(__dirname, '../scripts/backfill-league-usage.cjs'), 'utf8');
const target = '/virtual/data/analytics/league-history-v1.json';
function harness() {
  const files = new Map([['/logs/site.log', 'private raw access log']]);
  let writes = 0;
  let result = { version: 1, cutoff: 10000, generatedAt: 11000, internalVisitorIds: [],
    events: [{ type: 'league_use', source: 'access-log-backfill', ts: 9000,
      leagueId: 1, vid: 'a'.repeat(20), backfillId: 'b'.repeat(64) }], diagnostics: { approximate: true } };
  function run(write) {
    let output;
    vm.runInNewContext(source, { __dirname: '/virtual/scripts',
      process: { argv: ['node', 'script', ...(write ? ['--write'] : []), '/logs/site.log'], pid: 777 },
      console: { log: text => { output = JSON.parse(text); } },
      require: name => {
        if (name === '../server') return { buildHistoricalLeagueUsage: logs => {
          assert.equal(logs.length, 1); return structuredClone(result);
        } };
        if (name === '../analytics-history') return { validateHistory };
        if (name === 'node:fs') return {
          existsSync: file => files.has(file), mkdirSync() {},
          readFileSync: (file, encoding) => encoding ? files.get(file) : Buffer.from(files.get(file)),
          writeFileSync(file, text, options) {
            assert.ok(file.startsWith(target), 'only derived history or its backup is writable');
            assert.equal(options.mode, 0o600);
            assert.equal(options.flag, 'wx');
            assert.equal(files.has(file), false);
            files.set(file, text); writes++;
          },
          renameSync(from, to) { assert.equal(to, target); files.set(to, files.get(from)); files.delete(from); },
        };
        return require(name);
      },
    });
    assert.ok(!JSON.stringify(output).includes('private raw'));
    return output;
  }
  return { files, run, writes: () => writes, update: value => { result = value; }, current: () => structuredClone(result) };
}
test('backfill dry-run never writes data; repeated writes with identical source are idempotent', () => {
  const h = harness();
  assert.equal(h.run(false).mode, 'dry-run');
  assert.equal(h.writes(), 0);
  assert.equal(h.run(true).saved, true);
  const first = h.files.get(target);
  assert.equal(h.run(true).saved, false);
  assert.equal(h.files.get(target), first);
  assert.equal(h.writes(), 1);
});
test('backfill preserves prior evidence if logs rotate; new known owner is excluded and prior file backed up', () => {
  const h = harness();
  h.run(true);
  const next = h.current();
  next.events = [];
  h.update(next);
  assert.equal(h.run(true).historicalOpens, 1);
  next.internalVisitorIds = ['a'.repeat(20)];
  h.update(next);
  assert.equal(h.run(true).historicalOpens, 0);
  assert.equal([...h.files.keys()].filter(file => file.includes('.before-')).length, 1);
  assert.equal(h.files.get('/logs/site.log'), 'private raw access log');
});
