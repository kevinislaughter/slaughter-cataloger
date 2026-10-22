#!/usr/bin/env node
/* Slaughter Cataloger 3 — empty files (DF-19; A2 repair batch): a file whose last record was
   deleted is written with its header row only. The app reads such a file back as an empty file of
   its kind; nothing else changes about what is read. tools/change-titleid.js reads it as the app
   does and carries it forward (DF-21); the converter keeps listing it as not converted.

   usage: node tools/test-empty-files.js        (SC_LIST_CHECKS=1 lists every check)

   - records.readFile without the option (as the converter calls it): a header-only file is still
     "No data rows."
   - records.readFile with { allowEmpty: true } (the app's opening and reconnecting, and
     change-titleid.js): a header-only file is read as an empty file of its kind only when its
     header row is exactly that of one kind as the app writes it (every 3.0 heading in order, then
     extra columns that are no heading of any kind); every other header-only or foreign file stays
     refused.
   - records.buildLibrary: an empty file is taken in only under this library's names, once files
     with rows have said which library it is; an empty Titles or Authorities file never stands in
     for one with rows; an empty file is written back byte for byte.
   - tools/change-titleid.js (DF-21 repair) on invented libraries holding empty files: a valid empty
     file of the library is carried into the output byte for byte (renamed with its title's files),
     no record is invented and no file dropped, and the output opens cleanly; a header-only file
     that is malformed, not UTF-8 or of no bytes still stops the change; one the app does not take
     in (another library's name, a second Titles file) is refused unless --partial-copy, which
     lists it; a file is never renamed onto a name the folder already holds; --out, _issues/, the
     faults and a killed run are as in A3 batch 1; the library folder is never written.
   - tools/convert-to-3.js, unchanged: it lists header-only files as not converted. */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SCx = globalThis.SC, R = SCx.records, S = SCx.schema;
const L = require('./lib/integrity-library')(SCx);

const LIST = process.env.SC_LIST_CHECKS === '1';
let count = 0, fails = 0;
const ok = (cond, what, detail) => {
  count++;
  if (!cond) { fails++; console.log('FAIL ' + what + (detail === undefined ? '' : '\n     ' + JSON.stringify(detail).slice(0, 600))); }
  else if (LIST) console.log('  ok   ' + what);
};
const section = s => { if (LIST) console.log('· ' + s); };

// A header-only file of a kind, exactly as the app writes it (optionally with extra columns it kept).
const SLUG = L.slug;
function emptyText(kind, name, extra) {
  const st = SCx.emptyState();
  st.library = Object.freeze({ slug: SLUG, name: 'Integrity Test Library', note: '' });
  st.files.set(name, { name, kind, extraHeaders: extra || [], hash: '', lastModified: 0, schemaVersion: S.VERSION, setAside: [] });
  return R.writeFile(st, name);
}
const NAMES = { title: L.names.titles, issue: L.names.issues(L.ids.MODEL), content: L.names.contents(L.ids.MODEL), authority: L.names.authorities };
const csvLine = cells => SCx.csv.serialize([cells]);
// writeFile of a file the library does not hold throws; a check then fails instead of stopping the run.
const writes = (state, name) => { try { return R.writeFile(state, name); } catch (e) { return 'ERROR: ' + e.message; } };
const lines = t => SCx.csv.parse(t).rows.filter(r => r.some(v => String(v).trim())).length;

// ── 1. The reader without the option ───────────────────────────────────
section('the reader without the option (as the converter calls it): unchanged');
Object.keys(NAMES).forEach(k => {
  const t = emptyText(k, NAMES[k]);
  ok(lines(t) === 1, k + ': the app writes an emptied file as its header row alone');
  const r = R.readFile(NAMES[k], t, {});
  ok(!r.ok && r.error === 'No data rows.', k + ': without the option it is refused, "No data rows.", as before', r.error);
});

// ── 2. Valid empty files, with the option ──────────────────────────────
section('valid empty files: read as empty files of their kind');
Object.keys(NAMES).forEach(k => {
  const t = emptyText(k, NAMES[k]);
  const r = R.readFile(NAMES[k], t, { allowEmpty: true });
  ok(r.ok && r.empty === true && r.kind === k && r.records.length === 0 && r.extraHeaders.length === 0 && r.librarySlug === '' && r.schemaVersion === S.VERSION,
    k + ': with { allowEmpty: true } it is read as an empty ' + k + ' file: no records, no library named', { ok: r.ok, kind: r.kind, error: r.error });
});
{
  const t = emptyText('issue', NAMES.issue, ['Local Shelf Mark', 'Checked By']);
  const r = R.readFile(NAMES.issue, t, { allowEmpty: true });
  ok(r.ok && r.kind === 'issue' && JSON.stringify(r.extraHeaders) === '["Local Shelf Mark","Checked By"]', 'extra columns the app kept are allowed after the 3.0 headings, and kept', r.extraHeaders);
  const t2 = emptyText('content', NAMES.content) + '\r\n,,,\r\n\r\n';
  const r2 = R.readFile(NAMES.content, t2, { allowEmpty: true });
  ok(r2.ok && r2.kind === 'content' && r2.records.length === 0, 'blank rows after the header carry no data: still an empty file');
}

