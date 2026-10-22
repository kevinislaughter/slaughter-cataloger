#!/usr/bin/env node
/* Tests for catalog search (js/core/search.js, docs/SEARCH.md).

   node tools/test-search.js
       the public suite, on the invented sample library and on libraries built here in memory.
       With SC_LIST_CHECKS=1 it lists every check it passes, not only failures. It ends with the
       performance measurements on a generated 10,000-item library (the representative test library).
       Performance, as accepted at the Phase 2 closeout (2026-10-15): first-use indexing and every
       search interaction must complete within 2,000 ms. Going over that limit fails the suite, as a
       severe regression. The Phase 2 budgets (a 300 ms first build on a mid-range laptop, 50 ms
       queries, …) are kept as diagnostic targets: every run measures them and reports each as met or
       NOT MET, but they never fail it. SC_PERF_SUMMARY=<file> appends a short table of the figures
       (run-tests.sh prints it at the end of a run); SC_SEARCH_TIMES=<file> writes every time as JSON.
       SC_BUDGET_MODE, the earlier shared-runner mode, is retired and has no effect.
   node tools/test-search.js --cold-build
       one build of the generated library in a fresh process, for the "first build" time (used by
       the suite itself).
   node tools/test-search.js --private <library folder>
       an optional timing run on a real library kept outside the repository: reads its CSV files in
       place, builds the index and runs queries made from its own words. Prints counts and times only,
       never a title, a credit or a word of text. Not part of the release check. */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store', 'toc', 'names', 'catalog', 'search'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const { makeLibrary, rng } = require('./lib/search-library');
const R = SC.records, NM = SC.names, X = SC.search;
const now = () => performance.now();

// Performance (Phase 2 closeout, 2026-10-15). LIMIT_MS is the only performance figure that fails the
// suite. TARGETS are the Phase 2 budgets, kept as diagnostics: measured and reported, never a failure.
const LIMIT_MS = 2000, LIMIT = '2,000 ms';
const TARGETS = { first_build: 300, full_build: 300, query_p95: 50, update: 5, names: 100 };
if (process.argv[2] === '--cold-build') {
  const st = makeLibrary();
  const ix = X.createIndex(() => st);
  const t = now(); ix.ensure();
  console.log(JSON.stringify({ ms: now() - t, stats: ix.stats() }));
  process.exit(0);
}
if (process.argv[2] === '--private') { privateRun(process.argv[3]); process.exit(0); }
if (process.env.SC_BUDGET_MODE) console.log('Note: SC_BUDGET_MODE ("' + process.env.SC_BUDGET_MODE + '") was retired at the Phase 2 closeout and has no effect. ' +
  'Only the ' + LIMIT + ' limit can fail this suite; the Phase 2 targets are reported as diagnostics in every run.');

