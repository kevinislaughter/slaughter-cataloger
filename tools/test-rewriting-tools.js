#!/usr/bin/env node
/* Slaughter Cataloger 3 — the two tools that rewrite a library, tools/change-titleid.js and
   tools/convert-to-3.js (stage A3, batch 1), and their shared helper tools/lib/safe-output.js.

   usage: node tools/test-rewriting-tools.js        (SC_LIST_CHECKS=1 lists every check it passes)

   Every run is on copies of the invented sample library in a temporary folder; nothing under
   sample-data/ is written. Checked:
   - a TitleID change and a conversion still give what they gave before (IDs, parent links, file
     names, the General Notes sentence, byte-for-byte untouched files, the byte-order mark);
   - each refuses an output folder that exists, that is its input, or that lies inside an input
     (directly or through a symbolic link), and a file that is not UTF-8 or cannot be read as it stands;
   - change-titleid.js refuses a library with _issues/, and by default a library holding anything it
     would not carry; --partial-copy makes the catalog-only copy and lists every item left out;
   - a failure while writing, a failed verification, a failure before the rename and a killed run
     leave nothing at --out (a killed run leaves only its marked .partial- folder);
   - after every run, refused or not, the input is byte for byte what it was. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SCx = globalThis.SC, R = SCx.records;
const so = require('./lib/safe-output');

const LIST = process.env.SC_LIST_CHECKS === '1';
let count = 0, fails = 0;
const ok = (cond, what, detail) => {
  count++;
  if (!cond) { fails++; console.log('FAIL ' + what + (detail ? '\n     ' + String(detail).slice(0, 600) : '')); }
  else if (LIST) console.log('  ok   ' + what);
};
const step = s => { if (LIST) console.log('· ' + s); };

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sc3-rewrite-')));
const SAMPLE = path.join(ROOT, 'sample-data', '3.0', 'example-library');
const BETA2 = path.join(ROOT, 'sample-data', 'beta2', 'example-library');
const TWIN = path.join(ROOT, 'sample-data', 'issue-package', 'native');
const CT = path.join(ROOT, 'tools', 'change-titleid.js'), CV = path.join(ROOT, 'tools', 'convert-to-3.js');
const OLD = 'PLABULLX-1961', NEW = 'PLABULLY-1961';
const SAMPLE_HASH = treeHash(SAMPLE), BETA2_HASH = treeHash(BETA2);

// ── Helpers ─────────────────────────────────────────────────────────────
function run(tool, args, env) {
  const r = cp.spawnSync(process.execPath, [tool].concat(args), { cwd: TMP, encoding: 'utf8', env: Object.assign({}, process.env, { TZ: 'America/New_York', SC_TEST_FAULT: '' }, env || {}) });
  return { status: r.status, signal: r.signal, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
}
const exists = p => { try { fs.lstatSync(p); return true; } catch (e) { return false; } };
function treeHash(dir) {
  const h = crypto.createHash('sha256');
  (function walk(d, rel) {
    fs.readdirSync(d).sort().forEach(n => {
      const p = path.join(d, n), r = rel + '/' + n, st = fs.lstatSync(p);
      if (st.isSymbolicLink()) h.update('L' + r + '>' + fs.readlinkSync(p) + '\n');
      else if (st.isDirectory()) { h.update('D' + r + '\n'); walk(p, r); }
      else h.update('F' + r + ':' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') + '\n');
    });
  })(dir, '');
  return h.digest('hex');
}
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const copyDir = (from, name) => { const to = path.join(TMP, name); fs.cpSync(from, to, { recursive: true, preserveTimestamps: true }); return to; };
const lib = name => copyDir(SAMPLE, name);
const leftovers = out => so.leftovers(out);
const csvs = dir => fs.readdirSync(dir).filter(n => /\.csv$/i.test(n)).sort();
function load(dir) {
  const files = csvs(dir).map(n => { const t = so.readText(path.join(dir, n)); return R.readFile(n, t.text, { lastModified: 1, encodingError: t.encodingError }); });
  return { files, built: R.buildLibrary(files, {}) };
}
const rewrite = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')), 'utf8');
const toLatin1 = file => { const t = fs.readFileSync(file, 'utf8').replace('The Demonstration Quarterly', 'The Démonstration Quarterly'); fs.writeFileSync(file, Buffer.from(t, 'latin1')); };
const extraValue = file => rewrite(file, t => { const ls = t.split('\n'); ls[2] = ls[2].replace(/\r$/, '') + ',EXTRA' + (/\r$/.test(ls[2]) ? '\r' : ''); return ls.join('\n'); });
// A refusal: the exit status and the reason; nothing at --out (or the folder that was there, unchanged);
// no temporary folder left beside it; the input exactly as it was.
function refusal(label, res, o) {
  ok(res.status === (o.status || 1), label + ': refused, exit status ' + (o.status || 1), 'status ' + res.status + ' signal ' + res.signal + '\n' + res.all);
  ok(o.says.test(res.all), label + ': the message says why (' + o.says + ')', res.all);
  if (o.outBefore) ok(exists(o.out) && treeHash(o.out) === o.outBefore, label + ': the folder already at --out is unchanged');
  else if (o.out) ok(!exists(o.out), label + ': nothing at --out');
  if (o.out) ok(leftovers(o.out).length === 0, label + ': no temporary folder left beside --out', leftovers(o.out).join(', '));
  o.inputs.forEach(([dir, before]) => ok(treeHash(dir) === before, label + ': ' + path.basename(dir) + ' is byte for byte what it was'));
}
function symlink(target, name) {
  const p = path.join(TMP, name);
  try { fs.symlinkSync(target, p); } catch (e) { /* checked below */ }
  ok(exists(p) && fs.lstatSync(p).isSymbolicLink(), 'a symbolic link can be made for the checks that need one (' + name + ')');
  return p;
}