// ── 3. Header-only files that stay refused ─────────────────────────────
section('header-only files that are not exactly a 3.0 header row stay refused');
const hdr = k => S.entities[k].headers.slice();
// Refused with the option as without it (these were refused before the repair too).
const refused = (what, text, why) => {
  const r = R.readFile(NAMES.issue, text, { allowEmpty: true });
  ok(!r.ok && r.records.length === 0 && (why || /^No data rows\./).test(r.error), what + ': refused', r.error);
};
{
  const r = R.readFile(NAMES.issue, csvLine(hdr('issue').slice(0, 3)), { allowEmpty: true });
  ok(r.error === 'No data rows. Its header row is not exactly that of a Slaughter Cataloger 3.0 file, so it is not read as an empty one.', 'the refusal says why it is not read as an empty file', r.error);
}
refused('an empty file (no bytes)', '', /^Empty file\./);
refused('a foreign CSV with a header and no rows', csvLine(['Name', 'Address', 'Phone']), /^Not a Slaughter Cataloger CSV/);
refused('a header with one 3.0 heading missing', csvLine(hdr('issue').filter(h => h !== 'Volume')));
refused('a header with two headings swapped', csvLine((h => { const x = h.slice(); [x[6], x[7]] = [x[7], x[6]]; return x; })(hdr('issue'))));
refused('a header with a heading misspelled', csvLine(hdr('issue').map(h => (h === 'Volume' ? 'Volumn' : h))));
{
  const ent = S.entities.issue, withAlias = ent.columns.find(c => c.aliases && c.aliases.length);
  refused('a header with a heading in an older name (alias "' + withAlias.aliases[0] + '")', csvLine(hdr('issue').map(h => (h === withAlias.header ? withAlias.aliases[0] : h))));
  refused('a 3.0 header followed by an older name of one of its own columns', csvLine(hdr('issue').concat([withAlias.aliases[0]])));
}
refused('a 3.0 header followed by a blank heading', csvLine(hdr('issue').concat([''])));
refused('the Issues headings followed by the Contents headings', csvLine(hdr('issue').concat(hdr('content').filter(h => hdr('issue').indexOf(h) === -1))));
refused('a header with a heading twice', csvLine(hdr('issue').concat(['Volume'])), /appears twice/);
refused('only the first three headings', csvLine(hdr('issue').slice(0, 3)));
{
  const dir = path.join(ROOT, 'sample-data', 'beta2', 'example-library');
  ['SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_ISSUES.csv', 'SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_CONTENTS.csv'].forEach(n => {
    const head = SCx.csv.parse(fs.readFileSync(path.join(dir, n), 'utf8')).rows[0];
    refused('the header row of a Beta 2 file (' + n.replace(/^SCAT_EXAMPLE-LIBRARY_/, '') + ')', csvLine(head));
  });
  const th = SCx.csv.parse(fs.readFileSync(path.join(dir, 'SCAT_EXAMPLE-LIBRARY_TITLES.csv'), 'utf8')).rows[0];
  ok(JSON.stringify(th.map(h => h.trim())) === JSON.stringify(hdr('title')), 'note: a Beta 2 Titles header row is the same as 3.0\'s, so an empty Titles file\'s version cannot be told (the library-name rules below decide)');
}

