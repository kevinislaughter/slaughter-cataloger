#!/usr/bin/env node
/* Data-safety checks: reading and writing CSVs never changes or drops a value.
   Regression tests for the 3.0 readiness review (B-03, B-04, M-02, M-03, M-05; B-01 is in test-store.js).
   usage: node tools/test-safety.js [a 3.0 library folder]   (default: sample-data/3.0/example-library) */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store', 'toc', 'names', 'catalog', 'outputs'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SC = globalThis.SC, R = SC.records, C = SC.csv;

let fails = 0, count = 0;
const ok = (cond, what, detail) => { count++; if (!cond) { fails++; console.log('FAIL ' + what + (detail ? '\n   ' + detail : '')); } };
const eq = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), what, 'got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want));
const throwsLike = (fn, re, what) => { try { fn(); ok(false, what, 'no error'); } catch (e) { ok(re.test(e.message), what, e.message); } };

const dir = process.argv[2] || path.join(ROOT, 'sample-data', '3.0', 'example-library');
if (!fs.existsSync(dir)) { console.error('No library folder at ' + dir + '; pass one as the first argument.'); process.exit(2); }
const names = fs.readdirSync(dir).filter(n => /\.csv$/i.test(n)).sort();
const text = n => fs.readFileSync(path.join(dir, n), 'utf8');
const T = names.find(n => /_TITLES\.csv$/.test(n)), I = names.find(n => /_ISSUES\.csv$/.test(n)), CO = names.find(n => /_CONTENTS\.csv$/.test(n));
const load = files => R.buildLibrary(files.map(([n, t]) => R.readFile(n, t, { lastModified: 1 })));
const rows = t => C.parse(t).rows;
const header = t => rows(t)[0];
const setCell = (t, rowIdx, colName, v) => { const p = C.parse(t); p.rows[rowIdx][p.rows[0].indexOf(colName)] = v; return C.serialize(p.rows, p.style); };
const addRow = (t, cells) => { const p = C.parse(t); p.rows.push(cells); return C.serialize(p.rows, p.style); };

// ── B-03: the formula guard is exactly reversible ────────────────────────
console.log('· CSV values survive writing and reading, any number of times (B-03)');
const values = ["'-ism", "'=literal", "'+plus", "'@handle", '=SUM(1,2)', '-- END', '+1', '@x', '\tleading tab', ' leading space', 'trailing space ',
  'line\nbreak', 'cr\r\nlf', 'Ünïcödé “quotes” — dash', 'say "hi"', "''-two apostrophes", "'''", "'", "''", "'Twas", 'a,b', ''];
values.forEach(v => {
  let t = v, changed = false;
  for (let k = 0; k < 4; k++) { t = C.parse(C.serialize([['h1', 'h2'], [t, 'x']], { bom: true, eol: '\r\n', quoteAll: k % 2 === 0 })).rows[1][0]; if (t !== v) changed = true; }
  ok(!changed, 'round trip x4: ' + JSON.stringify(v), 'came back as ' + JSON.stringify(t));
});
eq(C.serialize([['-- END']]).trim(), '"\'-- END"', 'a value starting with "-" is written with one apostrophe');
eq(C.serialize([["'-ism"]]).trim(), '"\'\'-ism"', 'a value already starting with an apostrophe before "-" gets one more');
eq(C.parse("'Twas,'-- END\n").rows[0], ["'Twas", '-- END'], 'reading removes the guard only before = + - @');
// Files edited elsewhere (second review, R-01): the documented contract, cell by cell.
//   'X where X starts with = + - @ (or a tab) → read without that one apostrophe, as a spreadsheet shows it
//   ''X                                      → read as 'X (the way to keep a literal apostrophe there)
//   =X, -X, @X with no apostrophe            → read as they are; the app's next save adds the guard
//   'Twas, 'quoted' (apostrophe before anything else) → read exactly as written
const ext = (cell, want, what) => eq(C.parse('h\n' + cell + '\n').rows[1][0], want, 'external file: ' + what);
ext("'-ism", '-ism', "'-ism reads as -ism (an apostrophe before - is the spreadsheet escape)");
ext("'@handle", '@handle', "'@handle reads as @handle");
ext("''-ism", "'-ism", "''-ism keeps one apostrophe: '-ism");
ext('"=SUM(1,2)"', '=SUM(1,2)', '=SUM(1,2) with no apostrophe reads as written');
ext('"\'=SUM(1,2)"', '=SUM(1,2)', "'=SUM(1,2) reads as =SUM(1,2)");
ext("'Twas the night", "'Twas the night", "'Twas reads exactly as written");
ext("'quoted'", "'quoted'", 'an apostrophe before a letter is never touched');
eq(C.serialize(C.parse('h\n"=SUM(1,2)"\n').rows).split('\n')[1], '"\'=SUM(1,2)"', 'external: the app\'s save of =SUM(1,2) adds the guard (the value is unchanged)');
{ const t = '"h"\n"\'-ism"\n"\'Twas"\n'; eq(C.serialize(C.parse(t).rows, C.parse(t).style), t, "external: a file holding '-ism and 'Twas is written back byte for byte"); }

