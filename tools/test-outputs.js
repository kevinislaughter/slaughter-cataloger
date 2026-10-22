#!/usr/bin/env node
/* Unit tests for js/core/catalog.js (the view model) and js/core/outputs.js (Compiler outputs).
   usage: node tools/test-outputs.js [a 3.0 library folder to smoke-test every output on]
   A small library is built here by hand; the optional folder (e.g. the sample library)
   is compiled whole, title by title and all together. */
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store', 'toc', 'names', 'catalog', 'outputs'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const { catalog: C, outputs: O, records: R } = globalThis.SC;
const SCx = globalThis.SC;

let fails = 0, count = 0;
const eq = (got, want, what) => {
  count++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log('FAIL ' + what + '\n   got  ' + g + '\n   want ' + w); }
};
const ok = (cond, what) => eq(!!cond, true, what);
const occurrences = (s, sub) => s.split(sub).length - 1;

// ── A small library ─────────────────────────────────────────────────────
const blankIssue = () => { const r = { spec: [], na: [], overrides: [], speculative: false }; SCx.schema.entities.issue.fields.forEach(c => { r[c.key] = c.type === 'bool' ? false : ''; }); return r; };
const blankContent = () => { const r = { spec: [], na: [], speculative: false }; SCx.schema.entities.content.fields.forEach(c => { r[c.key] = ''; }); return r; };
function library() {
  const st = SCx.emptyState();
  st.library = Object.freeze({ slug: 'TEST-LIB', name: 'Test Library', note: '' });
  const title = { titleID: 'GAZETTEX-1872', titleCode: 'GAZETTEX', firstYear: '1872', canonicalTitle: 'The Gazette <of> Things', subtitle: 'A Journal',
    publisher: 'J. Q. Public', editors: 'J. Q. Public', city: 'Anytown', state: 'MA', country: 'United States', language: 'English', frequency: 'monthly',
    issn: '', mission: 'To tell the truth.', spec: ['Publisher'], na: ['ISSN'], _src: 'T.csv', entryOrder: 1 };
  st.titles.set(title.titleID, R.freezeRec(title));
  const iss = (id, o, eo) => st.issues.set(id, R.freezeRec(Object.assign(blankIssue(), { issueID: id, titleID: 'GAZETTEX-1872', _src: 'I.csv', entryOrder: eo }, o)));
  iss('GAZETTEX-1872-K222222', { shortname: 'Gazette V1 I1 N1', volume: '1', issue: '1', number: '1', months: 'May', day: '4', year: '1872', datePrinted: 'Saturday, May 4, 1872',
    pages: '4', size: '8.5 × 11', sizeUnit: 'in', price: '5 cents', evidence: 'Examined', notes: 'First issue.' }, 1);
  iss('GAZETTEX-1872-K333333', { shortname: 'Gazette V1 I2 N2', volume: '1', issue: '2', number: '2', months: 'Dec–Jan', year: '1872', yearEnd: '1873',
    spec: ['Year'], city: 'Springfield', overrides: ['city'], evidence: 'Reported', evidenceNote: 'Advertised in no. 1' }, 2);
  iss('GAZETTEX-1872-K444444', { volume: '1', issue: '4', number: '4', months: 'Spring', dateType: 'Season', year: '1873', supplement: true, supplementLabel: 'Index' }, 3);
  const con = (id, iid, seq, o) => st.contents.set(id, R.freezeRec(Object.assign(blankContent(), { contentID: id, issueID: iid, titleID: 'GAZETTEX-1872', sequence: String(seq), _src: 'C.csv', entryOrder: seq }, o)));
  con('GAZETTEX-1872-C222222', 'GAZETTEX-1872-K222222', 1, { itemTitle: 'Remarks of the Week', author: 'J. Q. Public; Richard Roe', contentType: 'editorial', startPage: '1', endPage: '2', na: ['Parent Item'] });
  con('GAZETTEX-1872-C333333', 'GAZETTEX-1872-K222222', 2, { itemTitle: 'Poems', contentType: 'section', startPage: '3', na: ['Parent Item', 'Author / Credit'] });
  con('GAZETTEX-1872-C444444', 'GAZETTEX-1872-K222222', 3, { itemTitle: '[Untitled]', author: 'Anon', contentType: 'poem', startPage: '3', parentID: 'GAZETTEX-1872-C333333', parentItem: 'Poems', spec: ['Item Title'] });
  con('GAZETTEX-1872-C555555', 'GAZETTEX-1872-K222222', 4, { itemTitle: 'Notes & {Queries} 100% #1_a', author: 'X', startPage: '4', notes: 'From the "back" page', na: ['Parent Item'] });
  con('GAZETTEX-1872-C666666', 'GAZETTEX-1872-K333333', 1, { itemTitle: 'Second issue item', startPage: '1', na: ['Parent Item'] });
  return st;
}
const store = SCx.createStore();
store.load(library());
const DATE = new Date(2026, 9, 9);
const vm = C.build(store, { titleIDs: ['GAZETTEX-1872'], date: DATE });
const tv = vm.titles[0];
const [i1, i2, i3] = tv.issues;
const text = parts => C.toText(parts);