// ── 4. Building a library ──────────────────────────────────────────────
section('buildLibrary: where an empty file is taken in');
const read = (files, opt) => Object.keys(files).map(n => R.readFile(n, files[n], opt === undefined ? { allowEmpty: true, lastModified: 1000 } : opt));
// The invented library after one read and write, as the app would save it (its Issues rows leave Date
// Type blank, which the reader reads as "Months"): so every file reads back byte for byte, as
// change-titleid.js's verification requires of the files it does not change.
const base = (() => { const b = R.buildLibrary(read(L.files, {}), {}); return Object.fromEntries(Object.keys(L.files).map(n => [n, R.writeFile(b.state, n)])); })();
ok((() => { const b = R.buildLibrary(read(base, {}), {}); return Object.keys(base).every(n => R.writeFile(b.state, n) === base[n]); })(), 'the invented library, saved once, reads back byte for byte (the starting point below)');
{
  // The Model Weekly's one issue and its contents deleted: its two files emptied.
  const files = Object.assign({}, base, { [NAMES.issue]: emptyText('issue', NAMES.issue), [NAMES.content]: emptyText('content', NAMES.content) });
  const b = R.buildLibrary(read(files), {});
  const problems = b.report.filter(r => r.level !== 'info');
  ok(problems.length === 0 && b.changed.length === 0, 'a library with an emptied Issues and Contents file opens with no warning', problems);
  ok(b.state.files.has(NAMES.issue) && b.state.files.has(NAMES.content) && (b.state.files.get(NAMES.issue) || {}).kind === 'issue', 'both empty files are files of the library (so new records can go into them)');
  ok([NAMES.issue, NAMES.content].every(n => b.report.some(r => r.level === 'info' && r.file === n && /^No rows yet: an empty/.test(r.msg))), 'each gets a note: "No rows yet: an empty … file"');
  ok(b.state.library.slug === SLUG && b.state.library.name === 'Integrity Test Library' && b.state.titles.size === 4 && b.state.issues.size === 6 && b.state.contents.size === 11, 'the library, its titles and every other record read as before');
  ok(writes(b.state, NAMES.issue) === files[NAMES.issue] && writes(b.state, NAMES.content) === files[NAMES.content], 'the empty files are written back byte for byte');
  const b0 = R.buildLibrary(read(files, { lastModified: 1000 }), {});
  ok(b0.report.filter(r => r.level === 'skip').map(r => r.file).sort().join() === [NAMES.content, NAMES.issue].sort().join(), 'read without the option (as the converter reads): the same two files are "not loaded", as before');
  // an empty Authorities file
  const fa = Object.assign({}, base, { [NAMES.authority]: emptyText('authority', NAMES.authority) });
  const ba = R.buildLibrary(read(fa), {});
  ok(ba.state.files.has(NAMES.authority) && ba.state.authorities.size === 0 && ba.report.filter(r => r.level !== 'info').length === 0, 'an emptied Authorities file is taken in, with no headings and no warning');
}
{
  const other = 'SCAT_ANOTHER-LIBRARY_AUTHORITIES.csv';
  const files = Object.assign({}, base, { [other]: emptyText('authority', other) });
  delete files[NAMES.authority];
  const b = R.buildLibrary(read(files), {});
  ok(!b.state.files.has(other) && b.report.some(r => r.level === 'skip' && r.file === other && /its name is not one of this library's \(SCAT_INTEGRITY-TEST_…\)/.test(r.msg)), 'an empty file named for another library is not taken in, and says why', b.report.filter(r => r.file === other));
  const odd = 'Issues copy.csv';
  const b2 = R.buildLibrary(read(Object.assign({}, base, { [odd]: emptyText('issue', odd) })), {});
  ok(!b2.state.files.has(odd) && b2.report.some(r => r.level === 'skip' && r.file === odd), 'an empty file under a name that is not this library\'s (no SCAT_<slug>_ prefix) is not taken in');
  const onlyEmpty = { [NAMES.issue]: emptyText('issue', NAMES.issue), [NAMES.authority]: emptyText('authority', NAMES.authority) };
  const b3 = R.buildLibrary(read(onlyEmpty), {});
  ok(b3.state.files.size === 0 && b3.report.filter(r => r.level === 'skip' && /no file with rows says which library/.test(r.msg)).length === 2, 'with no file that has rows, no empty file is taken in (no library to belong to)', b3.report);
}
{
  // A newer empty Titles file and the real one: the real one is used, whatever the dates.
  const emptyTitles = 'SCAT_INTEGRITY-TEST_TITLES_copy.csv';
  const res = Object.keys(base).map(n => R.readFile(n, base[n], { allowEmpty: true, lastModified: 1000 }))
    .concat([R.readFile(emptyTitles, emptyText('title', emptyTitles), { allowEmpty: true, lastModified: 9999 })]);
  const b = R.buildLibrary(res, {});
  ok(b.state.titles.size === 4 && b.state.library.name === 'Integrity Test Library' && b.state.library.note !== '' && !b.state.files.has(emptyTitles),
    'a newer empty Titles file never stands in for the Titles file with rows: the library keeps its titles, name and note', b.report.filter(r => r.level !== 'info'));
  ok(b.report.some(r => r.level === 'skip' && r.file === emptyTitles && new RegExp('No data rows, and ' + L.names.titles.replace(/[.]/g, '\\.') + ' is the Titles file in use').test(r.msg)), 'the empty one is reported: "No data rows, and … is the Titles file in use. Not loaded."');
  const emptyAuth = 'SCAT_INTEGRITY-TEST_AUTHORITIES_copy.csv';
  const res2 = Object.keys(base).map(n => R.readFile(n, base[n], { allowEmpty: true, lastModified: 1000 }))
    .concat([R.readFile(emptyAuth, emptyText('authority', emptyAuth), { allowEmpty: true, lastModified: 9999 })]);
  const b2 = R.buildLibrary(res2, {});
  ok(b2.state.authorities.size === 3 && !b2.state.files.has(emptyAuth), 'the same for a newer empty Authorities file: the headings are kept');
  // An empty Issues file beside an Issues file with rows for the same title: both taken in, no clash.
  const extra = 'SCAT_INTEGRITY-TEST_SPECLEDX-1875_ISSUES_2.csv';
  const b3 = R.buildLibrary(read(Object.assign({}, base, { [extra]: emptyText('issue', extra) })), {});
  ok(b3.state.files.has(extra) && b3.state.issues.size === 7 && b3.report.filter(r => r.level !== 'info').length === 0, 'an empty Issues file beside one with rows is taken in too, and nothing clashes');
}

// ── 5. change-titleid.js carries valid empty files (DF-21) ─────────────
section('change-titleid.js on libraries holding valid empty files: carried forward (DF-21)');
const so = require('./lib/safe-output');
const crypto = require('crypto');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sc3-empty-')));
const CT = path.join('tools', 'change-titleid.js');
const run = (args, env) => {
  const r = cp.spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { TZ: 'America/New_York', SC_TEST_FAULT: '' }, env || {}) });
  return { status: r.status, signal: r.signal, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
};
const exists = p => { try { fs.lstatSync(p); return true; } catch (e) { return false; } };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function treeHash(p) {
  if (!fs.lstatSync(p).isDirectory()) return 'F:' + sha(fs.readFileSync(p));
  const h = crypto.createHash('sha256');
  (function walk(d, rel) {
    fs.readdirSync(d).sort().forEach(n => {
      const q = path.join(d, n), r = rel + '/' + n, st = fs.lstatSync(q);
      if (st.isSymbolicLink()) h.update('L' + r + '>' + fs.readlinkSync(q) + '\n');
      else if (st.isDirectory()) { h.update('D' + r + '\n'); walk(q, r); }
      else h.update('F' + r + ':' + sha(fs.readFileSync(q)) + '\n');
    });
  })(p, '');
  return h.digest('hex');
}
// A library folder: the invented library saved once, with some files changed (a Buffer is written as
// it is; null leaves a file out).
function makeLib(name, changes, extra) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  const files = Object.assign({}, base, changes || {});
  Object.keys(files).forEach(n => { if (files[n] !== null) fs.writeFileSync(path.join(dir, n), files[n]); });
  if (extra) extra(dir);
  return dir;
}
const csvsOf = dir => fs.readdirSync(dir).filter(n => /\.csv$/i.test(n) && fs.lstatSync(path.join(dir, n)).isFile()).sort();
// What the app reads from a folder (as it opens one: { allowEmpty: true }).
const appRead = dir => {
  const res = csvsOf(dir).map(n => R.readFile(n, fs.readFileSync(path.join(dir, n), 'utf8'), { allowEmpty: true, lastModified: 1000 }));
  return { res, b: R.buildLibrary(res, {}) };
};
const sizes = b => ['titles', 'issues', 'contents', 'authorities'].map(k => b.state[k].size).join('/');
const T = L.ids, MODEL_EMPTY = { [NAMES.issue]: emptyText('issue', NAMES.issue), [NAMES.content]: emptyText('content', NAMES.content) };
const TRIAL_ISSUES = L.names.issues(T.TRIAL), LEDGER_CONTENTS_2 = 'SCAT_' + SLUG + '_' + T.LEDGER + '_CONTENTS_2.csv';
const MIXED = Object.assign({}, MODEL_EMPTY, {
  // an empty Issues file for a title with no issues, with two extra columns, CRLF and a byte-order mark
  [TRIAL_ISSUES]: '﻿' + emptyText('issue', TRIAL_ISSUES, ['Local Shelf Mark', 'Checked By']).replace(/\n/g, '\r\n'),
  // an empty Contents file beside the Ledger's, its header row unquoted
  [LEDGER_CONTENTS_2]: S.entities.content.headers.join(',') + '\n'
});