// ── M-02: malformed CSV is refused, with the line ────────────────────────
console.log('· Malformed CSV is refused, never guessed at (M-02)');
throwsLike(() => C.parse('x,y\n"unterminated,entry\n'), /Line 2: a quoted value is never closed/, 'unclosed quote at end of file');
throwsLike(() => C.parse('a,b\n"q"x,1\n'), /Line 2: text after the closing quote/, 'text after a closing quote');
eq(C.parse('a,b\n"q"  ,1\n').rows[1], ['q', '1'], 'spaces after a closing quote are layout');
eq(C.parse('a,b\r\n"multi\r\nline",2\r\n').rows[1], ['multi\r\nline', '2'], 'embedded CRLF inside quotes');
eq(C.parse('a,b\n1,\n').rows[1], ['1', ''], 'empty last field');
eq(C.parse('﻿a,b\n1,2\n\n\n').rows.length, 2, 'BOM and trailing blank lines');
const titles = text(T);
const bad = (t, re, what) => { const r = R.readFile(T, t, {}); ok(!r.ok && re.test(r.error), what, r.ok ? 'file was loaded' : r.error); };
bad(titles.replace(/\n$/, '') + '\n"broken,row\n', /never closed/, 'Titles file with an unclosed quote: not loaded');
{ const p = C.parse(titles); p.rows[0].push(p.rows[0][3]); p.rows.slice(1).forEach(r => r.push('x')); bad(C.serialize(p.rows, p.style), /appears twice/, 'a column heading that appears twice: not loaded'); }
{ const p = C.parse(titles); p.rows[0].push(''); p.rows.slice(1).forEach((r, k) => r.push(k ? '' : 'orphan value')); bad(C.serialize(p.rows, p.style), /no heading but holds values/, 'a value under a blank heading: not loaded'); }
{ const p = C.parse(titles); p.rows[0].push(''); p.rows.slice(1).forEach(r => r.push('')); ok(R.readFile(T, C.serialize(p.rows, p.style), {}).ok, 'an empty column with no heading (a trailing comma) is fine'); }
{ const p = C.parse(titles); p.rows[1].push('stray'); bad(C.serialize(p.rows, p.style), /has \d+ values but the file has \d+ columns/, 'a row with more values than columns: not loaded'); }
{ const p = C.parse(titles); const k = p.rows[0].indexOf('Canonical Title'); p.rows[0].push('Canonical Title'.replace(' ', '')); p.rows.slice(1).forEach(r => r.push(r[k]));
  const r = R.readFile(T, C.serialize(p.rows, p.style), {}); ok(r.ok || /same field|appears twice/.test(r.error), 'a column and its old alias together: refused or harmless', r.error); }

