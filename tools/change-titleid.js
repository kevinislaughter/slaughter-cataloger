#!/usr/bin/env node
/* Change a title's TitleID, deliberately, everywhere it is used (3.0 libraries).

   usage: node tools/change-titleid.js <library folder> <OLD-TITLEID> <NEW-TITLEID> --out <new folder> [--partial-copy]

   - Title record: TitleID, Title Code and First Year follow the new ID.
   - IssueIDs and ContentIDs keep their own codes with the new prefix
     (OLDCODE-YYYY-K7M4Q2B -> NEWCODE-YYYY-K7M4Q2B), so old and new can always be matched.
   - Parent links, Issue/Contents files and their names follow.
   - A sentence recording the change is added to the title's General Notes.
   - Any other text that still mentions the old ID is listed for review.

   The library folder is only read, never written. The result is a new folder:
   - --out must not exist yet, and must not be inside the library folder (compared after resolving
     links). Everything is written into a temporary folder beside it, read back and verified there,
     and only then renamed to --out. If anything fails, nothing appears at --out.
   - Every CSV is read strictly as UTF-8, as the app reads it (a byte-order mark is kept). A file
     that is not UTF-8, or that the app would refuse, stops the change.
   - A file holding its header row only (DF-19: what the app saves when the last record of a file
     is deleted) is read as the app reads it when it opens a folder. When the header row is exactly
     a 3.0 one and the name is this library's, it is an empty file of the library: it is carried
     into the output byte for byte, renamed with the title's other files if its name holds the old
     TitleID. Any other header-only file stops the change, as it would before ("No data rows. …");
     an empty file the app does not take in (another library's name, a second Titles file) is
     listed like any other CSV the app does not load.
   - No file is renamed onto a name the folder already holds (compared ignoring case, as on macOS
     and Windows disks): one file would take the other's place, so the change is refused.
   - A library with an _issues/ folder (installed issue packages) is refused, with or without
     --partial-copy: changing a TitleID inside issue packages is not supported yet.
   - The output holds the library's catalog CSVs only. If the folder holds anything else (other
     files, subfolders such as _backups/, operating-system files such as .DS_Store, symbolic links,
     or CSVs the app does not load, such as an older copy), the output would be a partial copy, so
     the change is refused and every such item is listed. Move them out of the folder and run again,
     or give --partial-copy to make a catalog-only copy on purpose: every item left out is then
     listed in the report and in PARTIAL-COPY.md in the output.

   Exit status: 0 = changed; 1 = refused or not verified (nothing written); 2 = usage or unreadable folder. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
['js/core/csv.js', 'js/core/ids.js', 'js/core/schema.js', 'js/core/records.js', 'js/core/store.js'].forEach(f => require(path.join(ROOT, f)));
const SC = globalThis.SC, R = SC.records, ids = SC.ids;
const so = require('./lib/safe-output');

const USAGE = 'usage: change-titleid.js <library folder> <OLD-TITLEID> <NEW-TITLEID> --out <new folder> [--partial-copy]';
const PARTIAL_FILE = 'PARTIAL-COPY.md';
const args = process.argv.slice(2);
const PARTIAL = args.includes('--partial-copy');
const rest = args.filter(a => a !== '--partial-copy');
const oi = rest.indexOf('--out');
const positional = rest.filter((a, i) => i !== oi && i !== oi + 1);
const [dir, OLD, NEW] = positional;
const OUT = oi !== -1 && rest[oi + 1] && !rest[oi + 1].startsWith('--') ? rest[oi + 1] : null;
if (positional.length !== 3 || !OUT || positional.some(a => a.startsWith('--'))) { console.error(USAGE); process.exit(2); }
const fail = m => { console.error('Not changed: ' + m); process.exit(1); };

const LIB = path.resolve(dir);
let libStat = null;
try { libStat = fs.statSync(LIB); } catch (e) { /* reported below */ }
if (!libStat || !libStat.isDirectory()) { console.error('Not changed: ' + LIB + ' is not a folder that can be read.'); process.exit(2); }
if (!ids.RE.titleID.test(NEW)) fail(NEW + ' is not a valid TitleID (8-character code, hyphen, YYYY / YYYX / YYXX / XXXX).');
let OUT_ABS;
try { OUT_ABS = so.checkOutput(OUT, [LIB]); } catch (e) { if (e instanceof so.SafeOutputError) fail(e.message + ' Nothing was written.'); throw e; }