// A change that must be made: everything checked about its output.
function carried(what, dir, OLD, NEW, opts) {
  opts = opts || {};
  const before = treeHash(dir), out = path.join(tmp, opts.outName || path.basename(dir) + '-out');
  const inputs = csvsOf(dir);
  const isEmpty = n => { const r = R.readFile(n, fs.readFileSync(path.join(dir, n), 'utf8'), { allowEmpty: true }); return r.ok && r.empty; };
  const empties = inputs.filter(isEmpty);
  const renamed = n => n.split(OLD).join(NEW);
  const r = run([CT, dir, OLD, NEW, '--out', out].concat(opts.args || []));
  ok(r.status === 0 && /Verification: passed/.test(r.out), what + ': the change is made and verified', r.all.slice(0, 500));
  ok(treeHash(dir) === before, what + ': the library folder is byte for byte what it was');
  if (r.status !== 0) return { r, out };
  const outCsv = csvsOf(out);
  ok(JSON.stringify(outCsv) === JSON.stringify(inputs.map(renamed).sort()), what + ': the output holds every CSV file of the library, one for one, the title\'s renamed (none dropped, none added)', outCsv);
  ok(empties.length === (opts.empties || 0), what + ': the library holds ' + (opts.empties || 0) + ' valid empty file(s)', empties);
  if (opts.empties) ok(empties.every(n => exists(path.join(out, renamed(n))) && fs.readFileSync(path.join(out, renamed(n))).equals(fs.readFileSync(path.join(dir, n)))),
    what + ': every empty file is carried byte for byte' + (empties.some(n => renamed(n) !== n) ? ', renamed with the title\'s files' : ''), empties);
  // Every file holding no record of the title, empty or not, is written back byte for byte.
  const holdsTitle = n => n === L.names.titles || (!isEmpty(n) && n.indexOf(OLD) !== -1);
  const kept = inputs.filter(n => !holdsTitle(n));
  ok(kept.every(n => fs.readFileSync(path.join(out, renamed(n))).equals(fs.readFileSync(path.join(dir, n)))), what + ': every file holding no record of ' + OLD + ' is byte for byte the input file (' + kept.length + ')', kept);
  const A = appRead(dir), B = appRead(out);
  ok(B.b.report.filter(x => x.level !== 'info').length === 0 && B.b.changed.length === 0, what + ': the app opens the output with no warning and changes nothing on reading', B.b.report.filter(x => x.level !== 'info'));
  ok(sizes(B.b) === sizes(A.b) && B.b.state.files.size === A.b.state.files.size, what + ': the app reads the same records (titles/issues/contents/headings ' + sizes(A.b) + ') and takes in every file', sizes(B.b));
  const outEmpty = B.res.filter(x => x.ok && x.empty).map(x => x.name).sort();
  if (opts.empties) ok(JSON.stringify(outEmpty) === JSON.stringify(empties.map(renamed).sort()) && B.res.filter(x => x.ok && x.empty).every(x => x.records.length === 0 && B.b.state.files.has(x.name)),
    what + ': the empty files are still empty files of the library: no record invented', outEmpty);
  ok(B.b.state.titles.has(NEW) && !B.b.state.titles.has(OLD), what + ': the title is under ' + NEW + ' alone');
  empties.filter(n => renamed(n) !== n).forEach(n => ok(r.out.indexOf('file renamed: ' + n + ' -> ' + renamed(n)) !== -1, what + ': the report names the empty file renamed: ' + n));
  return { r, out };
}