// ── B-04 / M-03: rows that cannot be taken in are kept, verbatim ─────────
console.log('· Rows the app cannot take in stay in the file exactly (B-04, M-03)');
const firstData = rows(titles)[1];
const tCol = n => header(titles).indexOf(n);
const dup = firstData.slice(); dup[tCol('Canonical Title')] = 'DUPLICATE RECORD IMPORTANT';
const withDup = addRow(titles, dup);
const lib1 = load([[T, withDup]]);
eq(lib1.state.titles.size, rows(titles).length - 1, 'the duplicate TitleID row is not loaded as a title');
ok(lib1.report.some(r => r.level === 'warn' && /not loaded and kept unchanged/.test(r.msg) && /already used by an earlier row/.test(r.msg)), 'the load report says the row is kept and why');
eq(lib1.setAside, [{ file: T, rows: 1 }], 'the library lists files with rows kept aside');
// Edit an accepted title and save: the duplicate row must come back unchanged.
const st1 = SC.createStore(); st1.load(lib1.state);
const t0 = st1.state.titles.get(firstData[tCol('TitleID')]);
st1.put('title', Object.assign({}, t0, { generalNotes: (t0.generalNotes || '') + ' edited' }));
const out1 = R.writeFile(st1.state, T);
eq(rows(out1).length, rows(withDup).length, 'after an edit and save the file has the same number of rows');
ok(rows(out1).some(r => JSON.stringify(r) === JSON.stringify(dup)), 'the duplicate row is written back cell for cell', JSON.stringify(rows(out1).slice(-1)[0]));
// Stable: reading the written file sets the same row aside again, and writing again changes nothing.
const lib1b = load([[T, out1]]);
eq(lib1b.setAside, [{ file: T, rows: 1 }], 'reading the saved file keeps the same row aside');
eq(lib1b.state.titles.get(t0.titleID).generalNotes, (t0.generalNotes || '') + ' edited', 'the edited title (not the duplicate) is the one loaded after saving');
const st1b = SC.createStore(); st1b.load(lib1b.state);
eq(R.writeFile(st1b.state, T), out1, 'writing again gives the same file');
// Rows of another library (M-03) and of another tool, in an Issues file.
const issues = text(I);
const ih = header(issues);
const foreign = rows(issues)[1].slice(); foreign[ih.indexOf('Title Library Slug')] = 'OTHER-LIB'; foreign[ih.indexOf('IssueID')] = foreign[ih.indexOf('IssueID')].replace(/-K/, '-Z');
const wrongTool = rows(issues)[1].slice(); wrongTool[ih.indexOf('Slaughter Cataloger Tool')] = 'Contents';
const mixed = addRow(addRow(issues, foreign), wrongTool);
const lib2 = load([[T, titles], [I, mixed]]);
eq(lib2.state.issues.size, rows(issues).length - 1, 'rows of another library or another tool are not loaded (M-03)');
ok(!Array.from(lib2.state.issues.values()).some(i => /-Z/.test(i.issueID)), 'the other library\'s issue is not in this library');
const st2 = SC.createStore(); st2.load(lib2.state);
const i0 = Array.from(st2.state.issues.values())[0];
st2.put('issue', Object.assign({}, i0, { generalNotes: 'edited' }));
const out2 = rows(R.writeFile(st2.state, I));
eq(out2.length, rows(mixed).length, 'Issues file keeps every row after an edit');
ok(out2.some(r => JSON.stringify(r) === JSON.stringify(foreign)), 'the other library\'s row is written back unchanged (slug included)');
ok(out2.some(r => JSON.stringify(r) === JSON.stringify(wrongTool)), 'the other tool\'s row is written back unchanged');
eq(out2.filter(r => r[ih.indexOf('Title Library Slug')] === 'OTHER-LIB').length, 1, 'no record of this library is written under the other slug, and vice versa');
// Duplicate ContentID: the second row is kept aside (not renumbered, not dropped).
if (CO) {
  const contents = text(CO);
  const dupC = rows(contents)[2].slice(); dupC[header(contents).indexOf('ContentID')] = rows(contents)[1][header(contents).indexOf('ContentID')];
  const withDupC = addRow(contents, dupC);
  const lib3 = load([[T, titles], [I, issues], [CO, withDupC]]);
  eq(lib3.state.contents.size, rows(contents).length - 1, 'a repeated ContentID row is not loaded as a second item');
  const st3 = SC.createStore(); st3.load(lib3.state);
  ok(rows(R.writeFile(st3.state, CO)).some(r => JSON.stringify(r) === JSON.stringify(dupC)), 'and is written back unchanged');
}
// A row with a value missing (a comma left out) would shift values into the wrong columns: refused.
{ const p = C.parse(titles); p.rows[1].splice(p.rows[0].indexOf('City'), 1); bad(C.serialize(p.rows, p.style), /has \d+ values but the file has \d+ columns.*wrong columns/, 'a row with a value missing: not loaded (independent check, new 4)'); }
// The first row names no library; a later row names another one (independent check, new 5).
{ const p = C.parse(issues); const sl = p.rows[0].indexOf('Title Library Slug'), idc = p.rows[0].indexOf('IssueID');
  p.rows[1][sl] = ''; const other = p.rows[2].slice(); other[sl] = 'OTHERLIB'; other[idc] = other[idc].replace(/-K/, '-Y'); p.rows.push(other);
  const l = load([[T, titles], [I, C.serialize(p.rows, p.style)]]);
  ok(!Array.from(l.state.issues.values()).some(i => /-Y/.test(i.issueID)), 'a row of another library is set aside even when the first row names none');
  const st = SC.createStore(); st.load(l.state);
  ok(rows(R.writeFile(st.state, I)).some(r => r[sl] === 'OTHERLIB'), 'and written back under its own library'); }
