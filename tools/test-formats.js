#!/usr/bin/env node
/* Outputs read back by real third-party parsers, on a library full of awkward text:
   accents, braces, & % $ # _ ~ ^ \, quotes, "-->", "<script>", line breaks, "ER  -" inside a
   note, a corporate name with "and", speculative and N/A values.
     BibTeX → @retorquere/bibtex-parser (the parser of Zotero's Better BibTeX) and citation-js
     RIS    → citation-js (@citation-js/plugin-ris)
     WordPress blocks → @wordpress/block-serialization-default-parser (Gutenberg's own)
     HTML outputs → checked for escaping
   usage: node tools/test-formats.js <folder with node_modules holding those packages>
   (run-tests.sh installs them into a temporary folder:
    npm i @retorquere/bibtex-parser tslib @citation-js/core @citation-js/plugin-ris @citation-js/plugin-bibtex @wordpress/block-serialization-default-parser) */
'use strict';
const path = require('path'), { createRequire } = require('module'), { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const deps = process.argv[2];
if (!deps) { console.error('usage: test-formats.js <folder with node_modules>'); process.exit(2); }
const req = createRequire(path.join(path.resolve(deps), 'index.js'));
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store', 'toc', 'names', 'catalog', 'outputs'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SCx = globalThis.SC, R = SCx.records, C = SCx.catalog, O = SCx.outputs;

let fails = 0, count = 0;
const ok = (cond, what, detail) => { count++; if (!cond) { fails++; console.log('FAIL ' + what + (detail ? '\n   ' + detail : '')); } };
const eq = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), what, 'got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want));
const squash = s => String(s).replace(/\s+/g, ' ').trim();

// ── A library of awkward text ───────────────────────────────────────────
const TITLE = 'Notes & {Queries}: 100% "Open" <b>Letters</b> #1 – Über $5 ~ ^ \\ _ --> <!-- end';
const ITEMS = [
  { itemTitle: 'Élégie & {Écho}', author: 'Hélène Durand' },
  { itemTitle: 'A lone { brace and a lone } brace', author: 'J. Q. Public; Richard Roe' },
  { itemTitle: '<script>alert("x")</script> --> & <!-- wp:paragraph -->', author: 'Smith and Sons Publishing Co.' },
  { itemTitle: 'Back\\slash, tilde~, caret^, under_score, 50% off, #hash, $dollar', author: "O'Brien, Ó." },
  { itemTitle: '[Untitled]', author: 'Anon', spec: ['Item Title'] },
  { itemTitle: 'Notes with breaks', author: 'X', notes: 'line one\nER  - \nTY  - BOOK\nline three' },
  { itemTitle: '-- END', author: '', na: ['Author / Credit'] }
];
const blank = kind => { const r = { spec: [], na: [], speculative: false }; SCx.schema.entities[kind].fields.forEach(c => { r[c.key] = c.type === 'bool' ? false : ''; }); return r; };
function library() {
  const st = SCx.emptyState();
  st.library = Object.freeze({ slug: 'TEST-LIB', name: 'Test & <Library>', note: '' });
  st.titles.set('NOTESQUX-1872', R.freezeRec(Object.assign(blank('title'), { titleID: 'NOTESQUX-1872', titleCode: 'NOTESQUX', firstYear: '1872', canonicalTitle: TITLE,
    publisher: 'Public & Co. {Anytown}', city: 'Anytown', country: 'United States', language: 'English', spec: ['Publisher'], na: ['ISSN'], _src: 'T.csv', entryOrder: 1 })));
  st.issues.set('NOTESQUX-1872-K222222', R.freezeRec(Object.assign(blank('issue'), { issueID: 'NOTESQUX-1872-K222222', titleID: 'NOTESQUX-1872', shortname: 'NQ V1 N1',
    volume: '1', number: '1', months: 'May', day: '4', year: '1872', datePrinted: 'May 4, 1872 — "special" & {odd}', spec: ['Year'], overrides: [], _src: 'I.csv', entryOrder: 1 })));
  ITEMS.forEach((it, k) => st.contents.set('NOTESQUX-1872-C' + (222222 + k), R.freezeRec(Object.assign(blank('content'), {
    contentID: 'NOTESQUX-1872-C' + (222222 + k), issueID: 'NOTESQUX-1872-K222222', titleID: 'NOTESQUX-1872', sequence: String(k + 1), startPage: String(k + 1), endPage: k === 1 ? '3' : '',
    na: ['Parent Item'].concat(it.na || []), spec: it.spec || [], _src: 'C.csv', entryOrder: k + 1 }, it, { na: ['Parent Item'].concat(it.na || []) }))));
  return st;
}
const store = SCx.createStore();
store.load(library());
const vm = C.build(store, { titleIDs: ['NOTESQUX-1872'], date: new Date(2026, 9, 9) });
eq(vm.counts.contents, ITEMS.length, 'fixture: every item in the view model');