try {
  const A0 = carried('no empty file (the control)', makeLib('A0'), T.LEDGER, 'SPECLEDY-1875');
  const A1 = carried('the Model Weekly\'s Issues and Contents emptied, another title changed', makeLib('A1', MODEL_EMPTY), T.LEDGER, 'SPECLEDY-1875', { empties: 2 });
  ok(A1.r.status === 0 && A0.r.status === 0 && csvsOf(A1.out).filter(n => n.indexOf(T.MODEL) === -1).every(n => fs.readFileSync(path.join(A1.out, n)).equals(fs.readFileSync(path.join(A0.out, n)))),
    'the files with records come out exactly as from the same library without the empty files');
  const A2 = carried('the same library, the title whose files are empty changed', makeLib('A2', MODEL_EMPTY), T.MODEL, 'MODELWKY-1901', { empties: 2 });
  ok(/MODELWKX-1901 -> MODELWKY-1901: 0 issue\(s\), 0 contents item\(s\) re-keyed/.test(A2.r.out) && /General Notes: TitleID changed from MODELWKX-1901 to MODELWKY-1901/.test(A2.r.out),
    'a title with no records left: no record re-keyed, the title record changed and the change recorded in its General Notes', A2.r.out.slice(0, 300));
  carried('the Authorities file emptied', makeLib('A3', { [L.names.authorities]: emptyText('authority', L.names.authorities) }), T.LEDGER, 'SPECLEDY-1875', { empties: 1 });
  carried('mixed: four empty files (extra columns, CRLF and a byte-order mark; unquoted; one beside a file with rows), an empty file\'s title changed', makeLib('A4', MIXED), T.TRIAL, 'TRIALQUY-1890', { empties: 4 });
  carried('the same mixed library, the Ledger changed (its two files with rows and the empty one beside them renamed)', makeLib('A5', MIXED), T.LEDGER, 'SPECLEDY-1875', { empties: 4 });
  const A6 = carried('--partial-copy with nothing to leave out', makeLib('A6', MODEL_EMPTY), T.LEDGER, 'SPECLEDY-1875', { empties: 2, args: ['--partial-copy'] });
  ok(/nothing was left out/.test(A6.r.out) && !exists(path.join(A6.out, 'PARTIAL-COPY.md')), '--partial-copy: a full copy, the empty files in it, and no PARTIAL-COPY.md');

  // ── 6. What stays refused ────────────────────────────────────────────
  section('change-titleid.js: header-only files that are not valid empty files of the library stay refused or listed (DF-21)');
  const refusal = (what, r, o) => {
    ok(r.status === (o.status || 1), what + ': refused, exit status ' + (o.status || 1), r.status + ' ' + r.all.slice(0, 400));
    if (o.says) ok(o.says.test(r.err), what + ': says why', r.err.slice(0, 500));
    if (o.out) ok(o.outBefore ? treeHash(o.out) === o.outBefore : !exists(o.out), what + ': ' + (o.outBefore ? 'the --out that exists is unchanged' : 'nothing at --out'));
    (o.inputs || []).forEach(d => ok(treeHash(d[0]) === d[1], what + ': the library folder is byte for byte what it was'));
  };
  const refuse = (what, dir, OLD, NEW, says, args, env) => {
    const h = treeHash(dir), out = path.join(tmp, path.basename(dir) + '-out' + (args && args.length ? '-p' : ''));
    const r = run([CT, dir, OLD, NEW, '--out', out].concat(args || []), env);
    refusal(what, r, { says, out, inputs: [[dir, h]] });
    return r;
  };
  const missing = S.entities.issue.headers.filter(h => h !== 'Volume');
  const B1 = makeLib('B1', Object.assign({}, MODEL_EMPTY, { [TRIAL_ISSUES]: SCx.csv.serialize([missing]) }));
  const malformed = new RegExp('Not changed: ' + TRIAL_ISSUES.replace(/[.]/g, '\\.') + ': No data rows\\. Its header row is not exactly that of a Slaughter Cataloger 3\\.0 file, so it is not read as an empty one\\.');
  refuse('a header-only file with a 3.0 heading missing (beside two valid empty files)', B1, T.LEDGER, 'SPECLEDY-1875', malformed);
  refuse('the same with --partial-copy: a CSV the reader refuses is never left out silently', B1, T.LEDGER, 'SPECLEDY-1875', malformed, ['--partial-copy']);
  const swapped = (h => { const x = h.slice(); [x[6], x[7]] = [x[7], x[6]]; return x; })(S.entities.issue.headers);
  refuse('a header-only file with two headings swapped', makeLib('B1b', { [TRIAL_ISSUES]: SCx.csv.serialize([swapped]) }), T.LEDGER, 'SPECLEDY-1875', /No data rows\. Its header row is not exactly/);
  const b2head = SCx.csv.parse(fs.readFileSync(path.join(ROOT, 'sample-data', 'beta2', 'example-library', 'SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_ISSUES.csv'), 'utf8')).rows[0];
  refuse('a header-only file with a Beta 2 Issues header row', makeLib('B1c', { [TRIAL_ISSUES]: csvLine(b2head) }), T.LEDGER, 'SPECLEDY-1875', /No data rows\. Its header row is not exactly/);
  refuse('a header-only CSV that is not a Slaughter Cataloger file', makeLib('B1d', { 'contacts.csv': csvLine(['Name', 'Address', 'Phone']) }), T.LEDGER, 'SPECLEDY-1875', /contacts\.csv: Not a Slaughter Cataloger CSV/);
  refuse('a header-only file that is not UTF-8 (a Latin-1 heading)', makeLib('B2', Object.assign({}, MODEL_EMPTY, { [TRIAL_ISSUES]: Buffer.from(SCx.csv.serialize([S.entities.issue.headers.concat(['Notiz für Band'])]), 'latin1') })),
    T.LEDGER, 'SPECLEDY-1875', new RegExp(TRIAL_ISSUES.replace(/[.]/g, '\\.') + ': This file is not UTF-8 text'));
  refuse('a CSV file of no bytes', makeLib('B3', Object.assign({}, MODEL_EMPTY, { [TRIAL_ISSUES]: '' })), T.LEDGER, 'SPECLEDY-1875', new RegExp(TRIAL_ISSUES.replace(/[.]/g, '\\.') + ': Empty file\\.'));
  const OTHER = 'SCAT_ANOTHER-LIBRARY_AUTHORITIES.csv';
  const B4 = makeLib('B4', Object.assign({}, MODEL_EMPTY, { [OTHER]: emptyText('authority', OTHER) }));
  refuse('a valid empty file named for another library', B4, T.LEDGER, 'SPECLEDY-1875', /holds 1 item\(s\) that the output would not include[\s\S]*SCAT_ANOTHER-LIBRARY_AUTHORITIES\.csv — a CSV the app does not load: No data rows, and its name is not one of this library's \(SCAT_INTEGRITY-TEST_…\)/);
  {
    const h = treeHash(B4), out = path.join(tmp, 'B4-partial'), r = run([CT, B4, T.LEDGER, 'SPECLEDY-1875', '--out', out, '--partial-copy']);
    const list = exists(path.join(out, 'PARTIAL-COPY.md')) ? fs.readFileSync(path.join(out, 'PARTIAL-COPY.md'), 'utf8') : '';
    ok(r.status === 0 && /PARTIAL COPY \(--partial-copy\): 1 item\(s\)/.test(r.out) && list.indexOf('| `' + OTHER + '` | a CSV the app does not load: No data rows, and its name is not one of this library') !== -1,
      'with --partial-copy: made, and the other library\'s empty file is listed as left out, in the report and in PARTIAL-COPY.md', r.all.slice(0, 500));
    ok(r.status === 0 && !exists(path.join(out, OTHER)) && [NAMES.issue, NAMES.content].every(n => fs.readFileSync(path.join(out, n)).equals(fs.readFileSync(path.join(B4, n)))),
      'with --partial-copy: that file is not in the output; the library\'s own empty files are, byte for byte');
    ok(treeHash(B4) === h, 'with --partial-copy: the library folder is byte for byte what it was');
  }
  refuse('a valid empty file under a name that is not this library\'s', makeLib('B4b', { 'Issues copy.csv': emptyText('issue', 'Issues copy.csv') }), T.LEDGER, 'SPECLEDY-1875', /Issues copy\.csv — a CSV the app does not load: No data rows, and its name is not one of this library's/);
  refuse('a second, empty Titles file beside the one in use', makeLib('B5', { ['SCAT_' + SLUG + '_TITLES_copy.csv']: emptyText('title', 'SCAT_' + SLUG + '_TITLES_copy.csv') }), T.LEDGER, 'SPECLEDY-1875',
    /SCAT_INTEGRITY-TEST_TITLES_copy\.csv — a CSV the app does not load: No data rows, and SCAT_INTEGRITY-TEST_TITLES\.csv is the Titles file in use/);
  // A file renamed for the new TitleID onto a name the folder already holds.
  const older = (d, n) => fs.utimesSync(path.join(d, n), new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
  const NEWISSUES = L.names.issues('SPECLEDY-1875'), clash = (from, to) => new RegExp(from.replace(/[.]/g, '\\.') + ' would be renamed ' + to.replace(/[.]/g, '\\.') + ', but ' + '[^ ]+' + ' would have that name too[\\s\\S]*one file would take the other\'s place[\\s\\S]*Nothing was written');
  refuse('an empty file already named for the new TitleID (the title\'s Issues file would be renamed onto it)', makeLib('B6', { [NEWISSUES]: emptyText('issue', NEWISSUES) }), T.LEDGER, 'SPECLEDY-1875', clash(L.names.issues(T.LEDGER), NEWISSUES));
  refuse('two empty files: the title\'s own (older) and one already named for the new TitleID (newer)',
    makeLib('B6b', { [TRIAL_ISSUES]: emptyText('issue', TRIAL_ISSUES), [L.names.issues('TRIALQUY-1890')]: emptyText('issue', L.names.issues('TRIALQUY-1890')) }, d => older(d, TRIAL_ISSUES)), T.TRIAL, 'TRIALQUY-1890', clash(TRIAL_ISSUES, L.names.issues('TRIALQUY-1890')));
  refuse('a file with rows already named for the new TitleID (newer than the title\'s own)',
    makeLib('B6c', { [L.names.issues(T.HERALD)]: null, [NEWISSUES]: base[L.names.issues(T.HERALD)] }, d => older(d, L.names.issues(T.LEDGER))), T.LEDGER, 'SPECLEDY-1875', clash(L.names.issues(T.LEDGER), NEWISSUES));
  refuse('an empty file named for the new TitleID in small letters (one name on macOS and Windows disks)', makeLib('B6d', { [NEWISSUES.toLowerCase()]: emptyText('issue', NEWISSUES.toLowerCase()) }), T.LEDGER, 'SPECLEDY-1875',
    new RegExp('would have that name too \\(names are compared ignoring case'));
  refuse('an empty file the app reads but would not write back byte for byte (no final line break)', makeLib('B7', Object.assign({}, MODEL_EMPTY, { [TRIAL_ISSUES]: emptyText('issue', TRIAL_ISSUES).replace(/\n$/, '') })), T.LEDGER, 'SPECLEDY-1875',
    new RegExp('verification failed — ' + TRIAL_ISSUES.replace(/[.]/g, '\\.') + ' holds no record of SPECLEDX-1875 but would not be written back byte for byte'));
  refuse('as a file with rows and no final line break is', makeLib('B7b', { [L.names.issues(T.HERALD)]: base[L.names.issues(T.HERALD)].replace(/\n$/, '') }), T.LEDGER, 'SPECLEDY-1875', /would not be written back byte for byte/);
  refuse('the only Titles file emptied: no title to change', makeLib('B8', { [L.names.titles]: emptyText('title', L.names.titles) }), T.LEDGER, 'SPECLEDY-1875', /SPECLEDX-1875 is not in this library/);

  // ── 7. Protected output, packages and failures ───────────────────────
  section('change-titleid.js on a library holding empty files: the output and package rules unchanged');
  const C = makeLib('C', MODEL_EMPTY), C0 = treeHash(C);
  const atOut = (what, out, says) => {
    const had = exists(out), h = had ? treeHash(out) : null;
    refusal(what, run([CT, C, T.LEDGER, 'SPECLEDY-1875', '--out', out]), { says, out, outBefore: h, inputs: [[C, C0]] });
  };
  fs.mkdirSync(path.join(tmp, 'C1')); fs.writeFileSync(path.join(tmp, 'C1', 'keep.txt'), 'already here\n');
  atOut('--out a folder that exists, holding a file', path.join(tmp, 'C1'), /already exists[\s\S]*Nothing was written/);
  fs.mkdirSync(path.join(tmp, 'C2'));
  atOut('--out an empty folder that exists', path.join(tmp, 'C2'), /already exists/);
  fs.writeFileSync(path.join(tmp, 'C3'), 'a file\n');
  atOut('--out a file that exists', path.join(tmp, 'C3'), /already exists/);
  atOut('--out inside the library folder', path.join(C, 'renamed'), /would be inside/);
  atOut('--out the library folder itself', C, /already exists/);
  fs.symlinkSync(C, path.join(tmp, 'C-link'));
  atOut('--out inside the library through a symbolic link', path.join(tmp, 'C-link', 'renamed'), /would be inside/);
  const P = makeLib('C7', MODEL_EMPTY, d => { fs.mkdirSync(path.join(d, '_issues', T.MODEL), { recursive: true }); fs.writeFileSync(path.join(d, '_issues', T.MODEL, 'placeholder.txt'), 'invented\n'); });
  refuse('a library with _issues/', P, T.LEDGER, 'SPECLEDY-1875', /_issues holds installed issue packages/);
  refuse('a library with _issues/, even with --partial-copy', P, T.LEDGER, 'SPECLEDY-1875', /--partial-copy does not change this/, ['--partial-copy']);
  [['throw-after-write:2', /test fault: stopped after writing 2/], ['verify', /verification was made to fail/], ['before-rename', /stopped before the rename/]].forEach(([fault, says]) => {
    const out = path.join(tmp, 'C-fault-' + fault.replace(/\W/g, ''));
    refusal('the empty files\' title changed, failing on purpose (' + fault + ')', run([CT, C, T.MODEL, 'MODELWKY-1901', '--out', out], { SC_TEST_FAULT: fault }), { says, out, inputs: [[C, C0]] });
    ok(so.leftovers(out).length === 0, fault + ': no .partial- folder left behind');
  });
  const kOut = path.join(tmp, 'C-killed'), rk = run([CT, C, T.MODEL, 'MODELWKY-1901', '--out', kOut], { SC_TEST_FAULT: 'kill-after-write:2' });
  ok(rk.signal === 'SIGKILL' && !exists(kOut) && so.leftovers(kOut).length === 1 && exists(path.join(so.leftovers(kOut)[0], so.MARKER)), 'killed after two files: nothing at --out, only its marked .partial- folder', rk.signal + ' ' + rk.status);
  ok(treeHash(C) === C0, 'killed: the library folder is byte for byte what it was');
  const again = carried('run again after the killed run', C, T.MODEL, 'MODELWKY-1901', { empties: 2, outName: 'C-killed' });
  ok(/left by an interrupted run/.test(again.r.out), 'and it names the folder the killed run left');

  // ── 8. The converter, unchanged ──────────────────────────────────────
  section('convert-to-3.js on a Beta 2 library holding header-only files: unchanged (lists them as not converted)');
  const b2 = path.join(tmp, 'beta2');
  fs.mkdirSync(b2);
  const src = path.join(ROOT, 'sample-data', 'beta2', 'example-library');
  fs.readdirSync(src).forEach(n => fs.copyFileSync(path.join(src, n), path.join(b2, n)));
  const hdrOnly = 'SCAT_EXAMPLE-LIBRARY_EMPTY_CONTENTS.csv';
  fs.writeFileSync(path.join(b2, hdrOnly), SCx.csv.parse(fs.readFileSync(path.join(src, 'SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_CONTENTS.csv'), 'utf8')).rows[0].join(',') + '\n');
  const empty3 = 'SCAT_EXAMPLE-LIBRARY_EMPTY30_ISSUES.csv';
  fs.writeFileSync(path.join(b2, empty3), emptyText('issue', empty3));
  const b20 = treeHash(b2);
  const r3 = run([path.join('tools', 'convert-to-3.js'), b2, '--out', path.join(tmp, 'conv')]);
  const report = (() => { try { return fs.readdirSync(path.join(tmp, 'conv')).map(d => fs.readFileSync(path.join(tmp, 'conv', d, 'CONVERSION-REPORT.md'), 'utf8')).join('\n'); } catch (e) { return ''; } })();
  ok(r3.status === 0 && [hdrOnly, empty3].every(n => report.indexOf(n) !== -1 && /No data rows\./.test(report)), 'convert-to-3.js converts the rest and lists both header-only files under "Not converted" ("No data rows.")', r3.out.slice(-400) + r3.err.slice(0, 300));
  ok(treeHash(b2) === b20, 'convert-to-3.js: the Beta 2 folder is byte for byte what it was');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' empty-file checks' : 'PASSED ' + count + ' empty-file checks');
process.exit(fails ? 1 : 0);