// Yes/No values written another way survive a save (independent check, new 6).
{ const p = C.parse(issues); const h = p.rows[0];
  const sp = h.indexOf('Special Issue'), su = h.indexOf('Supplement'), spec = h.indexOf('Speculative'), ov = h.indexOf('Overridden Fields');
  p.rows[1][sp] = 'TRUE'; p.rows[1][su] = '1'; p.rows[1][spec] = 'x'; p.rows[2][sp] = 'maybe'; p.rows[1][ov] = [p.rows[1][ov], 'Printer', 'Colour'].filter(Boolean).join('; ');
  const r0 = R.readFile(I, C.serialize(p.rows, p.style), {});
  ok(r0.warnings.some(w => /Yes\/No value\(s\) written neither way.*maybe/.test(w)), 'an unrecognised Yes/No value is reported');
  const l = load([[T, titles], [I, C.serialize(p.rows, p.style)]]);
  const st = SC.createStore(); st.load(l.state);
  const id1 = p.rows[1][h.indexOf('IssueID')], id2 = p.rows[2][h.indexOf('IssueID')];
  eq([st.state.issues.get(id1).specialIssue, st.state.issues.get(id1).supplement, st.state.issues.get(id1).speculative], [true, true, true], 'TRUE, 1 and x read as yes');
  st.put('issue', Object.assign({}, st.state.issues.get(id1), { notes: 'unrelated edit' }));
  let out = rows(R.writeFile(st.state, I)), row1 = out.find(r => r[h.indexOf('IssueID')] === id1), row2 = out.find(r => r[h.indexOf('IssueID')] === id2);
  eq([row1[sp], row1[su], row1[spec], row2[sp]], ['TRUE', '1', 'x', 'maybe'], 'after an unrelated edit they are written as they were');
  ok(/Printer; Colour/.test(row1[ov]), 'names in Overridden Fields that are not inherited fields are kept');
  st.put('issue', Object.assign({}, st.state.issues.get(id2), { specialIssue: true }));
  out = rows(R.writeFile(st.state, I)); row2 = out.find(r => r[h.indexOf('IssueID')] === id2);
  eq(row2[sp], 'Yes', 'a Yes/No field changed in the app is written Yes'); }
// A library whose slug is BACKUP is not mistaken for a backup file (independent check, new 8).
{ const pb = C.parse(titles); const sl = pb.rows[0].indexOf('Title Library Slug'); pb.rows.slice(1).forEach(r => { r[sl] = 'BACKUP'; }); const t = C.serialize(pb.rows, pb.style);
  const l = R.buildLibrary([R.readFile('SCAT_BACKUP_TITLES.csv', t, {})]);
  eq([l.state.library.slug, l.state.titles.size], ['BACKUP', rows(titles).length - 1], 'library slug BACKUP: its Titles file is read'); }
// Blank rows (all empty cells) carry no data and are not reported.
{ const p = C.parse(titles); p.rows.push(p.rows[0].map(() => '')); const l = load([[T, C.serialize(p.rows, p.style)]]); eq(l.setAside, [], 'a row of empty cells is not a kept row'); }

