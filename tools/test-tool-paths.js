#!/usr/bin/env node
/* Slaughter Cataloger 3 — tool paths no test had reached (Stage A2, data integrity: the class 1
   rows of the A1 audit for the tools).

   usage: node tools/test-tool-paths.js        (SC_LIST_CHECKS=1 lists every check)

   Everything runs on copies of the invented Beta 2 sample library, and on invented files, in a
   temporary folder; nothing under sample-data/ is written. What each tool does was established from
   its code first; each section checks it:
   1  convert-to-3.js: a Beta 2 name authority list (AUTHORITY_<TitleID>.csv) becomes the library's
      Authorities file; one whose title no library holds is listed as not converted (TOOL-04);
   2  convert-to-3.js: a record found only in an older copy of a list is set aside, its original
      row written to _left-out/ and named in the report, never dropped silently (TOOL-05);
   3  scan-terms.js: id, block and review terms, and the refusal of a term list inside a folder
      being scanned (TOOL-17);
   4  validate-issue.js --json: the whole result as JSON, for a valid package, a package with a file
      missing, and a staging package (TOOL-11).
   After every run the input is byte for byte what it was. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SCx = globalThis.SC, R = SCx.records, CSV = SCx.csv;

const LIST = process.env.SC_LIST_CHECKS === '1';
let count = 0, fails = 0;
const ok = (cond, what, detail) => {
  count++;
  if (!cond) { fails++; console.log('FAIL ' + what + (detail === undefined ? '' : '\n     ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700))); }
  else if (LIST) console.log('  ok   ' + what);
};
const section = s => { if (LIST) console.log('· ' + s); };

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sc3-toolpaths-')));
const BETA2 = path.join(ROOT, 'sample-data', 'beta2', 'example-library');
const CV = path.join(ROOT, 'tools', 'convert-to-3.js'), SCAN = path.join(ROOT, 'tools', 'scan-terms.js');
const run = (tool, args) => { const r = cp.spawnSync(process.execPath, [tool].concat(args), { cwd: TMP, encoding: 'utf8', env: Object.assign({}, process.env, { TZ: 'America/New_York', SC_TEST_FAULT: '' }) }); return { status: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') }; };
function treeHash(dir) {
  const h = crypto.createHash('sha256');
  (function walk(d, rel) {
    fs.readdirSync(d).sort().forEach(n => {
      const p = path.join(d, n), r = rel + '/' + n, st = fs.lstatSync(p);
      if (st.isDirectory()) { h.update('D' + r + '\n'); walk(p, r); }
      else h.update('F' + r + ':' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') + '\n');
    });
  })(dir, '');
  return h.digest('hex');
}
const copyOfSample = name => { const d = path.join(TMP, name); fs.mkdirSync(d); fs.readdirSync(BETA2).forEach(n => fs.copyFileSync(path.join(BETA2, n), path.join(d, n))); return d; };
const reportOf = out => { try { return fs.readdirSync(out).filter(d => fs.statSync(path.join(out, d)).isDirectory()).map(d => fs.readFileSync(path.join(out, d, 'CONVERSION-REPORT.md'), 'utf8')).join('\n'); } catch (e) { return ''; } };
const SAMPLE_HASH = treeHash(BETA2);

try {
  // ── 1. Beta 2 name authority lists ────────────────────────────────────
  section('convert-to-3.js: Beta 2 name authority lists become the Authorities file (TOOL-04)');
  {
    const A = copyOfSample('auth');
    const list = CSV.serialize([
      ['AuthorizedForm', 'Type', 'Count', 'VariantForms', 'Roles', 'Honorifics', 'Notes', 'Status'],
      ['Other, A. N.', 'person', '3', 'A. N. Other; Anne Other', 'editor', '', 'Invented for the tool-path test.', 'confirmed'],
      ['Lakeside Press', 'organization', '1', '', 'printer', '', '', 'needsreview'],
      ['Other, A. N.', 'person', '1', 'A. Other', '', 'Mrs.', '', 'confirmed']
    ]);
    fs.writeFileSync(path.join(A, 'AUTHORITY_DEMQUARX-1995.csv'), list);
    const A0 = treeHash(A), out = path.join(TMP, 'auth-out');
    const r = run(CV, [A, '--out', out]);
    ok(r.status === 0, 'the conversion runs (exit status 0)', r.all.slice(-600));
    const af = path.join(out, 'EXAMPLE-LIBRARY', 'SCAT_EXAMPLE-LIBRARY_AUTHORITIES.csv');
    const text = fs.existsSync(af) ? fs.readFileSync(af, 'utf8') : '';
    const res = text ? R.readFile(path.basename(af), text, {}) : { ok: false, records: [] };
    ok(res.ok && res.kind === 'authority', 'the library\'s Authorities file is made: SCAT_EXAMPLE-LIBRARY_AUTHORITIES.csv, read by the app as an Authorities file', res.error);
    const by = Object.fromEntries((res.records || []).map(x => [x.name, x]));
    ok((res.records || []).length === 2 && by['Other, A. N.'] && by['Lakeside Press'], 'one heading per authorized form: the two rows for "Other, A. N." become one heading, "Lakeside Press" the other', Object.keys(by));
    const o = by['Other, A. N.'] || {}, p = by['Lakeside Press'] || {};
    ok(o.nameType === 'Person' && o.status === 'Confirmed' && o.roles === 'editor' && o.notes === 'Invented for the tool-path test.', 'its type, status, role and note are carried over ("person" → Person, "confirmed" → Confirmed)', o);
    ok(/A\. N\. Other/.test(o.variants || '') && /Anne Other/.test(o.variants || '') && /A\. Other/.test(o.variants || ''), 'its variant forms from both rows are kept together', o.variants);
    ok(p.nameType === 'Corporate body' && p.status === 'Needs review' && p.roles === 'printer', '"organization" → Corporate body, "needsreview" → Needs review', p);
    ok(treeHash(A) === A0, 'the input folder is byte for byte what it was');
    // With two libraries, a list for a title neither holds belongs to no library.
    const B = copyOfSample('auth2');
    const other = path.join(TMP, 'auth2-other'); fs.mkdirSync(other);
    fs.readdirSync(BETA2).forEach(n => {
      const t = fs.readFileSync(path.join(BETA2, n), 'utf8'), pz = CSV.parse(t), k = pz.rows[0].map(x => x.trim()).indexOf('Title Library Slug');
      if (k !== -1) pz.rows.slice(1).forEach(row => { if (row[k]) row[k] = 'ANOTHER-LIBRARY'; });
      fs.writeFileSync(path.join(other, n.replace('EXAMPLE-LIBRARY', 'ANOTHER-LIBRARY')), CSV.serialize(pz.rows, pz.style));
    });
    fs.writeFileSync(path.join(B, 'AUTHORITY_NOPEXXXX-1900.csv'), list);
    const B0 = treeHash(B), O0 = treeHash(other), out2 = path.join(TMP, 'auth2-out');
    const r2 = run(CV, [B, other, '--out', out2]);
    const rep = reportOf(out2);
    ok(r2.status === 0 && /not converted: AUTHORITY_NOPEXXXX-1900\.csv — a Beta 2 authority list: no library holds NOPEXXXX-1900/.test(r2.out) && /AUTHORITY_NOPEXXXX-1900\.csv` — a Beta 2 authority list: no library holds NOPEXXXX-1900/.test(rep),
      'two libraries and a list for a title neither holds: it is listed as not converted, on screen and in the report', r2.all.slice(-800));
    ok(['EXAMPLE-LIBRARY', 'ANOTHER-LIBRARY'].every(s => !fs.existsSync(path.join(out2, s, 'SCAT_' + s + '_AUTHORITIES.csv'))), 'and no library gets its headings');
    ok(treeHash(B) === B0 && treeHash(other) === O0, 'both input folders are byte for byte what they were');
  }

  // ── 2. Records only in an older copy ─────────────────────────────────
  section('convert-to-3.js: a record only in an older copy of a list is set aside to _left-out/ and reported (TOOL-05)');
  {
    const C = copyOfSample('leftout');
    const src = 'SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_ISSUES.csv', older = 'SCAT_EXAMPLE-LIBRARY_DEMQUARX-1995_ISSUES_v2-0_20200101.csv';
    const pz = CSV.parse(fs.readFileSync(path.join(BETA2, src), 'utf8'));
    const ik = pz.rows[0].map(x => x.trim()).indexOf('IssueID'), sk = pz.rows[0].map(x => x.trim()).indexOf('Short Name');
    const last = pz.rows[pz.rows.length - 1].slice();
    const extraID = last[ik].slice(0, -2) + (last[ik].slice(-2) === 'ZZ' ? 'YY' : 'ZZ');
    last[ik] = extraID; last[sk] = 'An issue only in the older copy';
    const olderRows = pz.rows.concat([last]);
    fs.writeFileSync(path.join(C, older), CSV.serialize(olderRows, pz.style));
    fs.utimesSync(path.join(C, older), new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
    fs.utimesSync(path.join(C, src), new Date('2024-06-01T00:00:00Z'), new Date('2024-06-01T00:00:00Z'));
    const C0 = treeHash(C), out = path.join(TMP, 'leftout-out');
    const r = run(CV, [C, '--out', out]);
    ok(r.status === 0 && /1 set aside \(only in older copies\)/.test(r.out), 'the conversion runs and says "1 set aside (only in older copies)"', r.all.slice(-600));
    const lib = path.join(out, 'EXAMPLE-LIBRARY');
    const issues = fs.existsSync(path.join(lib, src)) ? R.readFile(src, fs.readFileSync(path.join(lib, src), 'utf8'), {}) : { records: [] };
    ok(issues.records.length === pz.rows.length - 1 && !issues.records.some(x => x.issueID === extraID), 'the converted Issues file holds the newest copy\'s issues, not the one found only in the older copy');
    const lo = path.join(lib, '_left-out', older);
    const loRows = fs.existsSync(lo) ? CSV.parse(fs.readFileSync(lo, 'utf8')).rows.filter(x => x.some(v => String(v).trim())) : [];
    ok(loRows.length === 2 && JSON.stringify(loRows[1]) === JSON.stringify(last) && JSON.stringify(loRows[0].map(x => x.trim())) === JSON.stringify(pz.rows[0].map(x => x.trim())),
      '_left-out/ holds that record\'s original row, cell for cell, under the older copy\'s name with its header row', loRows.length);
    const rep = reportOf(out);
    ok(/## Set aside: records only in older copies \(1\)/.test(rep) && rep.indexOf('issue `' + extraID + '`: in `' + older + '`, not in the newer `' + src + '`') !== -1 && /their original rows are in `_left-out\/`/.test(rep),
      'the report names it: the IssueID, the older copy it is in, the newer one it is not in, and where its row is');
    const back = R.buildLibrary(fs.readdirSync(lib).filter(n => /\.csv$/.test(n)).map(n => R.readFile(n, fs.readFileSync(path.join(lib, n), 'utf8'), {})), {});
    ok(back.report.filter(x => x.level === 'error' || x.level === 'skip').length === 0 && !back.state.issues.has(extraID), 'the converted library reads back with no file refused or skipped; _left-out/ is not part of it');
    ok(treeHash(C) === C0, 'the input folder is byte for byte what it was');
  }

  // ── 3. The term scan ────────────────────────────────────────────────
  section('scan-terms.js: id, block and review terms; a list inside the scanned folder refused (TOOL-17)');
  {
    const D = path.join(TMP, 'scan'); fs.mkdirSync(D);
    const terms = path.join(TMP, 'terms.txt');
    fs.writeFileSync(terms, ['# invented terms for the test', 'id:ZQX123', 'block:Frobnitz Quarterly', 'review:Widget', ''].join('\n'));
    const files = {
      'clean.txt': 'Nothing listed here. ZQX1234 and zqx123 are not the code; Frobnitz alone is not the phrase.\n',
      'review.md': 'A widget, and a WIDGET.\n'
    };
    Object.keys(files).forEach(n => fs.writeFileSync(path.join(D, n), files[n]));
    const D0 = treeHash(D);
    let r = run(SCAN, [terms, D]);
    ok(r.status === 0 && /PASSED: no listed term found\./.test(r.out), 'no listed term: passes (a longer token, another case and one word of a phrase are not hits)', r.all);
    ok(/To look at \(not failing\): Widget ×2/.test(r.out), 'review words are counted for a person to look at, in any case, without failing: "Widget ×2"', r.out);
    fs.writeFileSync(path.join(D, 'hits.csv'), 'Code,Title\nZQX123,"The Fröbnitz — QUARTERLY"\n"x",frobnitz-quarterly\n');
    r = run(SCAN, [terms, D]);
    ok(r.status === 1 && /FAILED: 3 listed term\(s\) found in 1 file\(s\)\./.test(r.out), 'a code and a phrase: fails, "3 listed term(s) found in 1 file(s)."', r.out);
    ok(/hits\.csv: 3 hit\(s\)/.test(r.out) && /line 2  \[id\] ZQX123/.test(r.out) && /line 2  \[block\] Frobnitz Quarterly/.test(r.out) && /line 3  \[block\] Frobnitz Quarterly/.test(r.out),
      'each hit is listed with its file, line and term; the phrase is found whatever its case, accents and punctuation', r.out);
    const inside = path.join(D, 'terms.txt'); fs.copyFileSync(terms, inside);
    r = run(SCAN, [inside, D]);
    ok(r.status === 2 && r.err.indexOf('The term list is inside ' + D + ', which is being scanned (and would be published). Keep it outside the repository.') !== -1 && r.out === '',
      'a term list inside the folder being scanned: refused (exit status 2), and nothing is scanned', r.all);
    fs.unlinkSync(inside); fs.unlinkSync(path.join(D, 'hits.csv'));
    ok(treeHash(D) === D0, 'the scanned folder is never written');
  }
  // ── 4. The package validator's JSON ──────────────────────────────────
  section('validate-issue.js --json: the result as JSON (TOOL-11)');
  {
    const VI = path.join(ROOT, 'tools', 'validate-issue.js'), PKG = path.join(ROOT, 'sample-data', 'issue-package');
    const PKG0 = treeHash(PKG);
    const parse = t => { try { return JSON.parse(t); } catch (e) { return null; } };
    let r = run(VI, [path.join(PKG, 'native'), '--json']), j = parse(r.out);
    ok(r.status === 0 && j && j.ok === true && Array.isArray(j.errors) && !j.errors.length && Array.isArray(j.warnings) && j.summary && j.summary.issue_id === 'EXAGAZEX-1872-KRNYWA2' && j.summary.items === 18,
      'the invented native package: exit 0, and the output is JSON only: ok true, no errors, and its summary (IssueID, 18 items)', r.out.slice(0, 300));
    const t = run(VI, [path.join(PKG, 'native')]);
    ok(t.status === 0 && /^VALID$/m.test(t.out) && t.out.trim().charAt(0) !== '{', 'without --json, the same result as text, ending "VALID"');
    const broken = path.join(TMP, 'native-broken'); fs.cpSync(path.join(PKG, 'native'), broken, { recursive: true }); fs.unlinkSync(path.join(broken, 'items.json'));
    r = run(VI, [broken, '--json']); j = parse(r.out);
    ok(r.status === 1 && j && j.ok === false && j.errors.length >= 1 && j.errors.every(e => e.code && typeof e.file === 'string' && e.message) && j.errors.some(e => e.code === 'missing-file' && e.file === 'items.json'),
      'with items.json taken out: exit 1, ok false, and each error with its code, file and message (missing-file, items.json)', r.out.slice(0, 300));
    r = run(VI, [path.join(PKG, 'staging'), '--json']); j = parse(r.out);
    ok(r.status === 1 && j && j.ok === false && j.errors.length === 1 && j.errors[0].code === 'staging' && j.summary === null && /Convert it first/.test(j.errors[0].message),
      'a staging package: exit 1, one error of code "staging" saying to convert it first, and no summary');
    r = run(VI, [path.join(PKG, 'native'), '--yaml']);
    ok(r.status === 2 && /usage/.test(r.err), 'an unknown option: exit 2, and the usage');
    ok(treeHash(PKG) === PKG0, 'sample-data/issue-package is byte for byte what it was');
  }
  ok(treeHash(BETA2) === SAMPLE_HASH, 'sample-data/beta2 is byte for byte what it was');
} finally { fs.rmSync(TMP, { recursive: true, force: true }); }

console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' tool-path checks' : 'PASSED ' + count + ' tool-path checks');
process.exit(fails ? 1 : 0);