try {
  // ── A. change-titleid.js: a TitleID change on the sample ──────────────
  step('change-titleid.js: ' + OLD + ' → ' + NEW + ' on the sample library');
  const A = lib('ct-lib'), A0 = treeHash(A), Aout = path.join(TMP, 'ct-out');
  const ra = run(CT, [A, OLD, NEW, '--out', Aout]);
  ok(ra.status === 0, 'the change runs (exit status 0)', ra.all);
  ok(/Verification: passed/.test(ra.out) && /36 issue\(s\), 458 contents item\(s\) re-keyed/.test(ra.out), 'it reports 36 issues and 458 items re-keyed, verified', ra.out);
  ok(/The library folder was not changed/.test(ra.out), 'it says the library folder was not changed');
  ok(treeHash(A) === A0, 'the library folder is byte for byte what it was');
  ok(leftovers(Aout).length === 0, 'no temporary folder is left beside the output');
  const inNames = csvs(A), outNames = fs.readdirSync(Aout).sort();
  ok(JSON.stringify(outNames) === JSON.stringify(inNames.map(n => n.split(OLD).join(NEW)).sort()), 'the output holds the library\'s CSVs, the title\'s two renamed, and nothing else', outNames.join(', '));
  const a = load(A).built, b = load(Aout);
  ok(b.files.every(f => f.ok) && !b.built.changed.length && !b.built.report.some(r => r.level !== 'info'), 'the output reads cleanly in the app: nothing refused, nothing changed on loading, no warnings',
    JSON.stringify(b.built.report.filter(r => r.level !== 'info')).slice(0, 300) + ' changed ' + b.built.changed);
  const bs = b.built.state, as = a.state;
  ok(bs.titles.size === as.titles.size && bs.issues.size === as.issues.size && bs.contents.size === as.contents.size, 'record counts are unchanged (' + bs.titles.size + ' titles, ' + bs.issues.size + ' issues, ' + bs.contents.size + ' items)');
  const tNew = bs.titles.get(NEW);
  ok(!!tNew && !bs.titles.has(OLD), 'the title is under ' + NEW + ' only');
  ok(tNew && tNew.titleCode === 'PLABULLY' && tNew.firstYear === '1961', 'its Title Code and First Year follow the new TitleID');
  ok(tNew && new RegExp('TitleID changed from ' + OLD + ' to ' + NEW + ' on \\d{4}-\\d{2}-\\d{2}; IssueIDs and ContentIDs keep their codes').test(tNew.generalNotes) &&
    tNew.generalNotes.indexOf(as.titles.get(OLD).generalNotes.replace(/\s+$/, '')) === 0, 'General Notes keeps what it said and records the change');
  const oldIssues = Array.from(as.issues.values()).filter(i => i.titleID === OLD), newIssues = Array.from(bs.issues.values()).filter(i => i.titleID === NEW);
  ok(oldIssues.length === 36 && newIssues.length === 36, 'all 36 issues moved to the new TitleID');
  ok(JSON.stringify(oldIssues.map(i => i.issueID.slice(OLD.length)).sort()) === JSON.stringify(newIssues.map(i => i.issueID.slice(NEW.length)).sort()) && newIssues.every(i => i.issueID.indexOf(NEW + '-') === 0),
    'every IssueID keeps its own code under the new prefix');
  const oldItems = Array.from(as.contents.values()).filter(c => c.issueID.indexOf(OLD + '-') === 0), newItems = Array.from(bs.contents.values()).filter(c => c.issueID.indexOf(NEW + '-') === 0);
  ok(oldItems.length === 458 && newItems.length === 458 && newItems.every(c => c.contentID.indexOf(NEW + '-') === 0), 'all 458 items moved, every ContentID under the new prefix');
  const swap = id => (id && id.indexOf(OLD + '-') === 0 ? NEW + id.slice(OLD.length) : id);
  const pairs = items => items.map(c => c.contentID + '>' + (c.parentID || '') + '>' + c.issueID + '>' + c.sequence).sort();
  ok(JSON.stringify(pairs(oldItems.map(c => Object.assign({}, c, { contentID: swap(c.contentID), parentID: swap(c.parentID), issueID: swap(c.issueID) })))) === JSON.stringify(pairs(newItems)),
    'every item keeps its issue, its place and its parent link, under the new IDs');
  ok(newItems.filter(c => c.parentID).every(c => bs.contents.has(c.parentID)) && newItems.some(c => c.parentID), 'every parent link resolves');
  const untouched = inNames.filter(n => n.indexOf(OLD) === -1 && !/_TITLES\.csv$/.test(n));
  ok(untouched.length === 6 && untouched.every(n => sha(path.join(A, n)) === sha(path.join(Aout, n))), 'the files of the other titles are byte for byte the library\'s');
  ['ISSUES', 'CONTENTS'].forEach(k => {
    const from = path.join(A, 'SCAT_EXAMPLE-LIBRARY_' + OLD + '_' + k + '.csv'), to = path.join(Aout, 'SCAT_EXAMPLE-LIBRARY_' + NEW + '_' + k + '.csv');
    // The Issues file also carries the title's Title Code (an inherited title field), which follows the TitleID.
    ok(fs.readFileSync(to, 'utf8') === fs.readFileSync(from, 'utf8').split(OLD).join(NEW).split('"PLABULLX"').join('"PLABULLY"'), 'the title\'s ' + k + ' file is the library\'s with only the TitleID (and Title Code) changed, its layout kept');
  });
  const ti = SCx.csv.parse(fs.readFileSync(path.join(A, 'SCAT_EXAMPLE-LIBRARY_TITLES.csv'), 'utf8')).rows, to = SCx.csv.parse(fs.readFileSync(path.join(Aout, 'SCAT_EXAMPLE-LIBRARY_TITLES.csv'), 'utf8')).rows;
  ok(ti.length === to.length && ti.every((r, k) => r.indexOf(OLD) !== -1 || JSON.stringify(r) === JSON.stringify(to[k])), 'in the Titles file, every other row is unchanged');
  ok(b.built.state.files.size === outNames.length && Array.from(b.built.state.files.keys()).every(n => R.writeFile(b.built.state, n) === so.readText(path.join(Aout, n)).text),
    'saving the output again in the app would write every file exactly as it is');
  ok(/still mentions PLABULLX-1961[\s\S]*General Notes/.test(ra.out), 'text that still mentions the old TitleID is listed for review');

  // ── B. The byte-order mark ────────────────────────────────────────────
  step('change-titleid.js keeps a byte-order mark where a file has one');
  const Bl = lib('ct-bom'), Bout = path.join(TMP, 'ct-bom-out');
  ['SCAT_EXAMPLE-LIBRARY_TITLES.csv', 'SCAT_EXAMPLE-LIBRARY_' + OLD + '_ISSUES.csv'].forEach(n => rewrite(path.join(Bl, n), t => '﻿' + t));
  const B0 = treeHash(Bl), rb = run(CT, [Bl, OLD, NEW, '--out', Bout]);
  const head3 = n => Array.from(fs.readFileSync(path.join(Bout, n)).subarray(0, 3)).join(',');
  ok(rb.status === 0, 'a library whose files start with a byte-order mark is changed', rb.all);
  ok(head3('SCAT_EXAMPLE-LIBRARY_TITLES.csv') === '239,187,191' && head3('SCAT_EXAMPLE-LIBRARY_' + NEW + '_ISSUES.csv') === '239,187,191', 'the files that had a byte-order mark keep it');
  ok(head3('SCAT_EXAMPLE-LIBRARY_' + NEW + '_CONTENTS.csv') !== '239,187,191', 'a file without one is not given one');
  ok(treeHash(Bl) === B0, 'the library folder is byte for byte what it was');

  // ── C. change-titleid.js refusals ─────────────────────────────────────
  step('change-titleid.js: output folders it must not write to');
  const C = lib('ct-refuse'), C0 = treeHash(C), keep = [[C, C0]];
  // (A folder's state is taken before the run: arguments are evaluated after run() returns.)
  const eOut = path.join(TMP, 'ct-existing-empty'); fs.mkdirSync(eOut); const eOut0 = treeHash(eOut);
  refusal('--out exists (an empty folder)', run(CT, [C, OLD, NEW, '--out', eOut]), { out: eOut, outBefore: eOut0, says: /already exists/, inputs: keep });
  const fOut = path.join(TMP, 'ct-existing-full'); fs.mkdirSync(fOut); fs.writeFileSync(path.join(fOut, 'keep.txt'), 'a file that was already there\n'); const fOut0 = treeHash(fOut);
  refusal('--out exists (holding a file)', run(CT, [C, OLD, NEW, '--out', fOut]), { out: fOut, outBefore: fOut0, says: /already exists/, inputs: keep });
  const fileOut = path.join(TMP, 'ct-existing-file'); fs.writeFileSync(fileOut, 'a file\n');
  refusal('--out is a file', run(CT, [C, OLD, NEW, '--out', fileOut]), { says: /already exists/, inputs: keep });
  ok(fs.readFileSync(fileOut, 'utf8') === 'a file\n', '--out is a file: the file is unchanged');
  refusal('--out is the library folder itself', run(CT, [C, OLD, NEW, '--out', C]), { says: /already exists/, inputs: keep });
  refusal('--out inside the library folder', run(CT, [C, OLD, NEW, '--out', path.join(C, 'renamed')]), { out: path.join(C, 'renamed'), says: /inside/, inputs: keep });
  refusal('--out deeper inside the library folder', run(CT, [C, OLD, NEW, '--out', path.join(C, 'a', 'b')]), { out: path.join(C, 'a'), says: /inside/, inputs: keep });
  const link = symlink(C, 'ct-link-to-lib');
  refusal('--out inside the library through a symbolic link', run(CT, [C, OLD, NEW, '--out', path.join(link, 'renamed')]), { out: path.join(C, 'renamed'), says: /inside/, inputs: keep });
  refusal('the library given through a symbolic link, --out inside it', run(CT, [link, OLD, NEW, '--out', path.join(C, 'renamed2')]), { out: path.join(C, 'renamed2'), says: /inside/, inputs: keep });

  step('change-titleid.js: libraries it must not change');
  const P = lib('ct-packages'); fs.cpSync(TWIN, path.join(P, '_issues', 'EXAGAZEX-1872', 'EXAGAZEX-1872-KRNYWA2'), { recursive: true });
  const P0 = treeHash(P);
  refusal('a library with _issues/', run(CT, [P, OLD, NEW, '--out', path.join(TMP, 'ct-p-out')]), { out: path.join(TMP, 'ct-p-out'), says: /_issues[\s\S]*not supported/, inputs: [[P, P0]] });
  refusal('a library with _issues/, even with --partial-copy', run(CT, [P, OLD, NEW, '--out', path.join(TMP, 'ct-p-out'), '--partial-copy']), { out: path.join(TMP, 'ct-p-out'), says: /_issues[\s\S]*--partial-copy does not change this/, inputs: [[P, P0]] });
  const U = lib('ct-not-utf8'); toLatin1(path.join(U, 'SCAT_EXAMPLE-LIBRARY_TITLES.csv')); const U0 = treeHash(U);
  const ru = run(CT, [U, OLD, NEW, '--out', path.join(TMP, 'ct-u-out')]);
  refusal('a Titles file that is not UTF-8', ru, { out: path.join(TMP, 'ct-u-out'), says: /SCAT_EXAMPLE-LIBRARY_TITLES\.csv: This file is not UTF-8 text/, inputs: [[U, U0]] });
  const M = lib('ct-malformed'); extraValue(path.join(M, 'SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_ISSUES.csv')); const M0 = treeHash(M);
  refusal('a file with a row of too many values', run(CT, [M, OLD, NEW, '--out', path.join(TMP, 'ct-m-out')]), { out: path.join(TMP, 'ct-m-out'), says: /DEMQUARX-1995_ISSUES\.csv: Row 3 has/, inputs: [[M, M0]] });
  const N = lib('ct-unclean');
  { const f = path.join(N, 'SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_CONTENTS.csv'), p = SCx.csv.parse(fs.readFileSync(f, 'utf8')), ci = p.rows[0].indexOf('ContentID');
    p.rows[1][ci] = ''; fs.writeFileSync(f, SCx.csv.serialize(p.rows, p.style), 'utf8'); }
  const N0 = treeHash(N);
  refusal('a library not cleanly saved as 3.0 (an item without a ContentID)', run(CT, [N, OLD, NEW, '--out', path.join(TMP, 'ct-n-out')]), { out: path.join(TMP, 'ct-n-out'), says: /not cleanly saved/, inputs: [[N, N0]] });
  refusal('a new TitleID that is not valid', run(CT, [C, OLD, 'BADID', '--out', path.join(TMP, 'ct-x1')]), { out: path.join(TMP, 'ct-x1'), says: /not a valid TitleID/, inputs: keep });
  refusal('a new TitleID that already exists', run(CT, [C, OLD, 'SAMREVIX-1990', '--out', path.join(TMP, 'ct-x2')]), { out: path.join(TMP, 'ct-x2'), says: /SAMREVIX-1990 already exists/, inputs: keep });
  refusal('a Title Code another title uses', run(CT, [C, OLD, 'SAMREVIX-1961', '--out', path.join(TMP, 'ct-x3')]), { out: path.join(TMP, 'ct-x3'), says: /Title Code SAMREVIX is used by SAMREVIX-1990/, inputs: keep });
  refusal('an old TitleID that is not in the library', run(CT, [C, 'NOPEXXXX-1900', NEW, '--out', path.join(TMP, 'ct-x4')]), { out: path.join(TMP, 'ct-x4'), says: /NOPEXXXX-1900 is not in this library/, inputs: keep });
  refusal('no --out', run(CT, [C, OLD, NEW]), { status: 2, says: /usage/, inputs: keep });
  refusal('an unknown option', run(CT, [C, OLD, NEW, '--out', path.join(TMP, 'ct-x5'), '--force']), { status: 2, out: path.join(TMP, 'ct-x5'), says: /usage/, inputs: keep });
  refusal('a library folder that does not exist', run(CT, [path.join(TMP, 'no-such-lib'), OLD, NEW, '--out', path.join(TMP, 'ct-x6')]), { status: 2, out: path.join(TMP, 'ct-x6'), says: /not a folder that can be read/, inputs: keep });

  // ── D. Items the output would not carry ───────────────────────────────
  step('change-titleid.js: anything besides the catalog CSVs stops the change unless --partial-copy is given');
  const X = lib('ct-aux');
  fs.writeFileSync(path.join(X, 'README.txt'), 'notes kept with the library\n');
  fs.mkdirSync(path.join(X, '_backups', '20261001-120000-abcd1234'), { recursive: true });
  fs.copyFileSync(path.join(SAMPLE, 'SCAT_EXAMPLE-LIBRARY_TITLES.csv'), path.join(X, '_backups', '20261001-120000-abcd1234', 'SCAT_EXAMPLE-LIBRARY_TITLES.csv'));
  fs.writeFileSync(path.join(X, '.DS_Store'), Buffer.from([0, 0, 0, 1, 66, 117, 100, 49]));
  const older = path.join(X, 'SCAT_EXAMPLE-LIBRARY_' + OLD + '_ISSUES_old-copy.csv');
  fs.copyFileSync(path.join(SAMPLE, 'SCAT_EXAMPLE-LIBRARY_' + OLD + '_ISSUES.csv'), older); fs.utimesSync(older, new Date('2020-01-01'), new Date('2020-01-01'));
  fs.mkdirSync(path.join(X, 'notes')); fs.writeFileSync(path.join(X, 'notes', 'todo.txt'), 'x\n');
  try { fs.symlinkSync('README.txt', path.join(X, 'readme-link')); } catch (e) { /* checked by the listing below */ }
  const X0 = treeHash(X), Xitems = ['README.txt', '_backups/', '.DS_Store', path.basename(older), 'notes/', 'readme-link'];
  const rx = run(CT, [X, OLD, NEW, '--out', path.join(TMP, 'ct-aux-out')]);
  refusal('by default, a library folder holding other items', rx, { out: path.join(TMP, 'ct-aux-out'), says: /holds 6 item\(s\) that the output would not include[\s\S]*--partial-copy/, inputs: [[X, X0]] });
  Xitems.forEach(n => ok(rx.err.indexOf('  - ' + n + ' — ') !== -1, 'the refusal lists ' + n, rx.err));
  ok(/older copy|Older copy/.test(rx.err) && /backup copies/.test(rx.err) && /operating-system file/.test(rx.err) && /symbolic link/.test(rx.err), 'and says what each item is');
  const Xout = path.join(TMP, 'ct-aux-partial');
  const rp = run(CT, [X, OLD, NEW, '--out', Xout, '--partial-copy']);
  ok(rp.status === 0, '--partial-copy: the catalog-only copy is made', rp.all);
  ok(/PARTIAL COPY \(--partial-copy\): 6 item\(s\) of the library folder were NOT copied/.test(rp.out) && Xitems.every(n => rp.out.indexOf('  - ' + n + ' — ') !== -1), '--partial-copy: the report lists every item left out', rp.out);
  const partialList = exists(path.join(Xout, 'PARTIAL-COPY.md')) ? fs.readFileSync(path.join(Xout, 'PARTIAL-COPY.md'), 'utf8') : '';
  ok(/^# A partial copy/.test(partialList) && Xitems.every(n => partialList.indexOf('| `' + n + '` |') !== -1), '--partial-copy: PARTIAL-COPY.md in the output lists every item left out', partialList);
  ok(JSON.stringify(fs.readdirSync(Xout).sort()) === JSON.stringify(outNames.concat('PARTIAL-COPY.md').sort()), '--partial-copy: the output holds the catalog CSVs and PARTIAL-COPY.md, nothing else');
  ok(outNames.every(n => sha(path.join(Xout, n)) === sha(path.join(Aout, n))), '--partial-copy: its CSVs are exactly those of the change on the plain library');
  ok(treeHash(X) === X0, '--partial-copy: the library folder is byte for byte what it was');
  const Y = lib('ct-partial-nothing'), Yout = path.join(TMP, 'ct-partial-nothing-out'), ry = run(CT, [Y, OLD, NEW, '--out', Yout, '--partial-copy']);
  ok(ry.status === 0 && /nothing was left out/.test(ry.out) && !exists(path.join(Yout, 'PARTIAL-COPY.md')), '--partial-copy with nothing to leave out: a full copy, and no PARTIAL-COPY.md', ry.all);

  // ── E. Failures and interruptions ─────────────────────────────────────
  step('change-titleid.js: a failure at any point leaves nothing at --out');
  const F = lib('ct-faults'), F0 = treeHash(F);
  [['throw-after-write:3', 'an error after three files are written', /test fault: stopped after writing 3/],
   ['verify', 'a failed verification', /verification was made to fail/],
   ['before-rename', 'an error just before the rename', /stopped before the rename/]].forEach(([fault, what, says]) => {
    const out = path.join(TMP, 'ct-fault-' + fault.replace(/\W/g, ''));
    const r = run(CT, [F, OLD, NEW, '--out', out], { SC_TEST_FAULT: fault });
    refusal(what, r, { out, says, inputs: [[F, F0]] });
    ok(/Nothing was written/.test(r.err), what + ': the message says nothing was written');
  });
  const deep = path.join(TMP, 'ct-new-parent', 'inner', 'out');
  refusal('an error when --out\'s parent folders had to be made', run(CT, [F, OLD, NEW, '--out', deep], { SC_TEST_FAULT: 'throw-after-write:1' }), { out: path.join(TMP, 'ct-new-parent'), says: /stopped after writing 1/, inputs: [[F, F0]] });
  const deep2 = path.join(TMP, 'ct-new-parent2', 'inner', 'out');
  ok(run(CT, [F, OLD, NEW, '--out', deep2]).status === 0 && exists(path.join(deep2, 'SCAT_EXAMPLE-LIBRARY_TITLES.csv')), 'parent folders of --out that do not exist are made when the change succeeds');
  const kOut = path.join(TMP, 'ct-killed'), rk = run(CT, [F, OLD, NEW, '--out', kOut], { SC_TEST_FAULT: 'kill-after-write:3' });
  ok(rk.signal === 'SIGKILL', 'a run killed after three files are written stops there', rk.signal + ' ' + rk.status);
  ok(!exists(kOut), 'killed: nothing at --out');
  const kl = leftovers(kOut);
  ok(kl.length === 1 && exists(path.join(kl[0], so.MARKER)) && /never finished/.test(fs.readFileSync(path.join(kl[0], so.MARKER), 'utf8')), 'killed: only its .partial- folder is left, marked INCOMPLETE.txt', kl.join(', '));
  ok(treeHash(F) === F0, 'killed: the library folder is byte for byte what it was');
  const rk2 = run(CT, [F, OLD, NEW, '--out', kOut]);
  ok(rk2.status === 0 && rk2.out.indexOf(path.basename(kl[0] || 'none')) !== -1 && /left by an interrupted run/.test(rk2.out), 'run again to the same --out: it succeeds and names the folder the killed run left', rk2.all);
  ok(outNames.every(n => sha(path.join(kOut, n)) === sha(path.join(Aout, n))), 'and its output is the same as an uninterrupted run\'s');

  // ── F. convert-to-3.js: the Beta 2 sample ─────────────────────────────
  step('convert-to-3.js: the Beta 2 sample');
  const G = copyDir(path.dirname(BETA2), 'cv-in'), G0 = treeHash(G), Gout = path.join(TMP, 'cv-out');
  const rg = run(CV, [G, '--out', Gout]);
  ok(rg.status === 0, 'the conversion runs (exit status 0)', rg.all);
  ok(/verification: passed; 25 record\(s\) differ between copies/.test(rg.out), 'it reports its verification passed, with the 25 records that differ between dated copies', rg.out);
  ok(treeHash(G) === G0, 'the input folder is byte for byte what it was');
  ok(leftovers(Gout).length === 0, 'no temporary folder is left beside the output');
  const gl = path.join(Gout, 'EXAMPLE-LIBRARY');
  ok(JSON.stringify(fs.readdirSync(Gout)) === '["EXAMPLE-LIBRARY"]' && JSON.stringify(fs.readdirSync(gl).sort()) === JSON.stringify(csvs(SAMPLE).concat('CONVERSION-REPORT.md').sort()),
    'the output holds the library\'s nine files and its report', fs.readdirSync(gl).join(', '));
  const g = load(gl);
  ok(g.files.every(f => f.ok) && !g.built.changed.length && g.built.state.titles.size === 5 && g.built.state.issues.size === 371 && g.built.state.contents.size === 2578, 'it reads cleanly in the app: 5 titles, 371 issues, 2,578 items');
  const s3 = load(SAMPLE).built.state;
  ok(['SCAT_EXAMPLE-LIBRARY_TITLES.csv'].concat(csvs(SAMPLE).filter(n => /_ISSUES\.csv$/.test(n))).every(n => { const x = R.writeFile(g.built.state, n), y = R.writeFile(s3, n); return x === y; }),
    'its Titles and Issues files are those of the 3.0 sample');
  ok(/## Not converted\n\nNothing: every file under the inputs was read and converted\./.test(fs.readFileSync(path.join(gl, 'CONVERSION-REPORT.md'), 'utf8')), 'its report says nothing was left unconverted');

  // ── G. convert-to-3.js refusals ───────────────────────────────────────
  step('convert-to-3.js: output folders it must not write to, and inputs it must not convert');
  const K = [[G, G0]];
  const gE = path.join(TMP, 'cv-existing-empty'); fs.mkdirSync(gE); const gE0 = treeHash(gE), Gout0 = treeHash(Gout);
  refusal('--out exists (an empty folder)', run(CV, [G, '--out', gE]), { out: gE, outBefore: gE0, says: /already exists/, inputs: K });
  refusal('--out holds an earlier conversion', run(CV, [G, '--out', Gout]), { out: Gout, outBefore: Gout0, says: /already exists/, inputs: K });
  refusal('--out is the input folder', run(CV, [G, '--out', G]), { says: /already exists/, inputs: K });
  refusal('--out inside the input folder', run(CV, [G, '--out', path.join(G, 'converted')]), { out: path.join(G, 'converted'), says: /inside/, inputs: K });
  refusal('--out inside the folder of an input file', run(CV, [path.join(G, 'example-library', 'SCAT_EXAMPLE-LIBRARY_TITLES.csv'), '--out', path.join(G, 'example-library', 'x')]),
    { out: path.join(G, 'example-library', 'x'), says: /inside/, inputs: K });
  const glink = symlink(G, 'cv-link-to-in');
  refusal('--out inside the input through a symbolic link', run(CV, [G, '--out', path.join(glink, 'converted')]), { out: path.join(G, 'converted'), says: /inside/, inputs: K });
  const GU = copyDir(path.dirname(BETA2), 'cv-not-utf8'); toLatin1(path.join(GU, 'example-library', 'SCAT_EXAMPLE-LIBRARY_TITLES.csv')); const GU0 = treeHash(GU);
  refusal('a Beta 2 file that is not UTF-8', run(CV, [GU, '--out', path.join(TMP, 'cv-u-out')]), { out: path.join(TMP, 'cv-u-out'), says: /is not UTF-8 text[\s\S]*SCAT_EXAMPLE-LIBRARY_TITLES\.csv/, inputs: [[GU, GU0]] });
  const GM = copyDir(path.dirname(BETA2), 'cv-malformed'); extraValue(path.join(GM, 'example-library', 'SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_ISSUES.csv')); const GM0 = treeHash(GM);
  refusal('a Beta 2 file with a row of too many values', run(CV, [GM, '--out', path.join(TMP, 'cv-m-out')]), { out: path.join(TMP, 'cv-m-out'), says: /cannot be read as they stand[\s\S]*DEMQUARX-1995_ISSUES\.csv — Row 3 has/, inputs: [[GM, GM0]] });
  const GQ = copyDir(path.dirname(BETA2), 'cv-quote'); fs.appendFileSync(path.join(GQ, 'example-library', 'SCAT_EXAMPLE-LIBRARY_PLABULLX-1961_ISSUES.csv'), '"a quote never closed\n'); const GQ0 = treeHash(GQ);
  refusal('a Beta 2 file with a quote never closed', run(CV, [GQ, '--out', path.join(TMP, 'cv-q-out')]), { out: path.join(TMP, 'cv-q-out'), says: /cannot be read as they stand[\s\S]*PLABULLX-1961_ISSUES\.csv — /, inputs: [[GQ, GQ0]] });
  refusal('no --out', run(CV, [G]), { status: 2, says: /usage/, inputs: K });
  refusal('an input that does not exist', run(CV, [path.join(TMP, 'no-such-input'), '--out', path.join(TMP, 'cv-x1')]), { status: 2, out: path.join(TMP, 'cv-x1'), says: /cannot be read/, inputs: K });

  // ── H. What is not converted is listed ────────────────────────────────
  step('convert-to-3.js: everything under the inputs that is not converted is listed');
  const H = copyDir(path.dirname(BETA2), 'cv-extras');
  fs.writeFileSync(path.join(H, 'README.txt'), 'notes\n'); fs.mkdirSync(path.join(H, '_backups')); fs.writeFileSync(path.join(H, '_backups', 'x.csv'), 'a,b\n');
  fs.writeFileSync(path.join(H, '.DS_Store'), 'x'); fs.writeFileSync(path.join(H, 'other.csv'), 'a,b\n1,2\n');
  fs.mkdirSync(path.join(H, 'misc')); fs.writeFileSync(path.join(H, 'misc', 'scan.jpg'), 'not really a picture\n');
  const H0 = treeHash(H), Hout = path.join(TMP, 'cv-extras-out'), rh = run(CV, [H, '--out', Hout]);
  ok(rh.status === 0 && /verification: passed/.test(rh.out), 'the library is converted', rh.all);
  const Hitems = ['README.txt', '_backups/', '.DS_Store', 'other.csv', path.join('misc', 'scan.jpg')];
  const hrep = exists(path.join(Hout, 'EXAMPLE-LIBRARY', 'CONVERSION-REPORT.md')) ? fs.readFileSync(path.join(Hout, 'EXAMPLE-LIBRARY', 'CONVERSION-REPORT.md'), 'utf8') : '';
  Hitems.forEach(n => {
    ok(rh.out.indexOf('  not converted: ' + n + ' — ') !== -1, 'listed on screen as not converted: ' + n, rh.out);
    ok(hrep.indexOf('- `' + n + '` — ') !== -1, 'listed in CONVERSION-REPORT.md as not converted: ' + n);
  });
  ok(JSON.stringify(fs.readdirSync(path.join(Hout, 'EXAMPLE-LIBRARY')).sort()) === JSON.stringify(fs.readdirSync(gl).sort()), 'none of them is in the output');
  ok(treeHash(H) === H0, 'the input folder is byte for byte what it was');

  step('convert-to-3.js: two set-aside copies of the same name each keep their own copy in _left-out/');
  { const L = copyDir(path.dirname(BETA2), 'cv-leftout'), name = 'SCAT_EXAMPLE-LIBRARY_GAZETTE_ISSUES_v2-0_20240115.csv';
    ['one', 'two'].forEach((sub, k) => {
      fs.mkdirSync(path.join(L, sub));
      const t = fs.readFileSync(path.join(BETA2, name), 'utf8').replace(/\n+$/, '').split('\n');
      t.push(t[t.length - 1].replace(/"EXAGAZEX-1872-K[A-Z0-9]+"/, '"EXAGAZEX-1872-KZZZZZ' + (k + 1) + '"'));
      fs.writeFileSync(path.join(L, sub, name), t.join('\n') + '\n', 'utf8');
      fs.utimesSync(path.join(L, sub, name), new Date('2020-01-01'), new Date('2020-01-01'));
    });
    const L0 = treeHash(L), Lout = path.join(TMP, 'cv-leftout-out'), rl = run(CV, [L, '--out', Lout]);
    const lo = path.join(Lout, 'EXAMPLE-LIBRARY', '_left-out'), los = exists(lo) ? fs.readdirSync(lo).sort() : [];
    ok(rl.status === 0 && /2 set aside/.test(rl.out), 'the conversion sets aside the one record each older copy alone holds', rl.all);
    ok(JSON.stringify(los) === JSON.stringify([name, name.replace(/\.csv$/, '-2.csv')].sort()), 'each copy keeps its own file in _left-out/, the second named -2', los.join(', '));
    const held = los.map(n => fs.readFileSync(path.join(lo, n), 'utf8'));
    ok(held.some(t => t.indexOf('KZZZZZ1') !== -1) && held.some(t => t.indexOf('KZZZZZ2') !== -1), 'neither set-aside record is lost');
    ok(treeHash(L) === L0, 'the input folder is byte for byte what it was');
  }

  // ── I. convert-to-3.js failures and interruptions ─────────────────────
  step('convert-to-3.js: a failure at any point leaves nothing at --out');
  [['throw-after-write:2', 'an error after two files are written', /test fault: stopped after writing 2/],
   ['verify', 'a failed verification', /verification was made to fail/],
   ['before-rename', 'an error just before the rename', /stopped before the rename/]].forEach(([fault, what, says]) => {
    const out = path.join(TMP, 'cv-fault-' + fault.replace(/\W/g, ''));
    const r = run(CV, [G, '--out', out], { SC_TEST_FAULT: fault });
    refusal('convert-to-3.js, ' + what, r, { out, says, inputs: K });
  });
  const cvk = path.join(TMP, 'cv-killed'), rck = run(CV, [G, '--out', cvk], { SC_TEST_FAULT: 'kill-after-write:2' });
  ok(rck.signal === 'SIGKILL' && !exists(cvk) && leftovers(cvk).length === 1 && exists(path.join(leftovers(cvk)[0], so.MARKER)), 'convert-to-3.js, killed: nothing at --out, only its marked .partial- folder');
  ok(treeHash(G) === G0, 'convert-to-3.js, killed: the input folder is byte for byte what it was');

  // ── J. The helper ─────────────────────────────────────────────────────
  step('tools/lib/safe-output.js');
  const thrown = fn => { try { fn(); return null; } catch (e) { return e; } };
  ok((thrown(() => so.checkOutput(path.join(TMP, 'cv-out'), [G])) || {}).code === 'exists', 'checkOutput: refuses a folder that exists');
  ok((thrown(() => so.checkOutput(path.join(G, 'x', 'y'), [G])) || {}).code === 'inside', 'checkOutput: refuses a folder inside an input');
  ok(thrown(() => so.checkOutput(path.join(TMP, 'fresh-out'), [G])) === null, 'checkOutput: accepts a new folder outside the inputs');
  fs.writeFileSync(path.join(TMP, 'a-file'), 'x\n');
  ok((thrown(() => so.checkOutput(path.join(TMP, 'a-file', 'out'), [G])) || {}).code === 'path', 'checkOutput: refuses a folder that cannot be made (a file where a folder would be)');
  ok(so.realPath(path.join(glink, 'not', 'yet')) === path.join(G, 'not', 'yet'), 'realPath: a link above a path that does not exist yet is resolved');
  const tf = path.join(TMP, 'enc.csv');
  fs.writeFileSync(tf, Buffer.from([0xEF, 0xBB, 0xBF, 0x61, 0x2C, 0xC3, 0xA9, 0x0A]));
  ok(so.readText(tf).text === '﻿a,é\n' && !so.readText(tf).encodingError, 'readText: valid UTF-8 is read as it is, the byte-order mark kept as its first character');
  fs.writeFileSync(tf, Buffer.from('𝔉𝔯𝔞𝔨𝔱𝔲𝔯, Pérez\n', 'utf8'));
  ok(so.readText(tf).text === '𝔉𝔯𝔞𝔨𝔱𝔲𝔯, Pérez\n', 'readText: letters outside the Basic Multilingual Plane and accents are read as they are');
  [[[0x43, 0x61, 0x66, 0xE9, 0x0A], 'Windows-1252 é'], [[0x61, 0xC3], 'a sequence cut short'], [[0xC0, 0xAF], 'an overlong encoding'], [[0xED, 0xA0, 0x80], 'an encoded surrogate']].forEach(([bytes, what]) => {
    fs.writeFileSync(tf, Buffer.from(bytes));
    const r = so.readText(tf);
    ok(r.encodingError && r.text.indexOf('�') === -1, 'readText: ' + what + ' is refused, never replaced with U+FFFD');
  });
  ['../x', '/abs/x', 'a\\b', 'a//b', './a', so.MARKER].forEach(rel => {
    const out = path.join(TMP, 'wv-bad'), e = thrown(() => so.writeVerified(out, new Map([['ok.txt', 'x'], [rel, 'y']]), () => {}));
    ok(e && e.code === 'path' && !exists(out) && !leftovers(out).length, 'writeVerified: refuses to write "' + rel + '", leaving nothing');
  });
  const wvOut = path.join(TMP, 'wv-verify'), ev = thrown(() => so.writeVerified(wvOut, new Map([['a.txt', 'a']]), () => { throw new Error('no'); }));
  ok(ev && ev.message === 'no' && !exists(wvOut) && !leftovers(wvOut).length, 'writeVerified: a verify that throws leaves nothing');
  const wvOk = path.join(TMP, 'wv-ok');
  so.writeVerified(wvOk, new Map([['a.txt', 'a'], ['sub/b.bin', Buffer.from([1, 2, 3])]]), tmp => { if (fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8') !== 'a') throw new Error('bad'); });
  ok(JSON.stringify(fs.readdirSync(wvOk).sort()) === '["a.txt","sub"]' && fs.readFileSync(path.join(wvOk, 'sub', 'b.bin')).equals(Buffer.from([1, 2, 3])), 'writeVerified: the finished folder holds exactly the files given, without INCOMPLETE.txt');
  ok((thrown(() => so.writeVerified(wvOk, new Map([['c.txt', 'c']]), () => {})) || {}).code === 'exists' && !exists(path.join(wvOk, 'c.txt')), 'writeVerified: refuses a folder that exists by the time it writes');

  // ── The sample library itself ─────────────────────────────────────────
  ok(treeHash(SAMPLE) === SAMPLE_HASH && treeHash(BETA2) === BETA2_HASH, 'sample-data/ is unchanged by every run');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails) { console.log('FAILED ' + fails + ' of ' + count + ' rewriting-tool checks'); process.exit(1); }
console.log('PASSED ' + count + ' rewriting-tool checks');