// ── M-05: Parent ContentID must be in the same issue, and not loop ───────
if (CO) {
  console.log('· Parent ContentID links are checked (M-05)');
  const contents = text(CO);
  const h = header(contents), all = rows(contents);
  const col = n => h.indexOf(n);
  const byIssue = {};
  all.slice(1).forEach((r, k) => { (byIssue[r[col('IssueID')]] = byIssue[r[col('IssueID')]] || []).push(k + 1); });
  const issuesHeld = Object.keys(byIssue);
  const a = byIssue[issuesHeld[0]], b = byIssue[issuesHeld[1]] || byIssue[issuesHeld[0]];
  const cid = k => all[k][col('ContentID')];
  const check = (mutate, what, expectTop) => {
    const p = C.parse(contents); mutate(p.rows);
    const t = C.serialize(p.rows, p.style);
    const lib = load([[T, titles], [I, issues], [CO, t]]);
    const st = SC.createStore(); st.load(lib.state);
    expectTop.forEach(k => {
      const c = st.state.contents.get(cid(k));
      ok(c && !c.parentID, what + ': item ' + k + ' is shown at the top level', c && c.parentID);
      ok(c && c.parentKept === p.rows[k][col('Parent ContentID')], what + ': the value is kept', c && c.parentKept);
    });
    ok(lib.report.some(r => r.level === 'warn' && /Parent ContentID that cannot be used/.test(r.msg)), what + ': reported');
    const out = rows(R.writeFile(st.state, CO));
    expectTop.forEach(k => ok(out.some(r => r[col('ContentID')] === cid(k) && r[col('Parent ContentID')] === p.rows[k][col('Parent ContentID')]), what + ': written back unchanged'));
    const ds = SC.toc.depths(st.contentsOfIssue(st.state.contents.get(cid(expectTop[0])).issueID).map(c => ({ id: c.contentID, parentID: c.parentID })));
    ok(ds.every(d => d >= 0 && d < 50), what + ': nesting depths are finite');
  };
  if (issuesHeld.length > 1) check(r => { r[a[1]][col('Parent ContentID')] = cid(b[0]); }, 'parent in another issue', [a[1]]);
  check(r => { r[a[1]][col('Parent ContentID')] = cid(a[1]); }, 'item is its own parent', [a[1]]);
  // Two items each other's parent: the link to the later item is not used, so no loop is left.
  check(r => { r[a[1]][col('Parent ContentID')] = cid(a[2]); r[a[2]][col('Parent ContentID')] = cid(a[1]); }, 'two items each other\'s parent', [a[1]]);
  // A parent listed after its part (outputs would show the part under the wrong item).
  check(r => { r[a[1]][col('Parent ContentID')] = cid(a[3]); }, 'parent listed after the item (New 7)', [a[1]]);
  check(r => { r[a[1]][col('Parent ContentID')] = 'NOSUCHXX-1900-C222222'; }, 'parent that does not exist', [a[1]]);
  // A legitimate three-level nesting is untouched.
  { const p = C.parse(contents); [a[1], a[2], a[3]].forEach(k => { p.rows[k][col('Parent ContentID')] = ''; });
    p.rows[a[2]][col('Parent ContentID')] = cid(a[1]); p.rows[a[3]][col('Parent ContentID')] = cid(a[2]);
    const lib = load([[T, titles], [I, issues], [CO, C.serialize(p.rows, p.style)]]);
    const st = SC.createStore(); st.load(lib.state);
    eq([st.state.contents.get(cid(a[2])).parentID, st.state.contents.get(cid(a[3])).parentID], [cid(a[1]), cid(a[2])], 'three-level nesting kept');
    const ds = SC.toc.depths(st.contentsOfIssue(st.state.contents.get(cid(a[1])).issueID).map(c => ({ id: c.contentID, parentID: c.parentID })));
    const ids = st.contentsOfIssue(st.state.contents.get(cid(a[1])).issueID).map(c => c.contentID);
    eq([ds[ids.indexOf(cid(a[2]))], ds[ids.indexOf(cid(a[3]))]], [ds[ids.indexOf(cid(a[1]))] + 1, ds[ids.indexOf(cid(a[1]))] + 2], 'depths 1 and 2 under the parent'); }
}