// ── View model ──────────────────────────────────────────────────────────
eq([vm.counts.titles, vm.counts.issues, vm.counts.contents], [1, 3, 5], 'counts');
eq(tv.runYears, '1872–1873', 'run years from the issues');
eq(i1.v.publisher, 'J. Q. Public', 'issue inherits the publisher');
ok(i1.spec.has('publisher') && i1.inherited.has('publisher'), 'and its ? mark, from the title');
ok(i1.na.has('issn'), 'and N/A from the title');
eq(i2.v.city, 'Springfield', 'an overridden field keeps the issue\'s value');
ok(!i2.inherited.has('city'), 'and is not marked inherited');
eq(i1.contents.map(c => c.depth), [0, 0, 1, 0], 'nesting depth');
eq(i1.contents[2].parentTitle, 'Poems', 'parent title of a nested item');
eq(C.build(store, { titleIDs: ['GAZETTEX-1872'], nested: false }).titles[0].issues[0].contents.length, 3, 'nested:false leaves out nested items');
eq(C.build(store, { titleIDs: ['GAZETTEX-1872'], limit: 1 }).titles[0].issues.length, 1, 'limit for previews');
eq(C.build(store, { titleIDs: ['GAZETTEX-1872'], limit: 1 }).counts.issues, 3, 'counts are of the whole selection even when limited');
eq(C.build(store, { titleIDs: ['GAZETTEX-1872'], issueIDs: new Set(['GAZETTEX-1872-K333333']) }).titles[0].issues.map(i => i.id), ['GAZETTEX-1872-K333333'], 'issueIDs restricts the run');

// ── How issues are written ──────────────────────────────────────────────
const e1 = C.entry(i1, tv);
eq(text(e1.title) + '. ' + text(e1.body), 'The Gazette <of> Things. Vol. 1, no. 1 (whole no. 1). May 4, 1872. 4 pp.; 8.5 × 11 in; 5 cents.', 'typeset entry');
eq(text(e1.sub), 'Dated “Saturday, May 4, 1872”.', 'entry sub-line: date as printed');
eq(text(C.dateOf(i2)), 'December–January [1872–1873?]', 'a speculative year range is bracketed');
eq(text(C.entry(i2, tv).body), 'Vol. 1, no. 2 (whole no. 2). December–January [1872–1873?].', 'closing period after a bracketed value');
eq(text(C.dateOf(i3)), 'Spring 1873', 'a season');
eq(text(C.kindOf(i3)), 'Supplement: Index', 'a supplement');
eq(text(C.label(i3)), 'Vol. 1, no. 4 (whole no. 4)', 'label without a short name is the numbering');
eq(text(C.numbering(C.issueView(Object.assign(blankIssue(), { issueID: 'X', number: '12' }), null))), 'No. 12', 'whole number alone: "No. 12"');
eq(text(C.pagesOf(i1.contents[0])), '1–2', 'page range');
eq(C.toHTML([C.part(i2, 'year')]), '<span class="unc">[1872?]</span>', 'HTML marking of an uncertain value');
eq(C.toText([C.part(i1.contents[2], 'itemTitle')]), '[Untitled?]', 'a supplied title already in brackets');
eq(C.toText([C.part(i2, 'year')], { marks: false }), '1872', 'marks can be turned off');
eq(C.sections(tv.issues).length, 1, 'ten issues or fewer: one section');
const many = Array.from({ length: 12 }, (_, k) => C.issueView(Object.assign(blankIssue(), { issueID: 'I' + k, volume: k < 6 ? 'I' : 'II', year: String(1900 + k) }), null));
eq(C.sections(many).map(s => s.label), ['Volume I (1900–1905)', 'Volume II (1906–1911)'], 'long runs in volume sections');