// ── What the folder holds ───────────────────────────────────────────────
const entries = fs.readdirSync(LIB, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const packages = entries.find(e => e.name.toLowerCase() === '_issues');
if (packages) fail(path.join(LIB, packages.name) + ' holds installed issue packages. Changing a TitleID inside issue packages is not supported yet, so a library with an _issues/ folder is not changed (--partial-copy does not change this). Nothing was written.');
const notCarried = [];          // { name, why }: in the folder, and not in the output
const csvNames = [];
entries.forEach(e => {
  if (e.isFile() && /\.csv$/i.test(e.name)) { csvNames.push(e.name); return; }
  const why = e.isSymbolicLink() ? 'a symbolic link' : e.isDirectory() ? (e.name === '_backups' ? 'a folder: the backup copies the app made before saves' : 'a folder')
    : e.isFile() ? (/^(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i.test(e.name) ? 'an operating-system file' : 'not a CSV file') : 'not a regular file';
  notCarried.push({ name: e.name + (e.isDirectory() ? '/' : ''), why });
});
const original = new Map();     // file name → its bytes as read
const files = csvNames.map(n => {
  const p = path.join(LIB, n), t = so.readText(p);
  original.set(n, t.bytes);
  // allowEmpty: a header-only file is read exactly as the app reads it when it opens the folder (DF-21).
  return R.readFile(n, t.text, { lastModified: fs.statSync(p).mtimeMs, encodingError: t.encodingError, allowEmpty: true });
});
const refused = files.filter(f => !f.ok);
if (refused.length) fail(refused.map(f => f.name + ': ' + f.error).join('; '));
const built = R.buildLibrary(files, {});
const st = built.state;
if (built.changed.length) fail('the library is not cleanly saved as 3.0 (' + built.changed.join(', ') + ').');
if (!st.titles.has(OLD)) fail(OLD + ' is not in this library.');
if (st.titles.has(NEW)) fail(NEW + ' already exists.');
const [newCode, newYear] = [NEW.slice(0, 8), NEW.slice(9)];
for (const t of st.titles.values()) if (t.titleID !== OLD && t.titleCode === newCode) fail('Title Code ' + newCode + ' is used by ' + t.titleID + '.');
// CSVs that read cleanly but are not part of the library (an older copy, another library's file).
files.filter(f => !st.files.has(f.name)).forEach(f => {
  const why = built.report.find(r => r.file === f.name && r.level !== 'info');
  notCarried.push({ name: f.name, why: 'a CSV the app does not load' + (why ? ': ' + why.msg : '') });
});
notCarried.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const itemList = notCarried.map(x => '  - ' + x.name + ' — ' + x.why);
if (notCarried.length && !PARTIAL) {
  console.error('Not changed: ' + LIB + ' holds ' + notCarried.length + ' item(s) that the output would not include. The output of a TitleID change holds the catalog CSVs only, so it would be a partial copy of the folder:');
  itemList.forEach(x => console.error(x));
  console.error('Nothing was written. Move these out of the library folder (somewhere safe) and run again; or, to make a catalog-only copy on purpose, run again with --partial-copy, which lists every item left out in its report and in ' + PARTIAL_FILE + ' in the output.');
  process.exit(1);
}

// ── The change ──────────────────────────────────────────────────────────
const swap = id => (id && id.indexOf(OLD + '-') === 0) ? NEW + id.slice(OLD.length) : id;
const renameFile = n => n.indexOf(OLD) !== -1 ? n.split(OLD).join(NEW) : n;
const pad = n => String(n).padStart(2, '0'), d = new Date();      // local date (run with TZ set to the cataloguer's zone)
const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const counts = { issues: 0, contents: 0, files: [] };
const touched = new Set();      // files (by their name in the library folder) holding a record that changes

// title
const t = Object.assign({}, st.titles.get(OLD), { titleID: NEW, titleCode: newCode, firstYear: newYear });
const record = 'TitleID changed from ' + OLD + ' to ' + NEW + ' on ' + today + '; IssueIDs and ContentIDs keep their codes with the new prefix (' + OLD + '-K… became ' + NEW + '-K…).';
t.generalNotes = (t.generalNotes ? t.generalNotes.replace(/\s+$/, '') + ' ' : '') + record;
touched.add(t._src);
st.titles.delete(OLD);
st.titles.set(NEW, R.freezeRec(t));
// issues
Array.from(st.issues.values()).filter(i => i.titleID === OLD).forEach(i => {
  touched.add(i._src);
  st.issues.delete(i.issueID);
  const n = Object.assign({}, i, { issueID: swap(i.issueID), titleID: NEW, _src: renameFile(i._src) });
  st.issues.set(n.issueID, R.freezeRec(n)); counts.issues++;
});
// contents (IDs, issue links, parent links)
Array.from(st.contents.values()).filter(c => c.issueID.indexOf(OLD + '-') === 0 || c.contentID.indexOf(OLD + '-') === 0 || c.titleID === OLD).forEach(c => {
  touched.add(c._src);
  st.contents.delete(c.contentID);
  const n = Object.assign({}, c, { contentID: swap(c.contentID), issueID: swap(c.issueID), parentID: swap(c.parentID), titleID: c.titleID === OLD ? NEW : c.titleID, _src: renameFile(c._src) });
  st.contents.set(n.contentID, R.freezeRec(n)); counts.contents++;
});
// files
// A file renamed for the new TitleID must not take a name another item of the folder has (an empty
// file left under the new ID, say): the two would become one file and the other would be lost.
// Names are compared ignoring case, as on macOS and Windows disks.
const after = new Map();        // lower-case name after the change → the folder's items that would have it
entries.forEach(e => {
  const m = st.files.has(e.name) ? renameFile(e.name) : e.name, k = m.toLowerCase();
  if (!after.has(k)) after.set(k, []);
  after.get(k).push({ name: e.name, m });
});
after.forEach(list => {
  const moved = list.find(x => x.m !== x.name);
  if (list.length < 2 || !moved) return;
  const others = list.filter(x => x !== moved).map(x => x.name).join(' and ');
  fail(moved.name + ' would be renamed ' + moved.m + ', but ' + others + ' would have that name too (names are compared ignoring case, as on macOS and Windows disks): one file would take the other\'s place. Move ' + others + ' out of the library folder (somewhere safe) and run again. Nothing was written.');
});
const sourceOf = new Map();     // output name → name in the library folder
Array.from(st.files.keys()).forEach(n => {
  const m = renameFile(n);
  sourceOf.set(m, n);
  if (m !== n) { const f = st.files.get(n); st.files.delete(n); st.files.set(m, Object.assign({}, f, { name: m })); counts.files.push(n + ' -> ' + m); }
});

// ── Verify what will be written, before anything is written ─────────────
const written = {};
st.files.forEach((f, n) => { written[n] = R.writeFile(st, n); });
const expected = { titles: st.titles.size, issues: st.issues.size, contents: st.contents.size };
function problemsOf(texts) {
  const back = R.buildLibrary(Object.keys(texts).map(n => R.readFile(n, texts[n], { allowEmpty: true })), {});
  const problems = [];
  back.report.filter(r => r.level === 'error' || r.level === 'skip').forEach(r => problems.push((r.file ? r.file + ': ' : '') + r.msg));
  if (back.changed.length) problems.push('files change on re-read: ' + back.changed.join(', '));
  if (back.state.titles.size !== expected.titles || back.state.issues.size !== expected.issues || back.state.contents.size !== expected.contents) problems.push('record counts differ');
  if (!back.state.titles.has(NEW) || back.state.titles.has(OLD)) problems.push('the title is not under ' + NEW + ' alone');
  back.state.issues.forEach(i => { if (i.issueID.indexOf(i.titleID + '-') !== 0) problems.push('IssueID ' + i.issueID + ' does not start with ' + i.titleID); });
  back.state.contents.forEach(c => { if (c.parentID && !back.state.contents.has(c.parentID)) problems.push('broken parent link ' + c.contentID); });
  return problems;
}
const problems = problemsOf(written);
// A file holding no record of the title is written back exactly as it was read.
Object.keys(written).forEach(n => {
  const src = sourceOf.get(n);
  if (!touched.has(src) && !Buffer.from(written[n], 'utf8').equals(original.get(src))) problems.push(n + ' holds no record of ' + OLD + ' but would not be written back byte for byte');
});
if (problems.length) fail('verification failed — ' + problems.slice(0, 20).join('; ') + '. Nothing was written.');
const stillMentions = [];
Object.keys(written).forEach(n => { const rows = SC.csv.parse(written[n]).rows; rows.slice(1).forEach((r, ri) => r.forEach((v, ci) => { if (v.indexOf(OLD) !== -1) stillMentions.push(n + ' row ' + (ri + 2) + ', ' + rows[0][ci] + ': ' + v.slice(0, 160)); })); });

// ── Write: a new folder, verified before it is put in place ─────────────
const out = new Map(Object.keys(written).sort().map(n => [n, written[n]]));
if (PARTIAL && notCarried.length) {
  out.set(PARTIAL_FILE, ['# A partial copy', '',
    'This folder was made on ' + today + ' by `tools/change-titleid.js` with `--partial-copy`: TitleID ' + OLD + ' became ' + NEW + '.',
    'It holds the library\'s catalog CSVs only. These ' + notCarried.length + ' item(s) of the library folder were **not copied** here:', '',
    '| Item | What it is |', '|---|---|'].concat(notCarried.map(x => '| `' + x.name.replace(/\|/g, '\\|') + '` | ' + x.why.replace(/\|/g, '\\|') + ' |'),
    ['', 'The library folder they came from was not changed; they are still there:', '', '    ' + LIB, ''],
    ['This file is not part of the library; the app does not read it.', '']).join('\n'));
}
const left = so.leftovers(OUT_ABS);
try {
  so.writeVerified(OUT_ABS, out, tmp => {
    const texts = {};
    Object.keys(written).forEach(n => {
      const r = so.readText(path.join(tmp, n));
      if (r.encodingError) throw new so.SafeOutputError('verify', n + ' ' + r.encodingError);
      texts[n] = r.text;
    });
    const p = problemsOf(texts);
    if (p.length) throw new so.SafeOutputError('verify', 'read back from disk: ' + p.slice(0, 20).join('; '));
  });
} catch (e) {
  console.error('Not changed: ' + e.message + ' Nothing was written to ' + OUT_ABS + '.');
  process.exit(1);
}

console.log('TitleID ' + OLD + ' -> ' + NEW + ': ' + counts.issues + ' issue(s), ' + counts.contents + ' contents item(s) re-keyed.');
counts.files.forEach(x => console.log('  file renamed: ' + x));
console.log('Verification: passed');
console.log('Written to ' + OUT_ABS + ' (verified there before it was put in place). The library folder was not changed.');
if (PARTIAL) {
  if (notCarried.length) {
    console.log('PARTIAL COPY (--partial-copy): ' + notCarried.length + ' item(s) of the library folder were NOT copied, as ' + PARTIAL_FILE + ' in the output also lists:');
    itemList.forEach(x => console.log(x));
  } else console.log('--partial-copy: nothing was left out; the output holds everything the library folder held.');
}
if (left.length) console.log('Note: ' + left.map(x => path.basename(x)).join(', ') + ', beside the output, ' + (left.length === 1 ? 'was' : 'were') + ' left by an interrupted run (marked ' + so.MARKER + '). Not used; can be deleted.');
if (stillMentions.length) { console.log('Text that still mentions ' + OLD + ' (review by hand):'); stillMentions.forEach(x => console.log('  ' + x)); }
process.exit(0);