// ── Independent check, round 2: Issues read while their title is not loaded ──
if (I && T) {
  console.log('· Issues whose title is not loaded keep Overridden Fields as written (independent check, round 2)');
  const issuesText = text(I);
  const ov = t => rows(t).slice(1).map(r => r[header(t).indexOf('Overridden Fields')]);
  const noTitles = load([[I, issuesText]]);
  const stN = SC.createStore(); stN.load(noTitles.state);
  ok(R.writeFile(stN.state, I) === issuesText, 'with no Titles file loaded, the Issues file is written back byte for byte');
  const first = Array.from(stN.state.issues.values()).sort((a, b) => a.entryOrder - b.entryOrder)[0];
  stN.put('issue', Object.assign({}, first, { notes: 'edited while the Titles file was missing' }));
  const edited = R.writeFile(stN.state, I);
  eq(ov(edited), ov(issuesText), 'an unrelated edit leaves every row\'s Overridden Fields as it was');
  const inh = Object.keys(SC.schema.INHERIT);
  const withTitles = st => Array.from(st.state.issues.values()).sort((a, b) => a.issueID.localeCompare(b.issueID))
    .map(i => [i.issueID, (i.overrides || []).join(';'), inh.map(k => R.effective(i, st.state.titles.get(i.titleID), k)).join('|')]);
  const before = SC.createStore(); before.load(load([[T, titles], [I, issuesText]]).state);
  const after = SC.createStore(); after.load(load([[T, titles], [I, edited]]).state);
  eq(withTitles(after), withTitles(before), 'with the Titles file back, every issue inherits and overrides exactly as before');

  // Round 3: the title is then added in Library — a new title with nothing but its name. The
  // issues read without it keep every value of their own; none is replaced by the title's blanks.
  const stA = SC.createStore(); stA.load(load([[I, issuesText]]).state);
  const tidA = Array.from(stA.state.issues.values())[0].titleID;
  const tNew = { spec: [], na: [], speculative: false, _src: 'SCAT_NEW_TITLES.csv', entryOrder: 1 };
  SC.schema.entities.title.fields.forEach(c => { tNew[c.key] = ''; });
  Object.assign(tNew, { titleID: tidA, titleCode: tidA.split('-')[0], firstYear: tidA.split('-')[1], canonicalTitle: 'Added later in Library' });
  stA.put('title', tNew, 'Add title');
  ok(R.writeFile(stA.state, I) === issuesText, 'adding the title in Library then saving the Issues file changes no cell (independent check, round 3)');
  const anyIssue = Array.from(stA.state.issues.values()).find(i => Object.keys(SC.schema.INHERIT).some(k => i[k]));
  if (anyIssue) {
    const k = Object.keys(SC.schema.INHERIT).find(x => anyIssue[x]);
    ok(R.effective(anyIssue, stA.state.titles.get(tidA), k) === anyIssue[k], 'the issue\'s own ' + k + ' stays in effect');
    ok(!!R.inherits && !R.inherits(anyIssue, stA.state.titles.get(tidA), k), 'and does not count as inherited');
  }

  // Round 4: adding the title in Library settles those issues exactly as reading the files again
  // would — values that differ from the title's become overrides, equal ones are inherited — so
  // the session, the saved files and a reload all agree (and a new issue drafted from one of them
  // carries its overrides).
  {
    const settle = R.settleIssues || (() => []);         // (older builds had no settling: the check then shows what went wrong)
    const stS = SC.createStore(); stS.load(load([[I, issuesText]]).state);
    const iss0 = Array.from(stS.state.issues.values()).sort((a, b) => a.entryOrder - b.entryOrder)[0];
    const tAdd = { spec: [], na: [], speculative: false, _src: T, entryOrder: 1 };
    SC.schema.entities.title.fields.forEach(c => { tAdd[c.key] = ''; });
    const pubKey = Object.keys(SC.schema.INHERIT).find(k => k === 'publisher') || Object.keys(SC.schema.INHERIT)[0];
    Object.assign(tAdd, { titleID: iss0.titleID, titleCode: iss0.titleID.split('-')[0], firstYear: iss0.titleID.split('-')[1], canonicalTitle: 'Added later in Library' });
    if (iss0[pubKey]) tAdd[SC.schema.INHERIT[pubKey]] = iss0[pubKey];       // one value equal to the first issue's
    stS.batch('Add title', () => { stS.put('title', tAdd); settle(stS.state, tAdd).forEach(i => stS.put('issue', i)); });
    const savedT = R.writeFile(stS.state, T), savedI = R.writeFile(stS.state, I);
    const re = SC.createStore(); re.load(load([[T, savedT], [I, savedI]]).state);
    const sig = st => Array.from(st.state.issues.values()).sort((a, b) => a.issueID.localeCompare(b.issueID))
      .map(i => [i.issueID, (i.overrides || []).join(';'), Object.keys(SC.schema.INHERIT).map(k => R.effective(i, st.state.titles.get(i.titleID), k) + (R.inherits(i, st.state.titles.get(i.titleID), k) ? '<' : '')).join('|')]);
    eq(sig(stS), sig(re), 'after adding the title, the session and a reload of the saved files agree on every issue (independent check, round 4)');
    const effBefore = SC.createStore(); effBefore.load(load([[I, issuesText]]).state);
    // Every value an issue had stays in effect (a blank one may now take the title's, as it should).
    const own = st => Array.from(st.state.issues.values()).sort((a, b) => a.issueID.localeCompare(b.issueID)).map(i => Object.keys(SC.schema.INHERIT).map(k => R.effective(i, st.state.titles.get(i.titleID), k)));
    const was = own(effBefore), now = own(stS);
    ok(was.every((row, n) => row.every((v, j) => String(v).trim() === '' || String(v).trim() === String(now[n][j]).trim())), 'and every value an issue had stays in effect');
    const s0 = stS.state.issues.get(iss0.issueID);
    const differing = Object.keys(SC.schema.INHERIT).filter(k => String(iss0[k] || '').trim() !== '' && String(iss0[k]).trim() !== String(tAdd[SC.schema.INHERIT[k]] || '').trim());
    ok(differing.every(k => s0.overrides.indexOf(k) !== -1), 'values that differ from the title are now overrides (so a new issue drafted from it carries them)');
    if (iss0[pubKey] && (iss0.overrides || []).indexOf(pubKey) === -1) ok(R.inherits(s0, tAdd, pubKey), 'the value equal to the title\'s (not listed as overridden) is inherited');
    const vmOf = st => SC.catalog.build(st, { titleIDs: [iss0.titleID], date: new Date(2026, 9, 9) });
    ['catalog', 'proofing', 'ris', 'bibtex'].forEach(o => ok(SC.outputs[o](vmOf(stS), {}) === SC.outputs[o](vmOf(re), {}), o + ': the same in the session and after a reload'));
  }
}