// ── Filenames ───────────────────────────────────────────────────────────
eq(O.filename(vm, 'proofing'), 'SCATOUT_TEST-LIB_GAZETTEX-1872_PROOFING-CATALOG_20261009.html', 'one title: TitleID in the filename');
eq(O.filename(Object.assign({}, vm, { titles: [tv, tv] }), 'ris'), 'SCATOUT_TEST-LIB_RIS-ZOTERO_20261009.ris', 'several titles: library only');
eq(O.filename(vm, 'checklist', 'md'), 'SCATOUT_TEST-LIB_GAZETTEX-1872_CHECKLIST_20261009.md', 'checklist extension follows the format');

// ── Checklist ───────────────────────────────────────────────────────────
const lines = style => O.checklist(vm, { style, format: 'txt' }).split('\n');
eq(lines('plain').slice(0, 6), ['The Gazette <of> Things (1872–1873)', '===================================', '',
  '☐ Vol. 1, no. 1 (whole no. 1) — May 4, 1872', '☐ Vol. 1, no. 2 (whole no. 2) — December–January [1872–1873?]', '☐ Vol. 1, no. 4 (whole no. 4) — Spring 1873'], 'plain checklist');
eq(lines('bibliographic')[3], '☐ Vol. 1, no. 1 (whole no. 1). May 4, 1872.', 'bibliographic checklist line (2.7 left these lines empty)');
eq(lines('technical')[3], '☐ GAZETTEX-1872-K222222 — Vol. 1, no. 1 (whole no. 1) — May 4, 1872', 'technical checklist line');
const full = O.checklist(vm, { style: 'bibliographic', format: 'txt', pages: true, price: true, publisher: true, designation: true, evidence: true, issueID: true, notes: true, subtitle: true }).split('\n');
eq(full[3], '☐ Vol. 1, no. 1 (whole no. 1). May 4, 1872. 4 pp. 5 cents. Anytown, MA, United States: [J. Q. Public?]. — “A Journal” {GAZETTEX-1872-K222222}', 'bibliographic line with every option');
eq(full[4], '   First issue.', 'notes under the line');
eq(full[5], '☐ Vol. 1, no. 2 (whole no. 2). December–January [1872–1873?]. Springfield, MA, United States: [J. Q. Public?]. Reported: Advertised in no. 1. — “A Journal” {GAZETTEX-1872-K333333}', 'reported issue with its evidence note');
const md = O.checklist(vm, { format: 'md', style: 'plain' });
ok(md.indexOf('- [ ] Vol. 1, no. 1 (whole no. 1) — May 4, 1872') !== -1 && md.indexOf('*The Slaughter Cataloger was used') !== -1, 'Markdown checklist with attribution');
const chtml = O.checklist(vm, { format: 'html' });
ok(/^<!DOCTYPE html>/.test(chtml) && occurrences(chtml, '<li>') === 3 && chtml.indexOf('The Gazette &lt;of&gt; Things') !== -1, 'HTML checklist: a document, one item per issue, escaped');
ok(chtml.indexOf('<span class="unc">[1872–1873?]</span>') !== -1, 'HTML checklist marks uncertain values');