let fails = 0, count = 0;
const LIST = process.env.SC_LIST_CHECKS === '1';
const ok = (cond, what, detail) => {
  count++;
  if (!cond) { fails++; console.log('FAIL ' + what + (detail !== undefined ? '\n   ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : '')); }
  else if (LIST) console.log('  ok   ' + what);
};
const eq = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), what, 'got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want));
const section = s => { if (LIST) console.log('· ' + s); };

// ── The sample library, read as the app reads it ──
const DIR = path.join(ROOT, 'sample-data', '3.0', 'example-library');
function readLibrary(dir) {
  const files = fs.readdirSync(dir).filter(n => /\.csv$/i.test(n)).sort().map(n => R.readFile(n, fs.readFileSync(path.join(dir, n), 'utf8'), { lastModified: 1000 }));
  return R.buildLibrary(files, {}).state;
}
const SAMPLE = readLibrary(DIR);
// A state whose maps refuse every change: search must never write to what it reads.
class Locked extends Map {
  constructor(m) { super(m); this.locked = true; }
  set(k, v) { if (this.locked) throw new Error('search tried to change the state (set ' + k + ')'); return super.set(k, v); }
  delete(k) { throw new Error('search tried to change the state (delete ' + k + ')'); }
  clear() { throw new Error('search tried to change the state (clear)'); }
}
const lock = st => Object.freeze({ library: Object.freeze(Object.assign({}, st.library)), titles: new Locked(st.titles), issues: new Locked(st.issues),
  contents: new Locked(st.contents), authorities: new Locked(st.authorities), files: new Locked(st.files) });
const LOCKED = lock(SAMPLE);
const index = st => { const ix = X.createIndex(() => st); ix.ensure(); return ix; };
const IX = index(LOCKED);
const run = (q, o) => IX.run(q, o);
const ids = (r, k) => r.groups[k].map(h => h.id);
const rec = (st, h) => h.kind === 'title' ? st.titles.get(h.id) : h.kind === 'issue' ? st.issues.get(h.id) : h.kind === 'item' ? st.contents.get(h.id) : null;
const GAZ = 'EXAGAZEX-1872';

// ═══ 1. Folding ═══
section('Folding and words');
[
  ['J.Q. Public', 'jq public'], ['J. Q. Public', 'j q public'], ['S.E.P.', 'sep'], ['e.g. no.5', 'eg no 5'], ['Vol.IV', 'vol iv'],
  ["O'Brien", 'obrien'], ['l’Isle', 'lisle'], ["'Twas", 'twas'], ['Café', 'cafe'], ['Café', 'cafe'],
  ['Æsop’s Fables', 'aesops fables'], ['STRAßE', 'strasse'], ['Øster Łódź', 'oster lodz'], ['Đorđe', 'dorde'],
  ['Þór', 'thor'], ['İstanbul', 'istanbul'], ['ΣΟΦΟΣ', 'σοφοσ'],
  ['The Example Gazette, Vol. IV', 'the example gazette vol iv'], ['J. Q. Public; Jane Doe', 'j q public jane doe'], ['5/6', '5 6'], ['1870–1875', '1870 1875'],
  ['\u{1D50A}azette', '\u{1D50A}azette'], ['  --  ', ''], ['', ''], [null, '']
].forEach(([s, want]) => eq(X.fold(s), want, 'fold ' + JSON.stringify(s) + ' → ' + JSON.stringify(want)));
{
  // The quick path for plain ASCII and the full path agree, on every kind of awkward input.
  const r = rng(7), chars = "aZq.'. -,;:/09J.Q.P.e.g'''..x  ’é́æ\u{1D50A}";
  const cps = Array.from(chars);
  let bad = 0, badTok = 0, badMap = 0;
  for (let n = 0; n < 20000; n++) {
    let t = ''; const L = 1 + Math.floor(r() * 16);
    for (let k = 0; k < L; k++) t += cps[Math.floor(r() * cps.length)];
    const a = X.fold(t), m = X.foldMapped(t);
    if (a !== m.text) bad++;
    if (JSON.stringify(a ? a.split(' ') : []) !== JSON.stringify(X.tokens(t))) badTok++;
    if (m.from.length !== m.text.length || m.from.some((f, k) => !(f >= 0 && m.to[k] <= t.length && f <= m.to[k]))) badMap++;
  }
  eq([bad, badTok, badMap], [0, 0, 0], 'fold, tokens and the mapped fold agree on 20,000 random strings, and every mapped position is in the text');
  // The quick credit key for plain ASCII is names.nameKey.
  let badKey = 0;
  const kchars = Array.from("aZq.'. -,;:/09J.Q.P&e.g'_()[]\u00e9\u0301 \u00e6");
  for (let n = 0; n < 20000; n++) { let t = ''; const L = Math.floor(r() * 16); for (let k = 0; k < L; k++) t += kchars[Math.floor(r() * kchars.length)]; if (X.nameKey(t) !== NM.nameKey(t)) badKey++; }
  eq(badKey, 0, 'search.nameKey agrees with names.nameKey on 20,000 random strings (ASCII and not)');
}
{
  const segs = (t, q) => X.highlight(t, q).map(s => (s.mark ? '[' + s.text + ']' : s.text)).join('');
  eq(segs('Café Society', 'cafe'), '[Café] Society', 'a match marks the accented word as typed');
  eq(segs('Café Society', 'cafe'), '[Café] Society', 'a combining accent is marked with its letter');
  eq(segs('The \u{1D50A}azette', '\u{1D50A}az'), 'The [\u{1D50A}az]ette', 'a letter outside the Basic Multilingual Plane is marked whole (a prefix)');
  eq(segs('Æsop’s Fables', 'aesops'), '[Æsop’s] Fables', 'a ligature and an apostrophe are marked in the original');
  eq(segs('A Word on the County Fair', '"county fair"'), 'A Word on the [County Fair]', 'a phrase is marked as one stretch');
  eq(X.highlight('J. Q. Public; Jane Doe', 'J.Q. Public', { credit: true }).map(s => (s.mark ? '[' + s.text + ']' : s.text)).join(''), '[J. Q. Public]; Jane Doe', 'in a credit, a credit matched by its key is marked whole');
  eq(segs('Cafe Society', 'cafe so'), '[Cafe] [So]ciety', 'outside credits, only the words matched are marked');
  eq(segs('Town Talk', 'tow'), '[Tow]n Talk', 'the last word as a prefix marks only what was typed');
  eq(segs('<img src=x onerror=alert(1)>', 'img'), '<[img] src=x onerror=alert(1)>', 'markup in a value is text, marked like any other text');
  const sn = X.snippet('Bound volume, complete. ' + 'x '.repeat(100) + 'Listed in a dealer catalogue near the end.', 'dealer', 60).map(s => s.text).join('');
  ok(sn.length <= 62 && /dealer/.test(sn) && /^…/.test(sn), 'a snippet shows the text around the first match, within its length', sn);
}

// ═══ 2. Query language ═══
section('Query language');
{
  const p = X.parse('gazette repo');
  eq([p.words, p.prefix], [['gazette', 'repo'], 'repo'], 'words; the last word is also a prefix');
  eq(X.parse('gazette r').prefix, '', 'a one-letter last word matches whole words only');
  eq(X.parse('gazette repo ').prefix, '', 'a space after the last word: no prefix');
  eq(X.parse('"around the county"').phrases.map(x => x.phrase), [['around', 'the', 'county']], 'a phrase');
  eq(X.parse('"around the county').phrases.map(x => x.phrase), [['around', 'the', 'county']], 'an unclosed quote is closed at the end');
  const f = X.parse('title:county credit:"j q public" type:poem year:1870-1875 id:EXAGAZEX-1872-K note:engraving in:gazette');
  eq(f.filters.map(x => x.field), ['title', 'credit', 'type', 'year', 'id', 'note', 'in'], 'every field filter');
  eq(f.filters.find(x => x.field === 'year').range, [1870, 1875], 'year: a range');
  eq(X.parse('year:1875-1870').filters[0].range, [1870, 1875], 'year: a range given backwards is turned round');
  eq(X.parse('year:1872').filters[0].range, [1872, 1872], 'year: one year');
  eq(f.filters.find(x => x.field === 'credit').key, 'jqpublic', 'credit: the value is also keyed as a credit is');
  eq(X.parse('ratio:2').words, ['ratio', '2'], 'an unknown field: the colon is read as text');
  eq(X.parse('Title:County').filters.map(x => x.field), ['title'], 'field names in any case');
  const y = X.parse('year:abc gazette');
  ok(!y.filters.length && /year: .*abc.* not a year/.test(y.notices.join(' ')) && y.words[0] === 'gazette', 'year:abc is a notice and is ignored', y);
  ok(/type: needs a value/.test(X.parse('type: poem').notices.join(' ')), 'an empty filter is a notice');
  const neg = X.parse('-notice');
  ok(!neg.positive && /exclusion needs something to search for/.test(neg.notices.join(' ')), 'exclusions alone: a notice');
  eq(run('-notice').total, 0, 'exclusions alone find nothing');
  eq(X.parse('GAZETTE RÉPORT').words, ['gazette', 'report'], 'upper case and accents in the query are folded like the documents');
  ok(/first 200 characters/.test(X.parse('word '.repeat(60)).notices.join(' ')), 'a query over 200 characters is cut, with a notice');
  ok(/first 32 terms/.test(X.parse(Array.from({ length: 40 }, (_, k) => 'w' + k).join(' ')).notices.join(' ')), 'a query over 32 terms is cut, with a notice');
  ok(X.parse('EXAGAZEX-1872-K7V47UA').ids.length === 1 && X.parse('au-7m4').ids.length === 1, 'an ID (or the start of one) typed as a word is matched as an ID');
  eq(X.parse('-type:notice -"town talk" -smith').neg.length, 3, 'exclusion of a filter, a phrase and a word');
  eq(X.without('public type:poem year:1872', 'type:poem'), 'public year:1872', 'a part can be taken out of the query');
  // The parser never throws.
  const r = rng(3), alphabet = 'ab "-:\\\'yeartitlecreditin:id-12–*()[]{}é\u{1D50A}\u0000\n';
  let threw = 0;
  for (let n = 0; n < 5000; n++) { let s = ''; const L = Math.floor(r() * 40); for (let k = 0; k < L; k++) s += Array.from(alphabet)[Math.floor(r() * Array.from(alphabet).length)]; try { X.parse(s); IX.run(s); } catch (e) { threw++; } }
  eq(threw, 0, 'parsing and running 5,000 random queries never throws');
}

// ═══ 3. Matching on the sample library ═══
section('Matching on the sample library');
{
  const g = run('gazette');
  eq(ids(g, 'title'), [GAZ], '"gazette" finds the Gazette title');
  eq(g.counts.issue, 309, '"gazette" finds the Gazette\'s 309 issues by their short names');
  const forms = ['J. Q. Public', 'J.Q. Public', 'j q public', 'credit:"J. Q. Public"', 'credit:jqpublic', '"J. Q. Public"'].map(q => ids(run(q), 'item').slice().sort());
  ok(forms.every(f => f.length === 88 && JSON.stringify(f) === JSON.stringify(forms[0])), 'J. Q. Public, J.Q. Public, j q public, as a credit filter and as a phrase: the same 88 items', forms.map(f => f.length));
  ok(ids(run('J.Q. Public'), 'item').every(id => SAMPLE.contents.get(id).author.split(/\s*;\s*/).some(a => NM.nameKey(a) === 'jqpublic')), 'each of them is credited to J. Q. Public');
  eq(run('Jno. Q. Public').groups.item.filter(h => NM.nameKey(SAMPLE.contents.get(h.id).author) === 'johnqpublic').length, 0, 'no new equivalences: "Jno. Q. Public" does not find John Q. Public without a heading');
  const poems = run('in:gazette type:poem');
  ok(poems.counts.item === 79 && poems.groups.item.every(h => R.titleOfContent(SAMPLE, SAMPLE.contents.get(h.id)) === GAZ && SAMPLE.contents.get(h.id).contentType === 'poem') && !poems.counts.title, 'in:gazette type:poem: the Gazette\'s 79 poems, nothing else');
  const y = run('year:1872');
  ok(y.groups.issue.every(h => SAMPLE.issues.get(h.id).year === '1872') && y.counts.issue === 35, 'year:1872: the 35 issues of 1872');
  ok(y.groups.item.every(h => SAMPLE.issues.get(SAMPLE.contents.get(h.id).issueID).year === '1872'), 'year:1872: items through their issue');
  eq(ids(y, 'title'), [GAZ], 'year:1872: the title with an issue in it');
  const yr = run('year:1990-1991');
  ok(yr.groups.issue.every(h => { const i = SAMPLE.issues.get(h.id); return +i.year <= 1991 && +(i.yearEnd || i.year) >= 1990; }) && yr.counts.issue > 0, 'year: a range finds issues that overlap it');
  ok(run('id:EXAGAZEX-1872-K').groups.issue.length === 309 && run('id:exagazex-1872-k').counts.issue === 309, 'id: a prefix of the IssueIDs, in any case');
  const exact = run('EXAGAZEX-1872-K7V47UA');
  ok(exact.groups.issue[0].id === 'EXAGAZEX-1872-K7V47UA' && exact.groups.issue[0].tier === 1, 'an exact IssueID comes first (tier 1)');
  const tid = run('exagazex-1872');
  ok(tid.groups.title[0].id === GAZ && tid.groups.title[0].tier === 1 && tid.counts.issue === 309, 'an exact TitleID, in lower case: the title first, then everything of that title');
  eq(run('anytown').groups.issue.length, 0, '"anytown": the Gazette\'s place is found on the title, not on its issues (inherited, S-2)');
  ok(run('springfield').groups.issue.some(h => SAMPLE.issues.get(h.id).titleID === GAZ), 'an issue that sets its own place (an override) is found by it');
  const vol = run('vol 4 no 1');
  ok(vol.groups.issue[0] && SAMPLE.issues.get(vol.groups.issue[0].id).volume === '4' && SAMPLE.issues.get(vol.groups.issue[0].id).issue === '1', '"vol 4 no 1": volume 4, number 1 first');
  ok(run('title:county').groups.item.length > 0 && run('title:county').groups.item.every(h => /county/i.test(SAMPLE.contents.get(h.id).itemTitle)), 'title: an item\'s title');
  ok(run('note:dealers').groups.issue.length > 0 && run('note:dealers').groups.issue.every(h => /dealer/i.test(SAMPLE.issues.get(h.id).evidenceNote + SAMPLE.issues.get(h.id).notes)), 'note: the note fields only');
  const ex = run('smith -john');
  ok(ex.counts.item > 0 && ex.groups.item.every(h => !/john/i.test(SAMPLE.contents.get(h.id).author + SAMPLE.contents.get(h.id).itemTitle)), 'an exclusion leaves out what matches it');
  ok(run('public -type:editorial').groups.item.every(h => SAMPLE.contents.get(h.id).contentType !== 'editorial'), 'an excluded filter');
  ok(run('"town talk"').groups.item.every(h => /town talk/i.test(SAMPLE.contents.get(h.id).itemTitle)) && run('"town talk"').counts.item > 0, 'a phrase: the words in order');
  eq(run('"talk town"').counts.item, 0, 'a phrase in another order finds nothing');
  ok(run('pérez').counts.item > 0 && run('perez').counts.item === run('pérez').counts.item, 'accents: pérez and perez find the same');
  ok(run('town ta').groups.item[0] && /^Town Talk/.test(SAMPLE.contents.get(run('town ta').groups.item[0].id).itemTitle), 'a prefix on the last word (town ta → Town Talk)');
  eq(run('type:po').counts.item, run('type:poem').counts.item, 'type: allows a prefix');
  ok(run('in:EXAGAZEX-1872 public').groups.item.every(h => R.titleOfContent(SAMPLE, SAMPLE.contents.get(h.id)) === GAZ), 'in: by TitleID');
  ok(run('public').groups.name.some(h => h.id === 'k:jqpublic'), 'names: a credited name with no heading is found by its forms');
}

// ═══ 4. Credits and headings (headings built in memory; the sample library is unchanged) ═══
section('Credits and headings');
const HEADED = (() => {
  const st = Object.assign({}, SAMPLE, { authorities: new Map() });
  const put = (id, name, variants, eo, extra) => st.authorities.set(id, R.freezeRec(Object.assign({ _src: 'SCAT_EXAMPLE-LIBRARY_AUTHORITIES.csv', authorityID: id, name, nameType: 'Person',
    variants, status: 'Needs review', spec: [], na: [], speculative: false, entryOrder: eo }, extra || {})));
  put('AU-PUB234', 'Public, John Q.', 'John Q. Public | J. Q. Public | J.Q.P. | Jno. Q. Public', 1, { dates: '1840–1910', notes: 'Editor of the Gazette.' });
  put('AU-ROE234', 'Roe, Mary', 'Mary Roe | Dr. Mary Roe', 2);
  return lock(st);
})();
const HX = index(HEADED);
{
  const r = HX.run('Public, John Q.');
  eq(r.groups.name[0] && r.groups.name[0].id, 'AU-PUB234', 'the heading is found by its authorized form');
  const via = r.groups.item.filter(h => h.tier === 3);
  ok(via.length > 0 && via.every(h => h.via && h.via.headingID === 'AU-PUB234'), 'heading expansion: items credited under any of its forms, labelled with the heading', via.slice(0, 2));
  ok(via.some(h => h.via.form === 'J.Q.P.') && via.some(h => h.via.form === 'Jno. Q. Public'), 'expansion brings in J.Q.P. and Jno. Q. Public, labelled with the form credited');
  const tiers = r.groups.item.map(h => h.tier);
  ok(tiers.indexOf(3) === -1 || tiers.slice(tiers.indexOf(3)).every(t => t === 3), 'expanded items rank below every direct match');
  ok(HX.run('john q public').groups.item.some(h => h.via && h.via.form === 'J.Q.P.'), '"john q public" (its direct order) also brings in J.Q.P.');
  ok(HX.run('public john type:poem').groups.item.every(h => SAMPLE.contents.get(h.id).contentType === 'poem'), 'expanded items still pass the other filters');
  ok(HX.run('Public, John Q. -type:editorial').groups.item.every(h => SAMPLE.contents.get(h.id).contentType !== 'editorial'), 'and the exclusions');
  eq(HX.run('editor of the gazette').groups.item.filter(h => h.tier === 3).length, 0, 'a heading matched only by its notes brings in no items');
  eq(HX.run('roe mary').groups.name[0].id, 'AU-ROE234', 'a heading matched by its direct order');
  ok(HX.run('credit:"Dr. Mary Roe"').groups.item.length > 0, 'credit: a form listed under a heading');
  ok(HX.run('Public, John Q.', { expand: false }).groups.item.every(h => h.tier !== 3), 'expansion can be turned off');
  // names.index and the search's own name list agree, entry for entry.
  const pic = ix => JSON.stringify({ e: ix.entries.map(e => [e.id, e.kind, e.label, e.sort, e.keys, e.forms, e.count, e.authority ? e.authority.authorityID : null]),
    f: Array.from(ix.forms).map(([k, f]) => [k, Array.from(f.forms), f.count, f.items]), h: Array.from(ix.headingOfKey), c: ix.conflicts });
  ok(pic(NM.index(SAMPLE)) === pic(X.nameIndex(SAMPLE)), 'the search\'s name list is names.index, on the sample');
  ok(pic(NM.index(HEADED)) === pic(X.nameIndex(HEADED)), 'and on the sample with headings');
  const small = makeLibrary({ titles: 6, issuesPerTitle: 5, itemsPerIssue: 8, headings: 150 });
  ok(pic(NM.index(small)) === pic(X.nameIndex(small)), 'and on a generated library with 150 headings');
  ok(Array.from(small.authorities.values()).every(a => JSON.stringify(X.nameIndex({ contents: new Map(), authorities: new Map([[a.authorityID, a]]) }).entries[0].headingKeys) === JSON.stringify(NM.headingKeys(a))), 'each heading\'s keys are names.headingKeys');
  const conflict = Object.assign({}, HEADED, { authorities: new Map(HEADED.authorities) });
  conflict.authorities.set('AU-DUP234', R.freezeRec({ _src: 'A.csv', authorityID: 'AU-DUP234', name: 'Public, J. Q.', variants: 'J. Q. Public', status: 'Needs review', spec: [], na: [], entryOrder: 3 }));
  ok(pic(NM.index(conflict)) === pic(X.nameIndex(conflict)) && X.nameIndex(conflict).conflicts.length > 0, 'and when a form is listed under two headings');
}

// ═══ 5. Ranking ═══
section('Ranking');
{
  // A small library made here, to show each quality factor.
  const st = Object.assign({}, SAMPLE, { titles: new Map(), issues: new Map(), contents: new Map(), authorities: new Map() });
  const t = R.freezeRec({ _src: 'T.csv', titleID: 'RANKTEST-1900', titleCode: 'RANKTEST', firstYear: '1900', canonicalTitle: 'Ranking Test', spec: [], na: [], entryOrder: 1 });
  st.titles.set(t.titleID, t);
  const i = R.freezeRec({ _src: 'I.csv', issueID: 'RANKTEST-1900-K2222222', titleID: t.titleID, shortname: 'RT 1', volume: '1', issue: '1', year: '1900', spec: [], na: [], overrides: [], entryOrder: 1 });
  st.issues.set(i.issueID, i);
  const item = (n, title, extra) => { const c = R.freezeRec(Object.assign({ _src: 'C.csv', contentID: 'RANKTEST-1900-C' + String(n).repeat(6), issueID: i.issueID, titleID: t.titleID, sequence: String(n), parentID: '', parentItem: '',
    itemTitle: title, author: '', contentType: 'article', startPage: '', endPage: '', notes: '', spec: [], na: [], speculative: false, entryOrder: n }, extra || {})); st.contents.set(c.contentID, c); return c.contentID; };
  const prefixOnly = item(2, 'Lanterns of the Town');
  const tokenMid = item(3, 'A Lantern Here');
  const atStart = item(4, 'Lantern Days');
  const whole = item(5, 'Lantern');
  const inNote = item(6, 'Something Else', { notes: 'lantern' });
  const inCredit = item(7, 'Another Thing', { author: 'Lantern' });
  const r = X.createIndex(() => st).run('lantern ');
  eq(ids(r, 'item'), [whole, inCredit, atStart, tokenMid, inNote], 'whole field (title 10×3) > a credit that is the whole field (8×3) > first word (10×1.5) > a word (10) > a note (1); with a space after it, "lantern" does not find "Lanterns"');
  const p = X.createIndex(() => st).run('lantern');
  const pi = ids(p, 'item');
  ok(pi.indexOf(prefixOnly) !== -1 && pi.indexOf(prefixOnly) > pi.indexOf(tokenMid) && pi.indexOf(prefixOnly) < pi.indexOf(inNote), 'as the last word, "lantern" is also a prefix: "Lanterns" (10×1.5×0.6) comes below the whole words and above the note', pi);
  // Ties fall back to catalog order: issue order, then Sequence.
  const ties = run('type:poem').groups.item.map(h => h.id);
  const order = [];
  const store = SC.createStore(); store.load(SAMPLE);
  SC.catalog.titleOrder(SAMPLE, Array.from(SAMPLE.titles.keys())).forEach(tid => store.issuesOfTitle(tid).forEach(iss => store.contentsOfIssue(iss.issueID).forEach(c => { if (c.contentType === 'poem') order.push(c.contentID); })));
  eq(ties, order, 'equal scores keep catalog order (title, issue run, Sequence), as the Contents stage shows them');
  eq(run('public', { order: 'catalog' }).groups.item.map(h => h.id), (() => { const out = []; SC.catalog.titleOrder(SAMPLE, Array.from(SAMPLE.titles.keys())).forEach(tid => store.issuesOfTitle(tid).forEach(iss => store.contentsOfIssue(iss.issueID).forEach(c => { if (run('public').groups.item.some(h => h.id === c.contentID)) out.push(c.contentID); }))); return out; })(),
    'catalog order: items exactly in the order of the catalog');
  const a = JSON.stringify(run('public')), b = JSON.stringify(run('public')), c2 = JSON.stringify(index(LOCKED).run('public'));
  ok(a.replace(/"ms":[\d.]+/, '') === b.replace(/"ms":[\d.]+/, '') && a.replace(/"ms":[\d.]+/, '') === c2.replace(/"ms":[\d.]+/, ''), 'the same query on the same library gives the same results in the same order, every time (3 runs, 2 indexes)');
  ok(run('gazette').groups.issue.every((h, k, arr) => !k || arr[k - 1].score >= h.score), 'within a group, higher scores first');
}

// ═══ 6. Golden results on the sample library ═══
section('Golden results on the sample library');
const GOLDEN = require('./lib/search-golden.json');
Object.keys(GOLDEN).forEach(q => {
  const r = run(q);
  const got = { counts: r.counts, first: Object.fromEntries(X.KINDS.map(k => [k, ids(r, k).slice(0, 5)])) };
  eq(got, GOLDEN[q], 'golden: ' + q);
});

// ═══ 7. Inheritance, orphans, field states ═══
section('Inheritance, orphan records, field states');
{
  // An issue whose title is not in the Titles file is still found, with its own TitleID.
  const st = Object.assign({}, SAMPLE, { titles: new Map(SAMPLE.titles) });
  st.titles.delete('DEMQUARX-1995');
  const ox = X.createIndex(() => st);
  const r = ox.run('id:DEMQUARX-1995');
  ok(r.counts.issue === 2 && r.groups.issue.every(h => ox.doc(h.key).titleID === 'DEMQUARX-1995') && r.counts.title === 0, 'issues of a title missing from the Titles file are found, under their TitleID');
  // An item whose issue is not in any Issues file.
  const st2 = Object.assign({}, SAMPLE, { issues: new Map(SAMPLE.issues) });
  const someItem = Array.from(SAMPLE.contents.values()).find(c => c.issueID && SAMPLE.contents.get(c.contentID).itemTitle === 'Town Talk');
  st2.issues.delete(someItem.issueID);
  const ox2 = X.createIndex(() => st2);
  ok(ox2.run('id:' + someItem.contentID).counts.item === 1 && ox2.doc('item:' + someItem.contentID).titleID === GAZ, 'an item whose issue is missing is found, under its title');
  ok(ox2.run('town talk', { order: 'catalog' }).counts.item === run('town talk').counts.item, 'and orphans sort after their title\'s run in catalog order');
  // Field states.
  const st3 = Object.assign({}, SAMPLE, { contents: new Map(SAMPLE.contents) });
  const base = Array.from(SAMPLE.contents.values())[0];
  st3.contents.set('EXAGAZEX-1872-CSPECCC', R.freezeRec(Object.assign({}, base, { contentID: 'EXAGAZEX-1872-CSPECCC', itemTitle: 'Zyzzyva Notes', notes: 'zzonly', spec: ['Notes'], na: [], speculative: true })));
  st3.contents.set('EXAGAZEX-1872-CNAAAAA', R.freezeRec(Object.assign({}, base, { contentID: 'EXAGAZEX-1872-CNAAAAA', itemTitle: 'Other', notes: 'zznever', spec: [], na: ['Notes'] })));
  const fx = X.createIndex(() => st3);
  eq(fx.run('zzonly').counts.item, 1, 'a speculative value is searched like any value');
  eq(fx.run('zznever').counts.item, 0, 'a field marked N/A holds no value, so nothing matches in it');
  ok(run('blank').counts.item === 0 || run('blank').groups.item.every(h => /blank/i.test(JSON.stringify(SAMPLE.contents.get(h.id)))), 'an unaddressed field is blank and matches nothing');
  // Not searched.
  const keys = new Set();
  IX.run('in:a').groups.item.forEach(() => {});
  ['Speculative', 'Overridden', 'Schema', 'Slaughter', 'Entry'].forEach(w => keys.add(run(w.toLowerCase()).total));
  ok(run('evidence examined').counts.issue === 0 && run('months').counts.issue === 0, 'coded fields (Evidence: Examined) and field names are not searched');
  const doc = IX.doc('item:' + someItem.contentID);
  ok(doc.fields.every(f => ['itemTitle', 'author', 'contentType', 'notes', 'pages'].indexOf(f.name) !== -1), 'an item is indexed by its title, credit, type, pages and notes, and nothing else', doc.fields.map(f => f.name));
  const sec = run('"town talk"').groups.item[0];
  ok(sec && IX.doc(sec.key).fields.every(f => f.name !== 'parentItem'), 'Parent Item text is not matched (it repeats the parent\'s own title)');
}

// ═══ 8. The index kept up by store events equals one built afresh ═══
section('Incremental index');
{
  const store = SC.createStore();
  store.load(readLibrary(DIR));
  const ix = X.createIndex(() => store.state);
  let events = 0;
  store.subscribe((v, e) => { events++; if (e.type === 'load') ix.reset(); else if (e.type === 'change') ix.update(e.changed); });
  ix.ensure();
  const r = rng(99);
  const pick = m => { const a = Array.from(m.values()); return a[Math.floor(r() * a.length)]; };
  const words = ['Lantern', 'Gazette', 'Public', 'Zephyr Quill', 'J.Q.P.', 'Jane Doe; Richard Roe', 'Town', 'notice', '', 'Café Æsop'];
  const w = () => words[Math.floor(r() * words.length)];
  const queries = ['public', 'gazette', 'lantern', 'zephyr', 'j q public', 'type:poem', 'year:1872', 'in:gazette town', 'credit:jqp', '"town talk"', 'cafe aesop', 'roe'];
  let mismatches = 0, docMismatch = 0, steps = 0;
  const compare = () => {
    const fresh = X.createIndex(() => store.state);
    const a = ix.dump(), b = fresh.dump();
    if (JSON.stringify(a) !== JSON.stringify(b)) docMismatch++;
    queries.forEach(q => { const x = ix.run(q), y = fresh.run(q); if (JSON.stringify([x.counts, x.groups]) !== JSON.stringify([y.counts, y.groups])) mismatches++; });
  };
  for (let n = 0; n < 500; n++) {
    const k = r();
    if (k < 0.3) { const c = pick(store.state.contents); store.put('content', Object.assign({}, c, { itemTitle: w() + ' ' + c.itemTitle.split(' ')[0] }), 'edit'); }
    else if (k < 0.45) { const c = pick(store.state.contents); store.put('content', Object.assign({}, c, { author: w() }), 'credit'); }
    else if (k < 0.55) { const c = pick(store.state.contents); store.remove('content', c.contentID, 'remove'); }
    else if (k < 0.62) { const i = pick(store.state.issues); store.put('issue', Object.assign({}, i, { shortname: w() + ' ' + i.volume, notes: w() }), 'issue'); }
    else if (k < 0.67) { const t = pick(store.state.titles); store.put('title', Object.assign({}, t, { canonicalTitle: w() + ' ' + t.titleCode, city: w() }), 'title'); }
    else if (k < 0.72) {
      const id = 'AU-' + String(n).padStart(6, '2').replace(/[01]/g, '3');
      store.put('authority', { _src: 'SCAT_EXAMPLE-LIBRARY_AUTHORITIES.csv', authorityID: id, name: 'Public, John Q.', variants: w() + ' | J.Q.P.', status: 'Needs review', spec: [], na: [], speculative: false, entryOrder: n }, 'heading');
    }
    else if (k < 0.8) store.batch('batch', () => { for (let j = 0; j < 3; j++) { const c = pick(store.state.contents); store.put('content', Object.assign({}, c, { notes: w(), sequence: String(1 + Math.floor(r() * 20)) })); } });
    else if (k < 0.9) store.undo();
    else if (k < 0.97) store.redo();
    else store.load(readLibrary(DIR));
    steps++;
    if (n % 50 === 49) compare();
  }
  compare();
  eq([docMismatch, mismatches], [0, 0], 'after 500 random puts, removals, batches, undos, redos and loads (fixed seed), the index kept up by updates is the same as one built afresh, and gives the same results for 12 queries');
  ok(events >= steps * 0.8, 'the store sent its events (' + events + ')');
  const before = ix.run('lantern').counts.item;
  const c = Array.from(store.state.contents.values())[3];
  store.put('content', Object.assign({}, c, { itemTitle: 'Lantern Lantern' }), 'title');
  ok(ix.run('lantern').counts.item === before + (/lantern/i.test(c.itemTitle) ? 0 : 1), 'an edit shows in the next query without a rebuild');
  store.undo();
  eq(ix.run('lantern').counts.item, before, 'and its undo too');
  ok(ix.stats().builds >= 1 && ix.stats().updates > 0, 'updates were incremental (' + ix.stats().updates + ' updates, ' + ix.stats().builds + ' full builds, after loads)');
}

// ═══ 9. Read-only ═══
section('Read-only');
{
  // Every query above ran against a locked state: any write would have thrown.
  let threw = '';
  try { ['public', 'gazette', 'year:1870-1880 type:poem', 'credit:"j q public"', 'in:gazette -town', 'id:EXAGAZEX', 'Public, John Q.'].forEach(q => { IX.run(q); HX.run(q); IX.run(q, { order: 'catalog' }); }); } catch (e) { threw = e.message; }
  eq(threw, '', 'searching a locked state never writes to it (titles, issues, contents, authorities, files)');
  ok(Array.from(SAMPLE.contents.values()).every(Object.isFrozen) && Array.from(SAMPLE.issues.values()).every(Object.isFrozen), 'the records searched are frozen');
  const store = SC.createStore(); store.load(readLibrary(DIR));
  const ix = X.createIndex(() => store.state);
  store.subscribe((v, e) => { if (e.type === 'change') ix.update(e.changed); });
  const snap = () => JSON.stringify([store.version, Array.from(store.dirty), store.canUndo, store.canRedo, store.undoLabel, Array.from(store.revisions())]);
  const s0 = snap();
  ['public', 'gazette', 'type:poem', 'Public, John Q.', 'year:1872', ''].forEach(q => { ix.run(q); ix.run(q, { order: 'catalog' }); ix.doc('title:' + GAZ); ix.names(); });
  eq(snap(), s0, 'a search session changes nothing in the store: version, changed files, undo and redo, revisions');
  // Static: the search modules name no store mutator, no storage and nothing of issue packages.
  const sources = ['js/core/search.js', 'js/ui/search.js'].filter(f => fs.existsSync(path.join(ROOT, f)));
  const forbidden = [/\.put\(/, /\.remove\(/, /\.batch\(/, /\.undo\(/, /\.redo\(/, /\.load\(/, /markDirty/, /markSaved/, /setFileMeta/, /setLibrary/, /session\.save/,
    /localStorage/, /sessionStorage/, /indexedDB/, /innerHTML/, /dangerouslySetInnerHTML/, /_issues/, /mentions/, /text\.json/, /issuepkg/, /zipread/];
  sources.forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const hits = forbidden.filter(re => re.test(src)).map(String);
    eq(hits, [], f + ' names no store mutator, no browser storage, no innerHTML and nothing of issue packages');
  });
  ok(sources.length === 2 || !fs.existsSync(path.join(ROOT, 'js/ui/search.js')), 'both search modules checked (' + sources.join(', ') + ')');
}

// ═══ 10. Performance on the generated 10,000-item library ═══
// The representative test library: every figure below is measured on it, in the same way on every run.
// A figure over LIMIT_MS fails (a severe regression); the Phase 2 TARGETS are reported, never failed.
section('Performance (10,000 items)');
const times = {};
let perfNotMet = 0;
{
  const cold = [];
  for (let k = 0; k < 5; k++) {
    const r = cp.spawnSync(process.execPath, [__filename, '--cold-build'], { encoding: 'utf8' });
    if (r.status === 0) cold.push(JSON.parse(r.stdout).ms);
  }
  const st = makeLibrary();
  const counts = { titles: st.titles.size, issues: st.issues.size, items: st.contents.size, headings: st.authorities.size };
  const warm = [], phases = [];
  let built = null;
  for (let k = 0; k < 5; k++) {
    X.clearCaches();
    if (global.gc) global.gc();
    const ix = X.createIndex(() => st);
    const t = now(); ix.ensure(); warm.push(now() - t);
    phases.push(Object.assign({ names: ix.stats().namesMs, order: ix.stats().orderMs }, ix.stats().phases));
    built = ix;
  }
  const s = built.stats();
  const vocabulary = s.terms;
  // 40 queries: two-letter prefixes, words, phrases, every filter, exclusions, IDs, heading expansion.
  const r = rng(5);
  const someItems = Array.from(st.contents.values());
  const word = () => { const c = someItems[Math.floor(r() * someItems.length)]; const t = X.tokens(c.itemTitle); return t[Math.floor(r() * t.length)]; };
  const heads = Array.from(st.authorities.values());
  const qs = [];
  for (let k = 0; k < 8; k++) qs.push(word());
  for (let k = 0; k < 6; k++) qs.push(word().slice(0, 2));
  for (let k = 0; k < 6; k++) qs.push(word() + ' ' + word().slice(0, 3));
  for (let k = 0; k < 4; k++) { const c = someItems[Math.floor(r() * someItems.length)]; qs.push('"' + X.tokens(c.itemTitle).slice(0, 2).join(' ') + '"'); }
  qs.push('type:poem', 'type:re', 'year:1900-1910', 'year:1950', 'in:the ' + word(), 'note:' + word(), 'title:' + word(), 'id:' + Array.from(st.titles.keys())[7]);
  for (let k = 0; k < 4; k++) qs.push(heads[k * 13].name);
  qs.push(word() + ' -' + word(), '-type:poem ' + word(), 'credit:' + heads[3].variants.split(' | ')[1], Array.from(st.issues.keys())[100]);
  const qt = [], big = [];
  qs.forEach(q => { built.run(q); const t = now(); const res = built.run(q); qt.push(now() - t); big.push(res.total); });
  const sorted = qt.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  // One record changed; the names rebuilt after a credit change; the first query after an edit.
  const store = SC.createStore(); store.load(st);
  const ix = X.createIndex(() => store.state);
  store.subscribe((v, e) => { if (e.type === 'load') ix.reset(); else if (e.type === 'change') ix.update(e.changed); });
  ix.ensure(); ix.run('the');
  const upd = [], names = [], after = [];
  for (let k = 0; k < 10; k++) {
    const c = someItems[k * 97];
    store.put('content', Object.assign({}, store.state.contents.get(c.contentID), { itemTitle: c.itemTitle + ' revised' }));
    upd.push(ix.stats().lastUpdateMs);
    let t = now(); ix.run(word()); after.push(now() - t);
    store.put('content', Object.assign({}, store.state.contents.get(c.contentID), { author: 'Zed Q. Newname' + k }));
    t = now(); ix.ensure(); names.push(now() - t);
  }
  const heap = process.memoryUsage().heapUsed;
  // How fast this machine is right now, so the times can be read: shared machines vary a lot.
  const sortMs = [];
  for (let k = 0; k < 3; k++) { const a = Array.from({ length: 1e6 }, Math.random); const t = now(); a.sort((x, y) => x - y); sortMs.push(now() - t); }
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const max = a => Math.max.apply(null, a);
  const r1 = n => Math.round(n * 10) / 10;
  // The Phase 2 budgets, as diagnostics: [what, measured, target ms, note].
  const diag = [
    ['first build in a fresh process, median of 5', med(cold), TARGETS.first_build, 'set for a mid-range laptop'],
    ['full build, median of 5', med(warm), TARGETS.full_build, ''],
    ['query, 95th percentile of 40', p95, TARGETS.query_p95, ''],
    ['one record updated, slowest of 10', max(upd), TARGETS.update, ''],
    ['names after a credit change, slowest of 10', max(names), TARGETS.names, '']
  ];
  // The limit: first-use indexing and every search interaction measured here.
  const limits = [
    ['first-use indexing: first build in a fresh process (median of 5)', cold.length === 5 ? med(cold) : Infinity],
    ['full build (median of 5)', med(warm)],
    ['slowest of the 40 queries', max(qt)],
    ['slowest first query after an edit', max(after)],
    ['slowest record update', max(upd)],
    ['slowest names rebuild after a credit change', max(names)]
  ];
  const notMet = diag.filter(d => d[1] > d[2]);
  const slowest = Math.max.apply(null, limits.map(l => l[1]));
  Object.assign(times, {
    library: counts, distinct_words: vocabulary, documents: s.docs,
    cold_first_build_ms: cold, build_ms: warm, build_median_ms: med(warm), build_phases_ms: phases,
    queries: qs.length, query_ms: qt, query_p95_ms: p95, query_median_ms: med(qt), query_max_ms: max(qt), largest_result: max(big),
    update_ms: upd, update_max_ms: max(upd), names_rebuild_ms: names, names_rebuild_max_ms: max(names), first_query_after_edit_ms: after,
    heap_used_mb: Math.round(heap / 1048576), node: process.version, machine_sort_1e6_ms: sortMs,
    limit_ms: LIMIT_MS, limit_held: slowest <= LIMIT_MS, slowest_limited_ms: slowest,
    diagnostic_targets_ms: TARGETS, diagnostic_targets_met: Object.fromEntries(Object.keys(TARGETS).map((k, n) => [k, diag[n][1] <= diag[n][2]])),
    first_build_target_ms: TARGETS.first_build, first_build_median_ms: med(cold), first_build_target_met_on_this_hardware: med(cold) <= TARGETS.first_build
  });
  console.log('Performance, generated library: ' + counts.titles + ' titles, ' + counts.issues + ' issues, ' + counts.items + ' items, ' + counts.headings + ' headings; ' + vocabulary + ' distinct words; ' + s.docs + ' documents');
  console.log('  first build, 5 fresh processes (ms): ' + cold.map(r1).join(', ') + '  (median ' + r1(med(cold)) + ')');
  console.log('  full build, 5 runs (ms):          ' + warm.map(r1).join(', ') + '  (median ' + r1(med(warm)) + ')');
  console.log('  query, 40 queries (ms):           median ' + r1(med(qt)) + ', 95th percentile ' + r1(p95) + ', slowest ' + r1(max(qt)));
  console.log('  one record updated (ms):          ' + upd.map(r1).join(', '));
  console.log('  names after a credit change (ms): ' + names.map(r1).join(', '));
  console.log('  first query after an edit (ms):   ' + after.map(r1).join(', '));
  console.log('  heap after building: ' + times.heap_used_mb + ' MB (the whole test process; reported only)');
  console.log('  this machine sorts 1,000,000 numbers in ' + sortMs.map(r1).join(', ') + ' ms (a typical current laptop: roughly 150–250 ms)');
  console.log('  LIMIT (fails the suite): ' + LIMIT + ' for first-use indexing and every search interaction: ' + (slowest <= LIMIT_MS ? 'held; the slowest figure is ' + r1(slowest) + ' ms' : 'EXCEEDED: ' + r1(slowest) + ' ms'));
  console.log('  Phase 2 targets (diagnostic: reported, never a failure):');
  diag.forEach(d => console.log('    ' + (d[1] <= d[2] ? 'met    ' : 'NOT MET') + '  ' + d[0] + ': ' + r1(d[1]) + ' ms (target ' + d[2] + ' ms' + (d[3] ? ', ' + d[3] : '') + ')'));
  if (notMet.length) console.log('  WARNING: ' + notMet.length + ' of ' + diag.length + ' Phase 2 targets NOT MET on this machine (not a failure; see docs/SEARCH.md §10)');
  ok(vocabulary >= 25000, 'the generated library has a realistic vocabulary (' + vocabulary + ' distinct words)');
  limits.forEach(l => ok(l[1] <= LIMIT_MS, l[0] + ' within the ' + LIMIT + ' limit (' + r1(l[1]) + ' ms)'));
  if (process.env.SC_SEARCH_TIMES) fs.writeFileSync(process.env.SC_SEARCH_TIMES, JSON.stringify(times, null, 2) + '\n');
  if (process.env.SC_PERF_SUMMARY) {
    const row = (what, ms, target) => '  ' + (what + ' ').padEnd(46, '.') + ' ' + (r1(ms) + ' ms').padStart(10) + '   target ' + (target + ' ms').padEnd(7) + (ms <= target ? 'met    ' : 'NOT MET') + '   limit 2,000: ' + (ms <= LIMIT_MS ? 'held' : 'EXCEEDED');
    fs.appendFileSync(process.env.SC_PERF_SUMMARY, ['Node (tools/test-search.js), generated 10,000-item library; this machine sorts 1,000,000 numbers in ' + Math.round(med(sortMs)) + ' ms:',
      row('first build, fresh process (median of 5)', med(cold), TARGETS.first_build), row('full build (median of 5)', med(warm), TARGETS.full_build),
      row('query (95th percentile of 40)', p95, TARGETS.query_p95), row('one record updated (slowest)', max(upd), TARGETS.update),
      row('names after a credit change (slowest)', max(names), TARGETS.names),
      '  ' + ('slowest query / first query after an edit ').padEnd(46, '.') + ' ' + (r1(max(qt)) + ' / ' + r1(max(after)) + ' ms').padStart(10) + '   (no target)        limit 2,000: ' + (Math.max(max(qt), max(after)) <= LIMIT_MS ? 'held' : 'EXCEEDED'), ''].join('\n'));
  }
  perfNotMet = notMet.length;
}

console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' search checks' : 'PASSED ' + count + ' search checks' +
  (perfNotMet ? '; ' + perfNotMet + ' Phase 2 performance targets NOT MET on this machine (diagnostic, not failures; listed above)' : ''));
process.exit(fails ? 1 : 0);

// ── The private timing run ──
function privateRun(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('usage: node tools/test-search.js --private <library folder>'); process.exit(2); }
  const rel = path.relative(ROOT, path.resolve(dir));
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) { console.error('The library is inside the repository. Keep real libraries outside it.'); process.exit(2); }
  const st = readLibrary(dir);
  const ix = X.createIndex(() => st);
  let t = now(); ix.ensure(); const first = now() - t;
  const warm = [];
  for (let k = 0; k < 3; k++) { X.clearCaches(); const j = X.createIndex(() => st); t = now(); j.ensure(); warm.push(now() - t); }
  // Queries made from the library's own words, by position, never printed.
  const r = rng(1);
  const items = Array.from(st.contents.values()).filter(c => c.itemTitle);
  const word = () => { const c = items[Math.floor(r() * items.length)]; const w = X.tokens(c.itemTitle); return w[Math.floor(r() * w.length)] || 'a'; };
  const qs = [];
  for (let k = 0; k < 20; k++) qs.push(word());
  for (let k = 0; k < 10; k++) qs.push(word().slice(0, 2));
  for (let k = 0; k < 10; k++) qs.push(word() + ' ' + word());
  const qt = qs.map(q => { ix.run(q); const s = now(); ix.run(q); return now() - s; }).sort((a, b) => a - b);
  const r1 = n => Math.round(n * 10) / 10;
  console.log(JSON.stringify({ titles: st.titles.size, issues: st.issues.size, items: st.contents.size, headings: st.authorities.size, documents: ix.stats().docs, distinct_words: ix.stats().terms,
    first_build_ms: r1(first), later_builds_ms: warm.map(r1), query_median_ms: r1(qt[Math.floor(qt.length / 2)]), query_p95_ms: r1(qt[Math.ceil(qt.length * 0.95) - 1]), queries: qs.length }, null, 2));
}