(async () => {
  // ── BibTeX ──────────────────────────────────────────────────────────
  const bib = O.bibtex(vm);
  const bpPath = path.join(path.resolve(deps), 'node_modules', '@retorquere', 'bibtex-parser', 'dist', 'esm', 'index.js');
  const bp = await import(pathToFileURL(bpPath).href);
  // Read as BibTeX defines it. (Better BibTeX can also change the case of English titles on
  // import — sentenceCase — an importer preference; the file must still read without errors.)
  const parsed = bp.parse(bib, { sentenceCase: false });
  eq(parsed.errors.map(e => e.error || e.message || String(e)), [], 'BibTeX: Better BibTeX\'s parser reports no errors');
  eq(bp.parse(bib).errors.length, 0, 'BibTeX: no errors with the parser\'s default (sentence-case) options either');
  eq(parsed.entries.length, ITEMS.length, 'BibTeX: one entry per item');
  eq(parsed.entries.map(e => e.key), ITEMS.map((_, k) => 'NOTESQUX-1872-C' + (222222 + k)), 'BibTeX: keys are the ContentIDs');
  parsed.entries.forEach((e, k) => eq(squash(e.fields.title), squash(ITEMS[k].itemTitle), 'BibTeX title decodes to the original: ' + JSON.stringify(ITEMS[k].itemTitle)));
  eq(squash(parsed.entries[0].fields.journal), squash(TITLE), 'BibTeX journal decodes to the original title');
  const corp = parsed.entries[2].fields.author || [];
  eq(corp.length, 1, 'BibTeX: "Smith and Sons Publishing Co." stays one author, not two');
  eq(parsed.entries[1].fields.author.map(a => a.lastName), ['Public', 'Roe'], 'BibTeX: two credited people are two authors');
  ok(/Speculative fields: Item Title/.test(parsed.entries[4].fields.note || ''), 'BibTeX: a speculative item title is named in the note');
  ok(!parsed.entries[6].fields.author, 'BibTeX: an N/A author is left out');
  const cite = req('@citation-js/core'); req('@citation-js/plugin-bibtex'); req('@citation-js/plugin-ris');
  const cb = new cite.Cite(bib, { forceType: '@biblatex/text' });
  eq(cb.data.length, ITEMS.length, 'BibTeX: citation-js reads every entry too');

  // ── RIS ─────────────────────────────────────────────────────────────
  const ris = O.ris(vm);
  const records = ris.split(/\n\n/).filter(r => /^TY {2}- /m.test(r));
  eq(records.length, ITEMS.length, 'RIS: one record per item');
  ok(ris.split('\n').every(l => l === '' || /^[A-Z][A-Z0-9] {2}- /.test(l) || /^ER {2}- ?$/.test(l) || /^(Compiled|Slaughter|Generated|Made)/i.test(l) || !/ {2}- /.test(l)), 'RIS: every line is a tag line (no value spills onto its own line)');
  const cr = new cite.Cite(ris, { forceType: '@ris/file' });
  eq(cr.data.length, ITEMS.length, 'RIS: citation-js reads every record (a note containing "ER  -" does not end a record)');
  cr.data.forEach((d, k) => eq(squash(d.title), squash(ITEMS[k].itemTitle), 'RIS title reads back as the original: ' + JSON.stringify(ITEMS[k].itemTitle)));
  eq(squash(cr.data[0]['container-title']), squash(TITLE), 'RIS T2 reads back as the journal title');

  // ── WordPress blocks ────────────────────────────────────────────────
  const wp = O.wordpress(vm, {});
  const wpp = req('@wordpress/block-serialization-default-parser');
  const blocks = wpp.parse(wp);
  const flat = [];
  const walk = bs => bs.forEach(b => { flat.push(b); walk(b.innerBlocks || []); });
  walk(blocks);
  ok(flat.filter(b => !b.blockName).every(b => !squash(b.innerHTML)), 'WordPress: Gutenberg\'s parser finds no stray HTML outside blocks');
  ok(flat.filter(b => b.blockName).every(b => /^core\//.test(b.blockName) && b.attrs && typeof b.attrs === 'object'), 'WordPress: every block is a core block with parsed attributes');
  const open = (wp.match(/<!-- wp:/g) || []).length, closed = (wp.match(/<!-- \/wp:/g) || []).length, self = (wp.match(/<!-- wp:[^>]*\/-->/g) || []).length;
  eq(open - self, closed, 'WordPress: every block that opens is closed');
  eq(flat.filter(b => b.blockName).length, open, 'WordPress: the parser sees every block written');
  ok(!/<script/i.test(wp) && wp.indexOf('&lt;script&gt;') !== -1, 'WordPress: <script> in the data is escaped');
  ok(!/<!-- wp:paragraph -->(?![\s\S]*?<\/p>)/.test(wp.replace(/&lt;!-- wp:paragraph --&gt;/g, '')), 'WordPress: block markup inside the data is escaped, not a block');

  // ── HTML outputs ────────────────────────────────────────────────────
  const htmls = { catalog: O.catalog(vm, {}), checklist: O.checklist(vm, { format: 'html' }), proofing: O.proofing(vm, {}), names: O.names(vm, { format: 'html' }) };
  Object.entries(htmls).forEach(([k, h]) => {
    ok(!/<script\b/i.test(h.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')), k + ': no <script> from the data');
    ok(h.indexOf('&lt;b&gt;Letters&lt;/b&gt;') !== -1, k + ': the title\'s markup is escaped');
    if (k !== 'checklist' && k !== 'names') ok(h.indexOf('&lt;script&gt;') !== -1, k + ': the item title is escaped');
    ok(!/<b>Letters<\/b>/.test(h), k + ': markup in a title is shown as text');
  });

  console.log(fails ? 'FAILED ' + fails + ' of ' + count + ' format checks' : 'PASSED ' + count + ' format checks');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(2); });