// ── Catalog ─────────────────────────────────────────────────────────────
const cat = O.catalog(vm, {});
ok(/^<!DOCTYPE html>[\s\S]*<\/html>\n$/.test(cat), 'catalog is a standalone document');
ok(cat.indexOf('<script') === -1 && cat.indexOf('&lt;of&gt;') !== -1, 'catalog escapes values');
eq(occurrences(cat, '<div class="issue" id='), 3, 'one block per issue');
ok(cat.indexOf('└') !== -1 && cat.indexOf('<span class="unc">[Untitled?]</span>') !== -1, 'nested and uncertain items shown');
ok(cat.indexOf('Notes &amp; {Queries} 100% #1_a') !== -1, 'special characters in a title');
ok(cat.indexOf('Springfield, MA, United States: <span class="unc">[J. Q. Public?]</span>') !== -1, 'an issue that differs from the title shows its imprint');
eq(occurrences(cat, 'class="issue-production"'), 1, 'imprint line only on the issue that differs from the title');
ok(cat.indexOf('Edited by') === -1, 'inherited editors are not repeated on every issue');
eq(occurrences(O.catalog(vm, { types: false }), 'class="ct-type"'), 0, 'content types can be left out');
const cat2 = O.catalog(Object.assign({}, vm, { titles: [tv, Object.assign({}, tv, { id: 'OTHERXXX-1900', name: 'Other' })] }), {});
ok(cat2.indexOf('<nav class="toc">') !== -1 && occurrences(cat2, '<section class="title-block"') === 2, 'several titles: a list of titles, then each title');

// ── WordPress ───────────────────────────────────────────────────────────
const wp = O.wordpress(vm, {});
const opens = (wp.match(/<!-- wp:[a-z]+[^>]*?(?<!\/)-->/g) || []).length, closes = (wp.match(/<!-- \/wp:[a-z]+ -->/g) || []).length;
eq(opens, closes, 'every WordPress block is closed');
eq(occurrences(wp, '<!-- wp:heading {"level":2,"anchor":"GAZETTEX-1872-K'), 3, 'issues are h2 on a one-title page without sections');
ok(wp.indexOf('&lt;of&gt;') === -1 || wp.indexOf('<of>') === -1, 'WordPress output escapes values');
ok(wp.indexOf('<strong>TitleID:</strong> <code>GAZETTEX-1872</code>') !== -1, 'title facts');
const wp2 = O.wordpress(Object.assign({}, vm, { titles: [tv, Object.assign({}, tv, { id: 'OTHERXXX-1900', name: 'Other' })] }), {});
eq(occurrences(wp2, '{"level":2,"anchor":"'), 2 + 0, 'several titles: each title an h2');