// ── Round 4: a ? on a value an issue takes from its title shows in every output ──
if (I && T) {
  console.log('· A ? on a value an issue inherits from its title is kept in the outputs (independent check, round 4)');
  const st = SC.createStore(); st.load(load([[T, titles], [I, text(I)]].concat(CO ? [[CO, text(CO)]] : [])).state);
  const i = Array.from(st.state.issues.values()).find(x => Object.keys(SC.schema.INHERIT).some(k => R.inherits(x, st.state.titles.get(x.titleID), k) && R.effective(x, st.state.titles.get(x.titleID), k)));
  if (i) {
    const t = st.state.titles.get(i.titleID);
    const k = Object.keys(SC.schema.INHERIT).find(x => R.inherits(i, t, x) && R.effective(i, t, x));
    const header = SC.schema.entities.issue.byKey.get(k).header;
    st.put('issue', Object.assign({}, i, { spec: i.spec.concat(header) }));
    const v = SC.catalog.issueView(st.state.issues.get(i.issueID), t);
    ok(v.inherited.has(k) && v.spec.has(k), 'the view keeps the issue\'s ? on its inherited ' + k);
    const vm = SC.catalog.build(st, { titleIDs: [i.titleID], date: new Date(2026, 9, 9) });
    const ris = SC.outputs.ris(vm, {});
    const label = SC.schema.entities.issue.byKey.get(k).label || header;
    if (st.contentsOfIssue(i.issueID).length) ok(ris.split('\n').some(l => /Speculative fields:/.test(l) && (l.indexOf(header + ' (issue)') !== -1 || l.indexOf(label + ' (issue)') !== -1)), 'RIS names it among the issue\'s speculative fields');
  }
}

// ── Every file of the library: read, write, read gives identical records, three times ──
console.log('· Every file in ' + path.basename(dir) + ' round-trips unchanged');
const original = load(names.map(n => [n, text(n)]));
const stR = SC.createStore(); stR.load(original.state);
let files = Array.from(stR.state.files.keys()).map(n => [n, R.writeFile(stR.state, n)]);
for (let k = 0; k < 3; k++) {
  const again = load(files);
  const st = SC.createStore(); st.load(again.state);
  const next = Array.from(st.state.files.keys()).map(n => [n, R.writeFile(st.state, n)]);
  eq(next.map(x => x[1].length), files.map(x => x[1].length), 'cycle ' + (k + 1) + ': same files');
  ok(next.every((x, j) => x[1] === files[j][1]), 'cycle ' + (k + 1) + ': byte-identical');
  files = next;
}
names.forEach(n => { if (stR.state.files.has(n)) ok(R.writeFile(stR.state, n) === text(n), n + ' is written back byte for byte when unchanged'); });

console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' data-safety checks' : 'PASSED ' + count + ' data-safety checks');
process.exit(fails ? 1 : 0);
