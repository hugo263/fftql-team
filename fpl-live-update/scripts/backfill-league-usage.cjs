'use strict';

// Run on the website server. Raw access logs and secrets never leave that host.
// Default is dry-run; --write atomically saves derived league events only.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { buildHistoricalLeagueUsage } = require('../server');
const { validateHistory } = require('../analytics-history');

const args = process.argv.slice(2);
const write = args.includes('--write');
const files = args.filter(arg => arg !== '--write');
if (!files.length || files.some(file => !path.isAbsolute(file))) {
  throw new Error('Usage: node scripts/backfill-league-usage.cjs [--write] /absolute/site-access.log [...]');
}
const logs = files.map(file => {
  const bytes = fs.readFileSync(file);
  return (file.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes).toString('utf8');
});
let result = buildHistoricalLeagueUsage(logs);
result = validateHistory(result, result.cutoff);
const output = path.join(__dirname, '../data/analytics/league-history-v1.json');
const priorText = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
if (priorText) {
  const prior = validateHistory(JSON.parse(priorText), result.cutoff);
  result = validateHistory({ ...result,
    events: [...prior.events, ...result.events],
    internalVisitorIds: [...prior.internalVisitorIds, ...result.internalVisitorIds],
  }, result.cutoff);
}
const internal = new Set(result.internalVisitorIds);
// Preserve anonymous historical evidence, but drop identities that newer log
// coverage now proves are internal. Existing raw analytics logs stay untouched.
result.events = result.events.filter(event => !internal.has(event.vid));
result.sourceFiles = [...new Set([...(priorText ? JSON.parse(priorText).sourceFiles || [] : []),
  ...files.map(file => path.basename(file))])].sort();
const stable = value => JSON.stringify({ cutoff: value.cutoff, events: value.events,
  internalVisitorIds: [...value.internalVisitorIds].sort(), sourceFiles: value.sourceFiles });
const changed = !priorText || stable(JSON.parse(priorText)) !== stable(result);
if (write && changed) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (priorText) fs.writeFileSync(`${output}.before-${Date.now()}`, priorText, { flag: 'wx', mode: 0o600 });
  const temporary = `${output}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, output);
}
console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', changed, saved: write && changed,
  cutoff: new Date(result.cutoff).toISOString(), historicalOpens: result.events.length,
  historicalLeagues: new Set(result.events.map(event => event.leagueId)).size,
  earliest: result.events[0] ? new Date(result.events[0].ts).toISOString() : null,
  excludedIdentities: result.internalVisitorIds.length, diagnostics: result.diagnostics,
}, null, 2));