// ── Proofing ────────────────────────────────────────────────────────────
const proof = O.proofing(vm, { files: { 'GAZETTEX-1872': { issues: 'I.csv', contents: 'C.csv' } } });
eq(occurrences(proof, '<section class="proof-issue">'), 3, 'a page per issue');
eq(occurrences(proof, '<section class="proof-explainer">') + occurrences(proof, '<section class="proof-title-page">'), 2, 'explainer and title sheet');
ok(/\.proof-issue\{break-before:page/.test(proof), 'every issue starts a new printed page');
eq(occurrences(proof, '<div class="signoff"><table>'), 3, 'a sign-off block per issue');
const missingIssue = SCx.schema.entities.issue.fields.filter(c => O.PROOF_ISSUE.indexOf(c.header) === -1).map(c => c.header);
eq(missingIssue, [], 'the proofing sheet lists every issue field');
const missingTitle = SCx.schema.entities.title.fields.filter(c => c.type !== 'id' && ['titleCode'].indexOf(c.key) === -1 && O.PROOF_TITLE.indexOf(c.header) === -1).map(c => c.header);
eq(missingTitle, [], 'the proofing sheet lists every title field');
ok(proof.indexOf('from title</span>') !== -1 && proof.indexOf('[N/A]') !== -1 && proof.indexOf('[blank]') !== -1, 'inherited, N/A and blank fields are labelled');
ok(proof.indexOf('<code>I.csv</code>') !== -1, 'file names in the summary');

// ── RIS ─────────────────────────────────────────────────────────────────
const r = O.ris(vm);
eq(occurrences(r, 'TY  - JOUR'), 5, 'one RIS record per contents item');
eq(occurrences(r, '\nER  - '), 5, 'every record ends');
ok(r.indexOf('AU  - J. Q. Public\nAU  - Richard Roe') !== -1, 'authors split on semicolons');
ok(r.indexOf('DA  - Saturday, May 4, 1872') !== -1 && r.indexOf('DA  - December–January 1872–1873') !== -1, 'dates: as printed, else composed without marks');
ok(r.indexOf('N1  - Slaughter Cataloger ContentID: GAZETTEX-1872-C444444') !== -1 && r.indexOf('N1  - Part of: Poems') !== -1, 'ContentID and parent noted');
ok(r.indexOf('N1  - Speculative fields: Item Title') !== -1 && r.indexOf('Speculative fields: Year (issue)') !== -1, 'speculative fields noted, item and issue');
ok(!/AU {2}- *\n/.test(r) && r.indexOf('T2  - The Gazette <of> Things') !== -1, 'no empty tags; journal is the canonical title');

// ── BibTeX ──────────────────────────────────────────────────────────────
const b = O.bibtex(vm);
eq(occurrences(b, '@article{'), 5, 'one BibTeX entry per contents item');
ok(b.indexOf('@article{GAZETTEX-1872-C222222,') !== -1, 'ContentID is the citation key');
ok(b.indexOf('author = {J. Q. Public and Richard Roe}') !== -1, 'authors joined with "and"');
ok(b.indexOf('title = {{Notes \\& \\{Queries\\} 100\\% \\#1\\_a}}') !== -1, 'special characters escaped, capitals kept');
ok(b.indexOf('month = may') !== -1 && b.indexOf('pages = {1--2}') !== -1, 'month macro and page range');
b.split('@article{').slice(1).forEach((e, k) => { const body = e.replace(/\\[{}]/g, ''); eq(occurrences(body, '{') + 1, occurrences(body, '}'), 'braces balance in entry ' + (k + 1)); });

// ── Name index, and headings in RIS / BibTeX ───────────────────────────
const nx0 = O.names(vm, { format: 'txt' }).split('\n');
eq(nx0.indexOf('Public, J. Q.') !== -1 && nx0.indexOf('Roe, Richard') !== -1, true, 'names without a heading file surname first');
eq(nx0[nx0.indexOf('Public, J. Q.') + 1], '    Vol. 1, no. 1 (whole no. 1), May 4, 1872, pp. 1–2: “Remarks of the Week”', 'a credit: numbering, date, pages, title');
eq(O.names(vm, { format: 'txt', unheaded: 'asis' }).split('\n').indexOf('J. Q. Public') !== -1, true, 'or as credited');
store.put('authority', { authorityID: 'AU-222222', name: 'Public, John Q.', nameType: 'Person', variants: 'J. Q. Public | J.Q.P.', dates: '1840–1910', seeAlso: '', roles: '', honorifics: '',
  sources: '', notes: '', status: 'Confirmed', spec: [], na: [], _src: 'SCAT_TEST-LIB_AUTHORITIES.csv', entryOrder: 1 });
const vmH = C.build(store, { titleIDs: ['GAZETTEX-1872'], date: DATE });
const nx = O.names(vmH, { format: 'txt' }).split('\n');
eq(nx.indexOf('Public, John Q., 1840–1910 (as J. Q. Public)') !== -1, true, 'a heading, its dates and the forms it was credited under');
eq(O.names(vmH, { format: 'md' }).indexOf('**Public, John Q.**, 1840–1910') !== -1, true, 'Markdown index');
const nxh = O.names(vmH, { format: 'html' });
eq(/^<!DOCTYPE html>/.test(nxh) && nxh.indexOf('<h2>P</h2>') !== -1 && nxh.indexOf('<b>Public, John Q.</b>') !== -1, true, 'web-page index with letter headings');
eq(O.filename(vmH, 'names', 'html'), 'SCATOUT_TEST-LIB_GAZETTEX-1872_NAME-INDEX_20261009.html', 'name index filename');
const store2 = SCx.createStore(); store2.load(library());
store2.put('content', Object.assign({}, store2.state.contents.get('GAZETTEX-1872-C555555'), { author: 'J.Q.P.' }));
store2.put('authority', Object.assign({}, store.state.authorities.get('AU-222222'), { _src: 'A.csv' }));
const seeTxt = O.names(C.build(store2, { titleIDs: ['GAZETTEX-1872'], date: DATE }), { format: 'txt' });
eq(seeTxt.indexOf('J.Q.P. see Public, John Q.') !== -1, true, 'see-reference from a form that files elsewhere');
eq(seeTxt.indexOf('Public, J. Q. see') === -1, true, 'no see-reference where the form files next to its heading');
const risH = O.ris(vmH);
eq(risH.indexOf('AU  - Public, John Q.\nAU  - Richard Roe') !== -1 && risH.indexOf('N1  - Credited as: J. Q. Public; Richard Roe') !== -1, true, 'RIS: authors as headings, the credit as printed in a note');
eq(O.ris(vmH, { headings: false }).indexOf('AU  - J. Q. Public') !== -1, true, 'RIS: headings can be turned off');
eq(O.bibtex(vmH).indexOf('author = {Public, John Q. and Richard Roe}') !== -1, true, 'BibTeX: authors as headings');

// ── Real library ────────────────────────────────────────────────────────
const dir = process.argv[2];
if (dir) {
  const files = fs.readdirSync(dir).filter(n => /\.csv$/i.test(n)).map(n => R.readFile(n, fs.readFileSync(path.join(dir, n), 'utf8'), { lastModified: 1000 }));
  const built = R.buildLibrary(files, {});
  const s2 = SCx.createStore();
  s2.load(built.state);
  const tids = Array.from(built.state.titles.keys());
  const bad = /undefined|NaN|\[object |null\b/;
  const check = (vmx, label) => {
    const t0 = Date.now();
    const outs = {
      checklist: O.checklist(vmx, { format: 'txt' }), checklistHTML: O.checklist(vmx, { format: 'html' }), catalog: O.catalog(vmx, {}),
      wordpress: O.wordpress(vmx, {}), proofing: O.proofing(vmx, {}), ris: O.ris(vmx), bibtex: O.bibtex(vmx),
      names: O.names(vmx, { format: 'html' }), namesText: O.names(vmx, { format: 'txt' })
    };
    Object.keys(outs).forEach(k => { const m = bad.exec(outs[k]); if (m) eq(outs[k].slice(Math.max(0, m.index - 80), m.index + 40), '(no ' + m[0] + ')', label + ' ' + k + ' has no stray "' + m[0] + '"'); });
    eq(occurrences(outs.ris, 'TY  - '), vmx.counts.contents, label + ': RIS has every item');
    eq(occurrences(outs.bibtex, '@article{'), vmx.counts.contents, label + ': BibTeX has every item');
    eq(occurrences(outs.proofing, '<section class="proof-issue">'), vmx.counts.issues, label + ': proofing has every issue');
    return Date.now() - t0;
  };
  tids.forEach(t => check(C.build(s2, { titleIDs: [t], nested: true }), t));
  const all = C.build(s2, { titleIDs: tids, nested: true });
  const ms = check(all, 'whole library');
  console.log('compiled ' + all.counts.titles + ' titles, ' + all.counts.issues + ' issues, ' + all.counts.contents + ' items, every output, in ' + ms + ' ms');
}

console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' output checks' : 'PASSED ' + count + ' output checks');
process.exit(fails ? 1 : 0);
