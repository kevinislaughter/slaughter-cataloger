#!/usr/bin/env node
/* Headless walkthrough of the built app with an in-memory library folder.
   usage: node tools/test-walkthrough.js <app.html> <3.0 library folder> <a Beta 2 Titles CSV> [screenshot-dir]
   The folder is the sample library in 3.0 form (sample-data/3.0/example-library).
   Counts are worked out from the files themselves; the numbering checks rely on the
   last issues of The Example Gazette (vol. 10, no. 8, December 1881; vol. 11, no. 1,
   whole no. 307, April 1882) and the forms of John Q. Public among its credits.
   Fails on any page error or failed expectation. */
'use strict';
const path = require('path'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }

const ROOT = path.join(__dirname, '..');
const app = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'slaughter-cataloger-3.html'));
const dataDir = process.argv[3];
const oldFile = process.argv[4];
const shots = process.argv[5] || '';
if (!dataDir || !oldFile) { console.error('usage: test-walkthrough.js <app.html> <3.0 folder> <beta2-file.csv> [shots]'); process.exit(2); }
const seed = {};
fs.readdirSync(dataDir).filter(n => /\.csv$/i.test(n)).forEach(n => { seed[n] = fs.readFileSync(path.join(dataDir, n), 'utf8'); });
const OLD_NAME = 'SCAT_EXAMPLE-LIBRARY_TITLES_v2-0_old.csv';     // a leftover Beta 2 file in the folder
seed[OLD_NAME] = fs.readFileSync(oldFile, 'utf8');
const GAZ = 'EXAGAZEX-1872';                                       // The Example Gazette: the long run
const SLUG = 'EXAMPLE-LIBRARY';
const TITLES_FILE = 'SCAT_' + SLUG + '_TITLES.csv';
const LIB_ISSUES = 'SCAT_' + SLUG + '_' + GAZ + '_ISSUES.csv';
const LIB_CONTENTS = 'SCAT_' + SLUG + '_' + GAZ + '_CONTENTS.csv';
const pick = Object.keys(seed);
// The invented issue package (the twin, sample-data/issue-package/native) sits in the folder under
// _issues/<TitleID>/<IssueID>/, where an installed package will go. The app must never open it, and
// search must never find its text: it holds canary strings for that.
const readTree = dir => { const t = { files: {}, dirs: {} }; fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
  if (e.isDirectory()) t.dirs[e.name] = readTree(path.join(dir, e.name)); else t.files[e.name] = { text: fs.readFileSync(path.join(dir, e.name), 'latin1'), lastModified: 1000 }; }); return t; };
const SEED_DIRS = { _issues: { files: {}, dirs: { 'EXAGAZEX-1872': { files: {}, dirs: { 'EXAGAZEX-1872-KRNYWA2': readTree(path.join(ROOT, 'sample-data', 'issue-package', 'native')) } } } } };
const CANARIES = ['canary-item-text-01', 'canary-page-text-02', 'canary-contact-03', 'canary-mention-04', 'canary-cover-05', 'canary-source-06'];

// What the app should find, read here with the app's own core modules.
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store', 'toc', 'names', 'catalog'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const built = SC.records.buildLibrary(pick.filter(n => n !== OLD_NAME).map(n => SC.records.readFile(n, seed[n], { lastModified: 1000 })), {});
const st = built.state;
const fmt = n => n.toLocaleString('en-US');
const libIssues = Array.from(st.issues.values()).filter(i => i.titleID === GAZ);
const runLength = libIssues.length, volumes = new Set(libIssues.map(i => i.volume)).size, vol3 = libIssues.filter(i => i.volume === '3').length;
const inheritPublisher = libIssues.filter(i => (i.overrides || []).indexOf('publisher') === -1).length;
const libAuthors = new Map();
Array.from(st.contents.values()).forEach(c => { if (SC.records.titleOfContent(st, c) === GAZ && c.author) libAuthors.set(c.author, (libAuthors.get(c.author) || 0) + 1); });
const topAuthor = Array.from(libAuthors.entries()).filter(e => e[0].length >= 6).sort((a, b) => b[1] - a[1])[0][0];

// In-memory folder that survives page reloads. It is kept in localStorage, where a file
// whose text is the same as the seed file of that name is stored as a reference only.
function fakeFS(seedArg) {
  if (window.top !== window) return;               // not inside the Compiler's sandboxed preview frame
  const seedFiles = seedArg.files, seedDirs = seedArg.dirs || {}, keep = !seedArg.memoryOnly;
  const KEY = '__sc_test_fs__';
  const pack = node => ({ files: Object.fromEntries(Object.entries(node.files).map(([n, f]) => [n, f.text === seedFiles[n] ? { ref: n, lastModified: f.lastModified } : f])),
    dirs: Object.fromEntries(Object.entries(node.dirs).map(([n, d]) => [n, pack(d)])) });
  const unpack = node => ({ files: Object.fromEntries(Object.entries(node.files).map(([n, f]) => [n, f.ref ? { text: seedFiles[f.ref], lastModified: f.lastModified } : f])),
    dirs: Object.fromEntries(Object.entries(node.dirs).map(([n, d]) => [n, unpack(d)])) });
  const saved = keep ? JSON.parse(localStorage.getItem(KEY) || 'null') : null;
  let tree = saved ? unpack(saved) : null;
  if (!tree) { tree = { files: {}, dirs: JSON.parse(JSON.stringify(seedDirs)) }; Object.keys(seedFiles).forEach(n => { tree.files[n] = { text: seedFiles[n], lastModified: 1000 }; }); }
  const persist = () => { if (keep) localStorage.setItem(KEY, JSON.stringify(pack(tree))); };
  persist();
  // Every call the app makes on the folder, with its path: the search tests check that a search
  // session makes none, and that nothing under _issues/ is ever opened.
  const log = window.__SC_TEST_FS_LOG__ = [];
  const note = (op, p) => log.push(op + ' ' + p);
  const notFound = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
  function fileHandle(node, name, p) {
    return { kind: 'file', name,
      getFile: async () => { note('read', p); return { name, lastModified: node.files[name].lastModified, text: async () => node.files[name].text }; },
      createWritable: async () => { note('write', p); let buf = ''; return { write: async t => { buf += t; }, close: async () => { node.files[name] = { text: buf, lastModified: Date.now() }; persist(); } }; } };
  }
  function dirHandle(node, name, p) {
    return { kind: 'directory', name,
      queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      values: async function* () { note('list', p || '/'); for (const n of Object.keys(node.files)) yield fileHandle(node, n, p + n); for (const d of Object.keys(node.dirs)) yield dirHandle(node.dirs[d], d, p + d + '/'); },
      getFileHandle: async (n, o) => { note('open', p + n); if (!node.files[n]) { if (!(o && o.create)) throw notFound(); node.files[n] = { text: '', lastModified: Date.now() }; persist(); } return fileHandle(node, n, p + n); },
      getDirectoryHandle: async (n, o) => { note('open-dir', p + n + '/'); if (!node.dirs[n]) { if (!(o && o.create)) throw notFound(); node.dirs[n] = { files: {}, dirs: {} }; persist(); } return dirHandle(node.dirs[n], n, p + n + '/'); } };
  }
  window.__SC_TEST_FS__ = { root: dirHandle(tree, 'Example Library', ''), tree: () => tree };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], log = [];
  globalThis.__log = log; globalThis.__errors = errors; globalThis.__page = page;
  let failures = 0;
  const timings = {};
  // Search performance (Phase 2 closeout, 2026-10-15): a time over PERF_LIMIT_MS fails the walkthrough, as a
  // severe regression. The Phase 2 targets (TARGET) are measured and reported as met or NOT MET, never failed.
  const PERF_LIMIT_MS = 2000, TARGET = { firstBuild: 300, render: 100, typing: 250 };
  const metOr = (ms, target) => (ms <= target ? 'met' : 'NOT MET');
  const perfLines = [];
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.addInitScript(fakeFS, { files: seed, dirs: SEED_DIRS });
  const step = s => log.push('· ' + s);
  const expect = (ok, what) => { log.push((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; };
  const shot = async (n, full) => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png'), fullPage: !!full }); };
  const text = sel => page.locator(sel).first().innerText();
  const go = hash => page.evaluate(h => { location.hash = h; }, hash);
  // Click Save and wait for this save's own message (an earlier one may still be showing).
  const save = async () => {
    await page.evaluate(() => { window.__msgBefore = SC.session.ui.message; });
    await page.click('.topbar button:has-text("Save")');
    await page.waitForFunction(() => SC.session.ui.message && SC.session.ui.message !== window.__msgBefore && !SC.session.ui.busy);
    await page.waitForSelector('.message.ok');
    return page.evaluate(() => window.__SC_TEST_FS__.tree());
  };
  const rowsOf = (csvText) => page.evaluate(t => { const rows = SC.csv.parse(t).rows; const h = rows[0]; return rows.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }, csvText);
  const clickAway = () => page.locator('body').click({ position: { x: 5, y: 895 } });
  const paste = (sel, t) => page.evaluate(([s, v]) => { const el = document.querySelector(s); el.focus(); const dt = new DataTransfer(); dt.setData('text/plain', v); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, [sel, t]);
  const itemsHere = () => page.evaluate(() => SC.session.store.contentsOfIssue(SC.ui.parseRoute().issueID).map(c => ({ id: c.contentID, seq: c.sequence, title: c.itemTitle, author: c.author, type: c.contentType, start: c.startPage, end: c.endPage, parent: c.parentID })));

  await page.goto('file://' + app);
  await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('slaughter-cataloger-3'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await page.reload();

  step('Welcome screen');
  // Wait for the page to draw before counting (counting straight after reload could find nothing yet).
  await page.waitForSelector('text=Open library folder', { timeout: 10000 }).catch(() => {});
  expect(await page.locator('text=Open library folder').count() === 1, 'offers Open library folder');
  await shot('01-welcome');

  step('Open the folder');
  const t0 = Date.now();
  await page.click('text=Open library folder');
  await page.waitForSelector('table.shelf tbody tr');
  const summary = await text('.summary');
  step('opened in ' + (Date.now() - t0) + ' ms: ' + summary.replace(/\s+/g, ' '));
  const want = [fmt(st.titles.size) + ' titles', fmt(st.issues.size) + ' issues', fmt(st.contents.size) + ' contents items'];
  expect(want.every(w => summary.indexOf(w) !== -1), 'dashboard counts ' + want.join(', '));
  expect((await page.locator('table.shelf tbody tr').count()) === st.titles.size, st.titles.size + ' rows in the shelf list');
  expect(/All changes saved/.test(await text('.save-state')), 'nothing marked changed after opening');
  expect(/Beta 2 format/.test(await text('main')), 'leftover Beta 2 file reported as not loaded');
  const startup = await page.evaluate(() => ({ stats: SC.searchUI.stats(), issues: window.__SC_TEST_FS_LOG__.filter(e => / _issues\//.test(e)) }));
  expect(!startup.stats.built && startup.stats.builds === 0, 'start-up builds no search index (it is built on first use)');
  expect(startup.issues.length === 0, 'opening the library opens nothing under _issues/, where the invented issue package lies (' + startup.issues.join(', ') + ')');
  await shot('02-dashboard');

  step('Open the Gazette and edit it');
  await page.click('table.shelf tbody tr:has(code:text-is("' + GAZ + '"))');
  await page.waitForSelector('.entry-main');
  expect(/^The Example Gazette\b/.test(await text('.entry-main')), 'catalog entry shows The Example Gazette');
  await page.fill('#f-knownIssues', String(runLength));
  await page.locator('#f-knownIssues').press('Enter');
  await page.locator('.field:has(#f-subtitle) .tog').first().click();
  const dirty1 = await text('.save-state');
  expect(/1 file changed/.test(dirty1), 'a title edit that issues do not inherit changes only the Titles file (' + dirty1 + ')');
  expect(/\[The Example Gazette\?\]/.test(await text('.entry-main')) === false, 'title itself not marked uncertain');
  await shot('03-title-editor');

  step('Undo and redo');
  await clickAway();
  await page.click('button:has-text("Undo")');
  expect((await page.locator('.field:has(#f-subtitle) .tog.on').count()) === 0, 'undo removes the ? mark');
  await page.click('button:has-text("Redo")');
  expect((await page.locator('.field:has(#f-subtitle) .tog.on').count()) === 1, 'redo restores it');

  step('Save');
  const tree = await save();
  step((await text('.message')).replace(/\s+/g, ' ').slice(0, 200));
  expect(/All changes saved/.test(await text('.save-state')), 'saved state shown');
  const titles = tree.files[TITLES_FILE].text;
  const lib = (await rowsOf(titles)).find(r => r.TitleID === GAZ);
  expect(lib && lib['Total Known Issues'] === String(runLength), 'the Gazette row has ' + runLength + ' known issues');
  expect(lib && /Subtitle/.test(lib['Speculative Fields'] || '') && lib.Speculative === 'Yes', 'the Gazette row lists Subtitle as speculative');
  expect(tree.files[LIB_ISSUES].text === seed[LIB_ISSUES], 'the Gazette issues file untouched');
  expect(tree.files[OLD_NAME].text === seed[OLD_NAME], 'Beta 2 file untouched');
  const backups = tree.dirs._backups ? Object.values(tree.dirs._backups.dirs)[0] : null;
  expect(!!backups && !!backups.files[TITLES_FILE], 'original Titles file backed up');
  expect(backups && backups.files[TITLES_FILE].text === seed[TITLES_FILE], 'backup is byte-identical to the original');
  expect(Object.keys(tree.files).length === pick.length, 'no extra files written to the folder');

  step('Inheritance: change the publisher on the title');
  await page.fill('#f-publisher', 'Public & Sons');
  await page.locator('#f-publisher').press('Enter');
  expect(/2 files changed/.test(await text('.save-state')), 'publisher change also marks the issues file (' + await text('.save-state') + ')');
  const tree1 = await save();
  const pubs = (await rowsOf(tree1.files[LIB_ISSUES].text)).map(r => r.Publisher);
  expect(pubs.filter(p => p === 'Public & Sons').length === inheritPublisher, 'the ' + inheritPublisher + ' Gazette issues that inherit the publisher now carry the new one');
  await page.click('button:has-text("Undo")');
  const tree1b = await save();
  expect(tree1b.files[LIB_ISSUES].text === seed[LIB_ISSUES], 'undo and save restore the issues file exactly');

  // ── Stage 2 ──
  step('Issues: overview and the run');
  await go('#/issues/' + GAZ);
  await page.waitForSelector('table.list tbody tr');
  expect((await page.locator('table.list tbody tr.row-link').count()) === libIssues.length, 'overview lists ' + libIssues.length + ' Gazette issues');
  expect(new RegExp(runLength + ' issues of ' + runLength + ' known').test(await text('.summary')), 'summary counts against Total Known Issues');
  await shot('04-issues-overview');
  await page.click('table.list tbody tr.row-link >> nth=0');
  await page.waitForSelector('.issue-form');
  expect((await page.locator('.run-item').count()) === libIssues.length, 'run list beside the issue shows every issue');
  expect(/Example Gazette …/.test(await text('.run-title')) && (await text('.run-item.on .ri-name')) === 'V1 I1 N1', 'run list drops the shared "Example Gazette" and shows V1 I1 N1');
  expect(/Vol\. 1, no\. 1 \(whole no\. 1\)\. May 4, 1872\. 4 pp\.; 11 × 16 in; 5 cents\.$/.test((await text('.entry-main')).trim()), 'entry typeset: ' + (await text('.entry-main')).trim());

  step('Edit an existing issue, override and restore an inherited field');
  await page.fill('#f-issueDesignation', 'Specimen number');
  await page.locator('#f-issueDesignation').press('Enter');
  expect(/1 file changed/.test(await text('.save-state')), 'editing an issue changes the issues file only');
  await page.evaluate(() => { document.querySelector('details.group').open = true; });
  const cityPh = await page.getAttribute('#f-city', 'placeholder');
  await page.fill('#f-city', 'Riverton');
  await page.locator('#f-city').press('Enter');
  const ov = await page.evaluate(() => SC.session.store.state.issues.get(SC.ui.parseRoute().issueID).overrides);
  expect(ov.indexOf('city') !== -1, 'typing in an inherited field overrides it for this issue');
  expect(/Set for this issue\. Title: /.test(await text('.field:has(#f-city) .inh-note')), 'the field shows the title\'s value beside the override (' + (await text('.field:has(#f-city) .inh-note')).replace(/\s+/g, ' ') + ')');
  await shot('05-issue-override');
  await page.click('.field:has(#f-city) .inh-note button');
  const ov2 = await page.evaluate(() => SC.session.store.state.issues.get(SC.ui.parseRoute().issueID));
  expect(ov2.overrides.indexOf('city') === -1 && ov2.city === '' && (await page.inputValue('#f-city')) === '' && (await page.getAttribute('#f-city', 'placeholder')) === cityPh, '"use title\'s" inherits the title\'s city again');
  await clickAway();
  for (let k = 0; k < 3; k++) await page.click('button:has-text("Undo")');
  expect(/All changes saved/.test(await text('.save-state')), 'undo takes the issue back to what was saved, and nothing shows as changed');
  await page.click('button:has-text("Redo")');
  expect(/1 file changed/.test(await text('.save-state')), 'redo marks it changed again');
  await page.click('button:has-text("Undo")');

  step('Record new issues');
  const lastID = libIssues.sort((a, b) => a.entryOrder - b.entryOrder)[libIssues.length - 1].issueID;
  await go('#/issues/' + GAZ + '/' + lastID);
  await page.waitForSelector('.issue-form');
  await page.click('.sticky-actions button:has-text("New issue after this")');
  await page.waitForSelector('.draft-card');
  const vals = async () => ({ v: await page.inputValue('#f-volume'), i: await page.inputValue('#f-issue'), n: await page.inputValue('#f-number'), m: await page.inputValue('#f-months'), y: await page.inputValue('#f-year'), s: await page.inputValue('#f-shortname') });
  let d = await vals();
  expect(d.v === '11' && d.i === '2' && d.n === '308', 'numbers move on: vol. 11, no. 2, whole no. 308 (' + [d.v, d.i, d.n].join(' / ') + ')');
  expect(d.m === 'Aug' && d.y === '1882', 'date moves on by the last step, four months: Aug 1882 (' + d.m + ' ' + d.y + ')');
  expect(d.s === 'Example Gazette V11 I2 N308', 'short name follows the pattern: ' + d.s);
  expect(/fields? not yet addressed/.test(await text('.draft-card .entry-facts')), 'draft shows the count of fields not yet addressed');
  await shot('06-issue-draft');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
  expect(new RegExp((runLength + 1) + ' issues').test(await text('.run-count')), 'Ctrl+Enter records it: ' + (runLength + 1) + ' issues in the run');
  d = await vals();
  expect(d.i === '3' && d.n === '309' && d.m === 'Dec' && d.s === 'Example Gazette V11 I3 N309', 'the next draft is ready: no. 3, whole no. 309, Dec (' + [d.i, d.n, d.m, d.s].join(' / ') + ')');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id === 'f-volume'), 'typing starts in the first field of the new draft');
  await page.click('.advance-bar button:has-text("Start next volume")');
  d = await vals();
  expect(d.v === '12' && d.i === '1' && d.s === 'Example Gazette V12 I1 N309', 'Start next volume: vol. 12, no. 1 (' + d.s + ')');
  await page.fill('#f-shortname', 'Example Gazette, last issue');
  await page.locator('#f-shortname').press('Enter');
  await page.fill('#f-pages', '8');
  await page.locator('#f-pages').press('Tab');
  expect((await page.inputValue('#f-shortname')) === 'Example Gazette, last issue', 'a short name you type stays yours');
  await page.click('.sticky-actions button:has-text("Record issue")');
  await page.waitForFunction(() => /Recorded Example Gazette, last issue/.test((document.querySelector('.message') || {}).textContent || ''));
  const tree2 = await save();
  const issRows = await rowsOf(tree2.files[LIB_ISSUES].text);
  const added = issRows.slice(-2);
  const lastSeed = (await rowsOf(seed[LIB_ISSUES])).slice(-1)[0];
  expect(issRows.length === libIssues.length + 2, 'issues file now has ' + (libIssues.length + 2) + ' rows');
  expect(added.every(r => new RegExp('^' + GAZ + '-K[2-9A-HJKMNP-WYZ]{6}$').test(r.IssueID)), 'new IssueIDs follow the pattern: ' + added.map(r => r.IssueID).join(', '));
  expect(added[0]['Short Name'] === 'Example Gazette V11 I2 N308' && added[1]['Short Name'] === 'Example Gazette, last issue' && added[1].Volume === '12' && added[1].Pages === '8', 'recorded values saved');
  expect(added.every(r => r['Overridden Fields'] === lastSeed['Overridden Fields'] && r.City === lastSeed.City), 'title-level fields the previous issue set are carried over (' + lastSeed['Overridden Fields'] + ')');
  expect(added[0]['Entry Order'] === String(Number(lastSeed['Entry Order']) + 1), 'new issues are entered after the last one');
  await clickAway();
  await page.click('button:has-text("Undo")');
  await page.click('button:has-text("Undo")');
  const tree3 = await save();
  expect(tree3.files[LIB_ISSUES].text === seed[LIB_ISSUES], 'undoing both and saving restores the issues file exactly');

  // ── Stage 3 ──
  step('Contents: the grid');
  const second = libIssues[1].issueID;
  await go('#/contents/' + GAZ + '/' + second);
  await page.waitForSelector('table.grid-toc');
  const before = await itemsHere();
  expect((await page.locator('table.grid-toc tbody tr').count()) === before.length + 1, before.length + ' items and an empty row to add the next');
  expect(before.every((c, k) => c.seq === String(k + 1)), 'items in Sequence order');
  await shot('07-contents-grid');

  step('Type a new item, with author completion');
  await page.click('tr.draft-row:last-child td.c-itemTitle .cell');
  await page.keyboard.type('A Typed Item');
  await page.keyboard.press('Tab');
  await page.keyboard.type(topAuthor.slice(0, 4));
  const comp = await page.evaluate(() => { const el = document.activeElement; return { v: el.value, a: el.selectionStart, b: el.selectionEnd }; });
  expect(comp.v === topAuthor && comp.a === 4 && comp.b === topAuthor.length, 'typing "' + topAuthor.slice(0, 4) + '" completes the most used author, "' + topAuthor + '", selected');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  let items = await itemsHere();
  const typed = items[items.length - 1];
  expect(items.length === before.length + 1 && typed.title === 'A Typed Item' && typed.author === topAuthor && typed.seq === String(items.length), 'item added at the end with title, author and sequence ' + typed.seq);
  expect(await page.evaluate(() => !!document.activeElement.closest('tr.draft-row') && /:author$/.test(document.activeElement.getAttribute('data-cell'))), 'Enter moves down to the new empty row, same column');

  step('Paste a table of contents');
  await paste('tr.draft-row:last-child td.c-itemTitle .cell', 'A Section ........ 5\nA Poem, p. 5\nAnother Poem  6-7');
  await page.waitForTimeout(120);
  await clickAway();
  items = await itemsHere();
  const pasted = items.slice(-3);
  expect(pasted.map(c => c.title + '|' + c.start + '|' + c.end).join(' ; ') === 'A Section|5| ; A Poem|5| ; Another Poem|6|7', 'three pasted lines became three items with pages: ' + pasted.map(c => c.title + ' ' + c.start + (c.end ? '–' + c.end : '')).join(', '));

  step('Nest, move, delete, undo');
  const rowCell = i => page.locator('table.grid-toc tbody tr').nth(i).locator('td.c-itemTitle .cell');
  const n0 = items.length;
  await rowCell(n0 - 2).click();
  await page.keyboard.press('Alt+Shift+ArrowRight');
  await rowCell(n0 - 1).click();
  await page.click('.grid-tools button:has-text("Nest")');
  items = await itemsHere();
  expect(items[n0 - 2].parent === items[n0 - 3].id && items[n0 - 1].parent === items[n0 - 3].id, 'both poems nested in the section');
  expect((await page.locator('.nest-mark').count()) >= 2, 'nested items are indented');
  await rowCell(n0 - 3).click();
  await page.keyboard.press('Alt+Shift+ArrowUp');
  items = await itemsHere();
  expect(items[n0 - 4].title === 'A Section' && items[n0 - 3].title === 'A Poem' && items[n0 - 2].title === 'Another Poem' && items[n0 - 1].title === 'A Typed Item', 'moving the section up takes its nested items along');
  expect(items.every((c, k) => c.seq === String(k + 1)), 'sequence numbers kept 1..n');
  await shot('08-contents-nested');
  await rowCell(n0 - 1).click();
  await page.click('.grid-tools button:has-text("Delete")');
  items = await itemsHere();
  expect(items.length === n0 - 1 && !items.some(c => c.title === 'A Typed Item'), 'delete removes the item');
  await clickAway();
  await page.click('button:has-text("Undo")');
  items = await itemsHere();
  expect(items.length === n0 && items[n0 - 1].title === 'A Typed Item', 'undo brings it back');

  step('Add several items');
  await page.click('button:has-text("Add several items")');
  await page.fill('.bulk-text', 'Editorial, by J. Q. Public ...... 9\n  Sub one .... 9\nLetters  10');
  await page.check('.bulk-opts label:has-text("Split") input');
  await page.check('.bulk-opts label:has-text("nest") input');
  expect((await page.locator('.bulk-preview tbody tr').count()) === 3, 'preview shows three items before adding');
  await page.click('.bulk .btn.primary');
  items = await itemsHere();
  const bulk = items.slice(-3);
  expect(bulk[0].title === 'Editorial' && bulk[0].author === 'J. Q. Public' && bulk[1].parent === bulk[0].id && !bulk[2].parent, 'bulk add splits the author and nests the indented line');

  step('Save contents');
  const tree4 = await save();
  const cRows = (await rowsOf(tree4.files[LIB_CONTENTS].text)).filter(r => r.IssueID === second);
  const byId = Object.fromEntries(cRows.map(r => [r.ContentID, r]));
  expect(cRows.length === items.length, 'contents file holds ' + items.length + ' items for the issue');
  const sec = cRows.find(r => r['Item Title'] === 'A Section'), poem = cRows.find(r => r['Item Title'] === 'A Poem');
  expect(sec && poem && poem['Parent ContentID'] === sec.ContentID && poem['Parent Item'] === 'A Section' && /Parent Item/.test(sec['N/A Fields']), 'nesting saved as Parent ContentID and Parent Item; top-level items mark Parent Item N/A');
  expect(cRows.every(r => new RegExp('^' + GAZ + '-C[2-9A-HJKMNP-WYZ]{6}$').test(r.ContentID)) && Object.keys(byId).length === cRows.length, 'every item has its own ContentID');
  expect(cRows.every(r => r['Issue Reference'] === libIssues[1].shortname), 'Issue Reference carries the short name');
  expect(Object.keys(tree4.files).filter(n => tree4.files[n].text !== seed[n]).sort().join(',') === [LIB_CONTENTS, TITLES_FILE].sort().join(','), 'only the Gazette contents file (and the Titles file saved earlier) differ from the originals');

  step('On to the next issue');
  await page.click('.next-issue a');
  await page.waitForTimeout(80);
  expect((await page.evaluate(() => SC.ui.parseRoute().issueID)) === libIssues[2].issueID, 'Next issue opens the third issue\'s contents');
  await page.keyboard.press('Alt+PageUp');
  await page.waitForTimeout(80);
  expect((await page.evaluate(() => SC.ui.parseRoute().issueID)) === second, 'Alt+Page Up goes back');

  step('Nested contents (The Demonstration Quarterly)');
  await page.selectOption('.context-bar select >> nth=0', 'DEMQUARX-1995');
  await page.waitForSelector('table.list tbody tr');
  await page.click('table.list tbody tr >> nth=0');
  await page.waitForSelector('table.grid-toc');
  expect((await page.locator('.nest-mark').count()) > 0, 'nested items shown under their parent');

  step('Run strips');
  await go('#/issues/PLABULLX-1961');
  await page.waitForSelector('.strip');
  expect((await page.locator('.strip-cells .sc.gap').count()) === 8 && /8 missing/.test(await text('.strip-head')), 'The Placeholder Bulletin: the strip marks the 8 missing numbers');
  const years = await page.locator('.strip-label').allInnerTexts();
  expect(years.join(',') === years.slice().sort().join(','), 'year rows in order');
  await go('#/contents/' + GAZ);
  await page.waitForSelector('.strip');
  expect((await page.locator('.strip-label').count()) === volumes, 'The Example Gazette: a row for each of ' + volumes + ' volumes');
  await page.click('.strip-cells a.sc >> nth=4');
  await page.waitForSelector('table.grid-toc');
  expect((await page.evaluate(() => SC.ui.parseRoute().issueID)) === libIssues[4].issueID, 'a square in the Contents picker opens that issue\'s contents');
  await go('#/library/' + GAZ);
  await page.waitForSelector('.entry-card .strip');
  expect(true, 'the title page shows its run');
  await shot('10-strip');

  step('Library › Names');
  await go('#/library');
  await page.click('.lib-tabs a:has-text("Names")');
  await page.waitForSelector('.nm-list');
  expect(/Names [\d,]+/.test(await text('.lib-tabs')), 'Names tab with a count of names');
  await page.fill('.toolbar input.search', 'public');
  await page.click('.nm-row:has(.nm-label:text-is("John Q. Public"))');
  await page.waitForSelector('.nm-make');
  expect((await page.inputValue('.nm-name-input')) === 'Public, John Q.', 'suggested heading: Public, John Q.');
  const groupForms = await page.locator('.nm-group .nm-form').allInnerTexts();
  expect(groupForms.indexOf('J.Q.P.') !== -1 && groupForms.indexOf('Jno. Q. Public') !== -1, 'likely forms of the same name include J.Q.P. and Jno. Q. Public');
  await shot('11-name');
  await page.click('.nm-group button:has-text("Combine")');
  await page.waitForSelector('.nm-forms');
  const headingID = await page.evaluate(() => SC.ui.parseRoute().titleID);
  expect(/^AU-[2-9A-HJKMNP-WYZ]{6}$/.test(headingID), 'a heading with its AuthorityID (' + headingID + ')');
  const formsBefore = await page.locator('.nm-forms > .nm-formlist li').count();
  await page.click('.nm-maybe li:has(.nm-form:text-is("Public")) button');
  expect((await page.locator('.nm-forms > .nm-formlist li').count()) === formsBefore + 1, 'adding the bare surname "Public" from the possible forms');
  await page.selectOption('#f-a-status', 'Confirmed');
  await page.fill('#f-a-dates', '1840–1910');
  await page.locator('#f-a-dates').press('Enter');
  expect(/1840–1910/.test(await text('.nm-detail .entry-main')), 'heading dates');
  await shot('12-heading');
  const treeN = await save();
  const auth = treeN.files['SCAT_' + SLUG + '_AUTHORITIES.csv'];
  const authRows = auth ? await rowsOf(auth.text) : [];
  expect(authRows.length === 1 && authRows[0]['Authorized Form'] === 'Public, John Q.' && authRows[0].Status === 'Confirmed' && /J\.Q\.P\./.test(authRows[0]['Variant Forms']) && / \| Public$| \| Public \|/.test(authRows[0]['Variant Forms']),
    'saved to SCAT_' + SLUG + '_AUTHORITIES.csv: heading, status, forms');
  expect(treeN.files[LIB_CONTENTS].text === tree4.files[LIB_CONTENTS].text, 'the Gazette contents file untouched by making a heading');
  await page.click('.seg-btn:has-text("Suggested matches")');
  await page.waitForSelector('.nm-group');
  expect((await page.locator('.nm-group').count()) > 10, 'suggested matches listed (' + await page.locator('.nm-group').count() + ')');

  // ── Search (Phase 2) ──
  // A read-only session first: everything it does is checked against what the app and the
  // browser held before it.
  const roState = () => page.evaluate(async () => {
    const st = SC.session.store;
    const db = await new Promise(r => { const q = indexedDB.open('slaughter-cataloger-3'); q.onsuccess = () => r(q.result); q.onerror = () => r(null); });
    let journal = -1, snap = null;
    if (db) {
      await new Promise(r => { const t = db.transaction(['kv', 'journal'], 'readonly'); t.objectStore('journal').count().onsuccess = e => { journal = e.target.result; };
        t.objectStore('kv').get('session').onsuccess = e => { const x = e.target.result; snap = x ? [x.seq, x.gen, x.snapshot && x.snapshot.contents.length] : null; }; t.oncomplete = r; t.onerror = r; });
      db.close();
    }
    const kv = s => { const o = {}; for (let k = 0; k < s.length; k++) o[s.key(k)] = s.getItem(s.key(k)); return o; };
    return JSON.stringify({ version: st.version, dirty: Array.from(st.dirty).sort(), undo: [st.canUndo, st.undoLabel], redo: [st.canRedo, st.redoLabel], revisions: Array.from(st.revisions()),
      journal, snapshot: snap, localStorage: kv(localStorage), sessionStorage: kv(sessionStorage) });
  });
  const fsLogLength = () => page.evaluate(() => window.__SC_TEST_FS_LOG__.length);
  const active = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute('data-key') || a.getAttribute('data-cell') || a.id || a.tagName) : ''; });
  const risOf = () => page.evaluate(g => SC.outputs.ris(SC.catalog.build(SC.session.store, { titleIDs: [g], date: new Date(0) })), GAZ);
  const coreRun = (q, o) => page.evaluate(([q, o]) => { const ix = SC.search.createIndex(() => SC.session.store.state); const r = ix.run(q, o); return { counts: r.counts, groups: { title: r.groups.title.map(h => h.key), issue: r.groups.issue.map(h => h.key), item: r.groups.item.map(h => h.key), name: r.groups.name.map(h => h.key) } }; }, [q, o || {}]);
  const showing = () => page.locator('.search-group').count();

  step('Search: the top-bar box (read-only session begins)');
  await page.evaluate(() => SC.session.compactNow());
  await page.waitForFunction(() => SC.session.pendingWrites() === 0);
  const ro0 = await roState(), log0 = await fsLogLength(), ris0 = await risOf();
  await go('#/library');
  await page.waitForSelector('#top-search');
  expect(!(await page.evaluate(() => SC.searchUI.stats().built)), 'still no index before search is used');
  const tTop = Date.now();
  await page.click('#top-search');
  await page.keyboard.type('public');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.search-group');
  step('focus, typing "public", Enter and the results page: ' + (Date.now() - tTop) + ' ms (includes the first build and Playwright\'s own steps)');
  expect((await page.evaluate(() => location.hash)) === '#/search?q=public', 'Enter opens #/search?q=public');
  const scope = (await text('.search-scope')).replace(/\s+/g, ' ');
  expect(/Searching Example Library EXAMPLE-LIBRARY, the library open now/.test(scope) && /never the text of an issue or a name merely mentioned/.test(scope), 'the page names the library searched, and what is not searched: ' + scope.slice(0, 90) + '…');
  const heads = (await page.locator('.search-group h2').allInnerTexts()).map(h => h.replace(/\s+/g, ' ').trim());
  const wantP = await coreRun('public');
  expect(heads.join(' | ') === ['Titles', 'Issues', 'Contents', 'Names'].map((l, k) => l + ' ' + fmt(wantP.counts[['title', 'issue', 'item', 'name'][k]])).filter((x, k) => wantP.counts[['title', 'issue', 'item', 'name'][k]]).join(' | '),
    'results grouped as Titles, Issues, Contents, Names, with the counts the search core gives (' + heads.join(' | ') + ')');
  const firstItems = await page.locator('.r-item .r-main').evaluateAll(as => as.slice(0, 5).map(a => a.getAttribute('data-key')));
  expect(JSON.stringify(firstItems) === JSON.stringify(wantP.groups.item.slice(0, 5)), 'contents items in the core\'s ranked order');
  expect((await page.locator('.search-page mark').count()) > 0, 'matched words are marked');
  expect((await text('.search-page [role=status]')).indexOf((await text('.search-bar .summary')).replace(/\.$/, '')) === 0, 'the summary is announced in the status region: ' + await text('.search-page [role=status]'));
  expect((await page.locator('.search-page h1').count()) === 1 && (await page.locator('.search-group[aria-labelledby] > h2').count()) === heads.length && (await page.locator('ol.results').count()) === heads.length,
    'one h1; each group a labelled section with an h2 and an ordered list');
  expect((await page.locator('ol.results li').evaluateAll(lis => lis.every(li => li.querySelectorAll('a, button, input').length === 1))), 'each result is a single link, with no other control inside it');

  step('Search: open a result of each kind, and Back');
  const openAndBack = async (sel, what, check) => {
    const link = page.locator(sel).first();
    const key = await link.getAttribute('data-key');
    await link.click();
    await check(key);
    await page.goBack();
    await page.waitForSelector('.search-group');
    await page.waitForFunction(k => document.activeElement && document.activeElement.getAttribute('data-key') === k, key, { timeout: 3000 }).catch(() => {});
    expect((await active()) === key, what + ': Back returns to the results, with the focus on the result opened');
  };
  await openAndBack('.r-title .r-main', 'title', async key => {
    await page.waitForSelector('.entry-main');
    expect((await page.evaluate(() => location.hash)) === '#/library/' + key.slice(6), 'a title opens its record in Library (' + key.slice(6) + ')');
  });
  await openAndBack('.r-issue .r-main', 'issue', async key => {
    await page.waitForSelector('.issue-form');
    const r = await page.evaluate(() => SC.ui.parseRoute());
    expect(r.panel === 'issues' && r.issueID === key.slice(6), 'an issue opens its form in Issues (' + r.issueID + ')');
  });
  await openAndBack('.r-item .r-main', 'contents item', async key => {
    const cid = key.slice(5);
    await page.waitForSelector('tr.arrived');
    await page.waitForFunction(c => document.activeElement && document.activeElement.getAttribute('data-cell') === c + ':itemTitle', cid, { timeout: 3000 }).catch(() => {});
    const a = await page.evaluate(c => { const tr = document.querySelector('tr[data-item="' + c + '"]'); const b = tr.getBoundingClientRect(); return { route: SC.ui.parseRoute(), arrived: tr.classList.contains('arrived'), current: tr.getAttribute('aria-current'),
      inView: b.top >= 0 && b.bottom <= innerHeight, focus: document.activeElement.getAttribute('data-cell'), bar: getComputedStyle(tr.querySelector('td.seq')).boxShadow }; }, cid);
    expect(a.route.panel === 'contents' && a.route.itemID === cid, 'an item opens its issue\'s contents at the item (#/contents/…/' + cid + ')');
    expect(a.arrived && a.current === 'true' && a.inView && /inset/.test(a.bar), 'its row is in view and marked: a bar and an outline, aria-current');
    expect(a.focus === cid + ':itemTitle', 'the focus is on its title cell');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    expect((await roState()) === ro0, 'arriving, then Tab and Escape, changes nothing (no edit, nothing marked changed)');
  });
  await openAndBack('.r-name .r-main', 'name', async key => {
    await page.waitForSelector('.nm-main');
    expect((await page.evaluate(() => SC.ui.parseRoute())).titleID === key.slice(5), 'a name opens it in Library › Names');
  });
  expect((await page.evaluate(() => location.hash)) === '#/search?q=public', 'the query survives the round trips');

  step('Search: keyboard only');
  await go('#/issues/' + GAZ);
  await page.waitForSelector('table.list');
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await page.keyboard.press('/');
  expect((await active()) === 'top-search', '"/" goes to the search box');
  await page.keyboard.type('poem');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.search-group');
  let reached = '';
  for (let k = 0; k < 25 && !reached; k++) { await page.keyboard.press('Tab'); const a = await active(); if (/^(item|title|issue|name):/.test(a)) reached = a; }
  expect(!!reached, 'Tab reaches the first result (' + reached + ')');
  await page.keyboard.press('Enter');
  await page.waitForSelector('tr.arrived');
  await page.goBack();
  await page.waitForSelector('.search-group');
  await page.waitForFunction(k => document.activeElement && document.activeElement.getAttribute('data-key') === k, reached, { timeout: 3000 }).catch(() => {});
  expect((await active()) === reached, 'Enter opens it; Back returns with the focus on it');
  await page.waitForSelector('.search-bar button:has-text("Only in")', { timeout: 3000 }).catch(() => {});
  const onlyIn = (await page.locator('.search-bar').first().innerText()).replace(/\s+/g, ' ');
  expect(/Only in The Example Gazette/.test(onlyIn), 'from a title\'s Issues stage the results offer "Only in The Example Gazette" (' + onlyIn.slice(-60) + ')');
  await page.click('.search-bar button:has-text("Only in")');
  await page.waitForFunction(() => /in%3AEXAGAZEX-1872/.test(location.hash));
  const onlyGaz = await page.evaluate(() => Array.from(document.querySelectorAll('.r-item .r-main')).every(a => /EXAGAZEX-1872/.test(a.getAttribute('href'))));
  expect(onlyGaz, 'and it narrows the search to that title (in:EXAGAZEX-1872)');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('/');
  expect((await active()) === 'search-q', 'on the results page, "/" goes to the page\'s own field');

  step('Search: kinds, order, Show more, nothing found, notices');
  await go('#/search?q=public');
  await page.waitForSelector('.search-group');
  await page.click('.search-tools .seg-btn:has-text("Contents")');
  await page.waitForFunction(() => /kind=item/.test(location.hash));
  expect((await showing()) === 1 && (await page.locator('.search-tools .seg-btn:has-text("Contents")').getAttribute('aria-pressed')) === 'true', 'the Contents chip shows the contents group only, pressed (aria-pressed)');
  await page.click('.seg-btn:has-text("Catalog order")');
  await page.waitForFunction(() => /order=catalog/.test(location.hash));
  const cat = await coreRun('public', { order: 'catalog' });
  const shownCat = await page.locator('.r-item .r-main').evaluateAll(as => as.map(a => a.getAttribute('data-key')));
  expect(JSON.stringify(shownCat) === JSON.stringify(cat.groups.item.slice(0, 100)), 'catalog order: the first 100 items exactly in catalog order');
  const subs = await page.evaluate(() => Array.from(document.querySelectorAll('.search-group h3.search-sub')).map(h => { const ol = h.nextElementSibling;
    return { text: h.textContent.replace(/\s+/g, ' ').trim(), labels: !!ol && ol.tagName === 'OL' && ol.getAttribute('aria-labelledby') === h.id,
      issues: ol ? Array.from(ol.querySelectorAll('.r-main')).map(a => decodeURIComponent(a.getAttribute('href')).split('/')[3]) : [] }; }));
  expect(subs.length > 1 && subs.every(x => x.labels && x.issues.length && x.issues.every(i => i === x.issues[0])) && subs.every((x, k) => k === 0 || x.issues[0] !== subs[k - 1].issues[0]) && /^The Example Gazette › /.test(subs[0].text),
    'catalog order: the items are under a sub-heading for each title and issue, each labelling its list (' + subs.length + ' sub-headings; the first: ' + (subs[0] || {}).text + ')');
  await page.click('.search-group .more button');
  await page.waitForFunction(() => document.querySelectorAll('.r-item').length > 100);
  expect((await page.locator('.r-item').count()) === Math.min(300, cat.counts.item) && (await active()) === cat.groups.item[100], 'Show more adds up to 200 rows and puts the focus on the first new one');
  await go('#/search?q=' + encodeURIComponent('title:the'));
  await page.waitForSelector('.search-group');
  const tc = (await coreRun('title:the')).counts;
  const sumT = await text('.search-bar .summary');
  expect(sumT === '4 titles, 6 issues and 1,205 contents items for “title:the”; no names.' && tc.title === 4 && tc.issue === 6 && tc.item === 1205 && tc.name === 0,
    'the summary accounts for every kind, an empty one too, and keeps the thousands separator: ' + sumT);
  await go('#/search?q=zzzzq%20gazette');
  await page.waitForSelector('.search-none');
  expect(/Nothing matches “zzzzq gazette”/.test(await text('.search-bar .summary')), 'nothing found says so');
  await page.click('.search-parts button:has-text("zzzzq")');
  await page.waitForFunction(() => /q=gazette$/.test(location.hash));
  await page.waitForSelector('.search-group');
  expect(true, 'each part of a failed search can be taken out with one click (zzzzq ×)');
  await go('#/search?q=year%3Aabc%20gazette');
  await page.waitForSelector('.search-notices');
  expect(/not a year/.test(await text('.search-notices')), 'a malformed filter is a notice, and is ignored');
  await go('#/search');
  await page.waitForSelector('.search-help');
  expect((await page.locator('.search-help a').count()) >= 5, 'an empty query shows help with examples to click');

  step('Search: heading expansion');
  await go('#/search?q=' + encodeURIComponent('credit:"Public, John Q."') + '&kind=item&order=catalog');
  await page.waitForSelector('.r-via');
  expect(/Credited as .+, filed under Public, John Q\./.test(await text('.r-via')), 'items credited under another form of a heading are labelled: ' + (await text('.r-via')));

  step('Search: the issue package in the folder is never searched or opened');
  for (const c of CANARIES) {
    await go('#/search?q=' + encodeURIComponent(c));
    await page.waitForSelector('.search-bar .summary');
    expect(/Nothing matches/.test(await text('.search-bar .summary')), 'nothing found for ' + c);
  }
  const fsLog = (await page.evaluate(() => window.__SC_TEST_FS_LOG__)).slice(log0);
  expect(fsLog.length === 0, 'the search session made no call on the library folder at all (' + fsLog.length + ': ' + fsLog.slice(0, 3).join(', ') + ')');
  expect((await page.evaluate(() => window.__SC_TEST_FS_LOG__.filter(e => / _issues\//.test(e)))).length === 0, 'and nothing under _issues/ has been opened since the app started');

  step('Search: read-only session ends');
  expect((await roState()) === ro0, 'the whole session changed nothing: store version, changed files, undo and redo, revisions, the browser\'s working copy (journal and snapshot), localStorage, sessionStorage');
  expect((await risOf()) === ris0, 'the Compiler\'s output (RIS of the Gazette) is the same after searching');
  expect((await page.evaluate(() => SC.searchUI.stats().builds)) === 1, 'the index was built once, on first use, and kept up since');

  if (process.env.SC_AXE) {
    step('Search: accessibility (axe-core ' + require(path.join(path.dirname(process.env.SC_AXE), 'package.json')).version + ')');
    await page.addScriptTag({ path: process.env.SC_AXE });
    const scan = async (sel, what) => {
      const v = await page.evaluate(async s => (await axe.run({ include: [[s]] }, { resultTypes: ['violations'] })).violations.map(x => x.id + ':' + x.impact + '×' + x.nodes.length), sel);
      expect(!v.some(x => /:(serious|critical)×/.test(x)), 'axe-core, ' + what + ': no serious or critical violations' + (v.length ? ' (minor or moderate: ' + v.join(', ') + ')' : ''));
    };
    for (const [h, sel, what] of [['#/search', '.search-help', 'empty query'], ['#/search?q=public', '.search-group', 'results'], ['#/search?q=zzzzq%20gazette', '.search-none', 'nothing found'],
      ['#/search?q=public&kind=item&order=catalog', '.search-group', 'a kind and an order chosen']]) {
      await go(h); await page.waitForSelector(sel); await scan('.search-page', what);
    }
    await go('#/library'); await page.waitForSelector('#top-search'); await scan('.topsearch', 'the top-bar box');
    await go('#/search?q=public'); await page.waitForSelector('.r-item'); await page.click('.r-item .r-main >> nth=0'); await page.waitForSelector('tr.arrived');
    await scan('table.grid-toc', 'the contents grid, arrived at an item');
    const whole = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(x => x.id + ':' + x.impact));
    step('axe-core on the whole contents page, for information: ' + (whole.length ? whole.join(', ') : 'no violations'));
  } else step('axe-core not available (an --offline run): the accessibility scan was not run');

  step('Search: an edit and its undo show at once');
  const target = await page.evaluate(i => { const c = SC.session.store.contentsOfIssue(i)[1]; return { tid: c.titleID || SC.records.titleOfContent(SC.session.store.state, c), iid: c.issueID, cid: c.contentID, title: c.itemTitle }; }, libIssues[6].issueID);
  await go('#/contents/' + target.tid + '/' + target.iid + '/' + target.cid);
  await page.waitForSelector('tr.arrived');
  await page.waitForFunction(c => document.activeElement && document.activeElement.getAttribute('data-cell') === c + ':itemTitle', target.cid);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Quillwort Annals');
  await page.keyboard.press('Enter');
  await page.waitForFunction(c => SC.session.store.state.contents.get(c).itemTitle === 'Quillwort Annals', target.cid);
  await go('#/search?q=quillwort');
  await page.waitForSelector('.r-item');
  expect((await page.locator('.r-item .r-main').getAttribute('data-key')) === 'item:' + target.cid, 'the new title is found');
  const oldQ = '"' + target.title + '"';
  const oldHits = (await coreRun(oldQ)).groups.item;
  expect(oldHits.indexOf('item:' + target.cid) === -1, 'and the old one no longer finds it');
  const said = await text('.search-page [role=status]');
  await page.click('.topbar button:has-text("Undo")');
  await page.waitForSelector('.search-none');
  expect(true, 'Undo, with the results open: the item leaves them without a reload');
  expect((await text('.search-page [role=status]')) === said, 'a change made elsewhere is not announced');
  await page.click('.topbar button:has-text("Redo")');
  await page.waitForSelector('.r-item');
  await page.click('.topbar button:has-text("Undo")');
  await page.waitForSelector('.search-none');
  expect((await coreRun(oldQ)).groups.item.indexOf('item:' + target.cid) !== -1, 'Redo brings it back, Undo takes it away again; the old title finds it again');

  step('Search: a value that looks like markup is shown as text');
  await page.evaluate(() => { const st = SC.session.store; const t = Array.from(st.state.titles.values())[0]; st.put('title', Object.assign({}, t, { titleID: 'XSSPROBE-1999', titleCode: 'XSSPROBE', firstYear: '1999', canonicalTitle: '<img src=x onerror="window.__xss=1">Probe' }), 'probe'); });
  await go('#/search?q=probe');
  await page.waitForSelector('.r-title');
  const xss = await page.evaluate(() => ({ text: document.querySelector('.r-title .r-main').textContent, imgs: document.querySelectorAll('.search-page img').length, ran: !!window.__xss }));
  expect(/<img src=x onerror="window.__xss=1">Probe/.test(xss.text) && xss.imgs === 0 && !xss.ran, 'a title with markup in it is shown as its characters, and nothing runs');
  await page.click('.topbar button:has-text("Undo")');
  await page.waitForSelector('.search-none');

  step('Search: timings at sample scale');
  const tRender = Date.now();
  await go('#/search?q=gazette');
  await page.waitForSelector('.r-issue');
  const renderMs = Date.now() - tRender;
  await page.click('#search-q', { clickCount: 3 });
  await page.keyboard.type('lamp');
  const tType = Date.now();
  await page.waitForFunction(() => /for “lamp”/.test((document.querySelector('.search-bar .summary') || {}).textContent || ''));
  const typeMs = Date.now() - tType;
  step('results page for "gazette" drawn in ' + renderMs + ' ms; typing to visible results ' + typeMs + ' ms (150 ms of it the pause after typing); both measured through Playwright');
  step('Phase 2 targets (diagnostic, never a failure): results page ' + TARGET.render + ' ms ' + metOr(renderMs, TARGET.render) + '; typing to results ' + TARGET.typing + ' ms ' + metOr(typeMs, TARGET.typing));
  timings.sample = { render_ms: renderMs, typing_to_results_ms: typeMs };
  perfLines.push('Chromium (tools/test-walkthrough.js), sample library:',
    '  results page drawn      ' + String(renderMs + ' ms').padStart(9) + '   target ' + TARGET.render + ' ms ' + metOr(renderMs, TARGET.render),
    '  last key to results     ' + String(typeMs + ' ms').padStart(9) + '   target ' + TARGET.typing + ' ms ' + metOr(typeMs, TARGET.typing),
    '  limit 2,000 ms (results page, typing): ' + (Math.max(renderMs, typeMs) <= PERF_LIMIT_MS ? 'held' : 'EXCEEDED'));
  expect(renderMs <= PERF_LIMIT_MS && typeMs <= PERF_LIMIT_MS, 'at sample scale: results page and typing to results within the 2,000 ms limit (' + renderMs + ' and ' + typeMs + ' ms)');

  // ── Stage 4 ──
  step('Compiler: one title');
  const filesBefore = JSON.stringify(await page.evaluate(() => Object.keys(window.__SC_TEST_FS__.tree().files).sort()));
  await go('#/compiler/' + GAZ);
  await page.waitForSelector('.cmp-bar');
  const stamp = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); });
  const libNow = await page.evaluate(g => ({ issues: SC.session.store.issuesOfTitle(g).length, items: SC.session.store.contentsOfTitle(g).length }), GAZ);
  expect((await text('.cmp-file code')) === 'SCATOUT_' + SLUG + '_' + GAZ + '_CATALOG_' + stamp + '.html', 'catalog of the current title, named SCATOUT_' + SLUG + '_' + GAZ + '_CATALOG_<date>.html');
  expect(new RegExp('1 title · ' + runLength + ' issues').test(await text('.cmp-counts')), 'counts the whole run (' + await text('.cmp-counts') + ')');
  const frame = page.frameLocator('.cmp-frame');
  expect(/Example Gazette/.test(await frame.locator('.journal-title').first().innerText()) && (await frame.locator('.issue').count()) === 25, 'preview shows the catalog, first 25 issues');
  await shot('10-compiler-catalog');
  const grab = async () => { const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.cmp-actions button:has-text("Download")')]); return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') }; };
  let got = await grab();
  expect((got.text.match(/<div class="issue" id=/g) || []).length === libNow.issues, 'downloaded catalog has all ' + libNow.issues + ' issues');
  await page.click('.cmp-output:has(.co-label:text-is("RIS"))');
  expect(/^TY {2}- JOUR/.test(await text('.cmp-text')), 'RIS preview');
  got = await grab();
  expect(/_RIS-ZOTERO_\d{8}\.ris$/.test(got.name) && (got.text.match(/^TY {2}- /gm) || []).length === libNow.items, 'RIS download has one record per item (' + libNow.items + ')');
  expect(/AU {2}- Public, John Q\.\n[\s\S]*?N1 {2}- Credited as: J\.Q\.P\./.test(got.text), 'RIS gives the heading as author and the credit as printed in a note');
  await page.click('.cmp-output:has(.co-label:text-is("Name index"))');
  expect(/Public, John Q\./.test(await frame.locator('body').innerText()), 'name index preview');
  await page.click('.seg-btn:has-text("Plain text")');
  got = await grab();
  expect(/_NAME-INDEX_\d{8}\.txt$/.test(got.name) && /^Public, John Q\., 1840–1910 \(as /m.test(got.text) && /^J\.Q\.P\. see Public, John Q\.$/m.test(got.text), 'name index: the heading with its forms, and J.Q.P. see Public, John Q.');
  await page.click('.cmp-output:has(.co-label:text-is("Proofing catalog"))');
  got = await grab();
  expect((got.text.match(/<section class="proof-issue">/g) || []).length === libNow.issues && /_PROOFING-CATALOG_/.test(got.name), 'proofing catalog: a section for every issue');
  await page.click('.cmp-output:has(.co-label:text-is("Checklist"))');
  await page.click('.seg-btn:has-text("Plain text")');
  await page.click('.seg-btn:text-is("Plain")');
  got = await grab();
  expect(/_CHECKLIST_\d{8}\.txt$/.test(got.name) && (got.text.match(/^☐ /gm) || []).length === libNow.issues, 'plain-text checklist, one line per issue');
  expect(/☐ Vol\. 1, no\. 1 \(whole no\. 1\) — May 4, 1872/.test(got.text), 'checklist line: Vol. 1, no. 1 (whole no. 1) — May 4, 1872');
  await page.click('label:has-text("Some volumes") input');
  await page.click('.cmp-groups button:has-text("None")');
  await page.click('.cmp-groups label:has-text("Volume 3 ") input');
  expect(new RegExp('\\b' + vol3 + ' issues').test(await text('.cmp-counts')), 'choosing volume 3 alone: ' + vol3 + ' issues');
  await shot('11-compiler-checklist');

  step('Compiler: several titles');
  await page.click('.cmp-block-head button:has-text("All")');
  await page.click('.cmp-output:has(.co-label:text-is("BibTeX"))');
  const allItems = await page.evaluate(() => { const st = SC.session.store; let n = 0; st.state.issues.forEach(i => { n += st.contentsOfIssue(i.issueID).length; }); return n; });
  got = await grab();
  expect(got.name === 'SCATOUT_' + SLUG + '_BIBTEX_' + stamp + '.bib', 'several titles: the library name alone (' + got.name + ')');
  expect((got.text.match(/^@article\{/gm) || []).length === allItems, 'BibTeX for the whole library: ' + allItems + ' entries');
  expect(JSON.stringify(await page.evaluate(() => Object.keys(window.__SC_TEST_FS__.tree().files).sort())) === filesBefore && /All changes saved|changed/.test(await text('.save-state')), 'compiling writes nothing to the library folder');

  step('A new title, its first issue and its first item');
  await page.click('.stage:has-text("Library")');
  await page.click('button:has-text("Add title")');
  await page.fill('#f-canonicalTitle', 'The Digest');
  await page.locator('#f-canonicalTitle').press('Tab');
  await page.waitForFunction(() => document.getElementById('f-titleCode').value !== '', null, { timeout: 3000 }).catch(() => {});
  expect((await page.inputValue('#f-titleCode')) === 'DIGESTXX', 'title code suggested as DIGESTXX, a short title padded with X (' + await page.inputValue('#f-titleCode') + ')');
  const order = await page.$$eval('fieldset.group:first-of-type input', els => els.map(e => e.id));
  expect(order[0] === 'f-canonicalTitle', 'canonical title is the first field of the form');
  await page.fill('#f-firstYear', '1925');
  await page.locator('#f-firstYear').press('Tab');
  await page.click('.sticky-actions button:has-text("Add title")');
  await page.waitForSelector('.entry-id');
  expect(/DIGESTXX-1925/.test(await text('.entry-id')), 'new TitleID DIGESTXX-1925');
  await go('#/issues/DIGESTXX-1925');
  await page.click('.panel-head button:has-text("Record the first issue")');
  await page.waitForSelector('.draft-card');
  await page.fill('#f-volume', '1');
  await page.locator('#f-volume').press('Tab');
  await page.fill('#f-issue', '1');
  await page.locator('#f-issue').press('Tab');
  await page.click('.months-pick button:has-text("Jan")');
  await page.fill('#f-year', '1925');
  await page.locator('#f-year').press('Tab');
  expect((await page.inputValue('#f-shortname')) === 'The Digest V1 I1', 'a first issue gets the default short name (' + await page.inputValue('#f-shortname') + ')');
  await page.click('.sticky-actions button:has-text("Record issue")');
  await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
  const eg = await page.evaluate(() => SC.session.store.issuesOfTitle('DIGESTXX-1925').map(i => i.issueID));
  await go('#/contents/DIGESTXX-1925/' + eg[0]);
  await page.waitForSelector('table.grid-toc');
  await page.click('tr.draft-row:last-child td.c-itemTitle .cell');
  await page.keyboard.type('Opening Remarks');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);

  const firstCID = await page.evaluate(() => Array.from(SC.session.store.state.contents.keys())[0]);
  step('Reload: work restored from the browser');
  await page.reload();
  await page.waitForSelector('.topbar');
  const dirty2 = await text('.save-state');
  expect(/changed/.test(dirty2), 'unsaved new title, issue and item survive reload (' + dirty2 + ')');
  await page.goto('file://' + app + '#/library');
  await page.waitForSelector('table.shelf tbody tr');
  expect((await page.locator('table.shelf tbody tr').count()) === st.titles.size + 1, (st.titles.size + 1) + ' titles after reload');
  expect(await page.evaluate(id => SC.session.store.state.contents.has(id), firstCID), 'ContentIDs are the same after reload');
  const tree5 = await save();
  expect(/DIGESTXX-1925/.test(tree5.files[TITLES_FILE].text), 'new title saved to the Titles file');
  const egIss = tree5.files['SCAT_' + SLUG + '_DIGESTXX-1925_ISSUES.csv'], egCon = tree5.files['SCAT_' + SLUG + '_DIGESTXX-1925_CONTENTS.csv'];
  expect(!!egIss && (await rowsOf(egIss.text)).length === 1 && (await rowsOf(egIss.text))[0]['Month(s)'] === 'Jan', 'new Issues file for the new title, with its first issue');
  expect(!!egCon && (await rowsOf(egCon.text))[0]['Item Title'] === 'Opening Remarks', 'new Contents file for the new title, with its first item');
  await shot('09-dashboard-after');

  step('Guide');
  await page.click('text=Guide');
  expect(/Recording issues/.test(await text('.guide')) && /Recording contents/.test(await text('.guide')) && /Compiling/.test(await text('.guide')) && /Names and headings/.test(await text('.guide')), 'guide covers recording issues and contents, names, and compiling');

  step('Search: timings at 10,000 items (the generated library of tools/test-search.js, opened in a fresh tab)');
  {
    const { makeLibrary, toFiles } = require('./lib/search-library');
    const bigState = makeLibrary();
    const big = toFiles(bigState);
    const word = Array.from(bigState.contents.values())[3].itemTitle.split(' ')[0].toLowerCase();
    const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', e => errors.push('page error (10,000 items): ' + e.message));
    await p2.addInitScript(fakeFS, { files: big, memoryOnly: true });
    await p2.goto('file://' + app);
    await p2.click('text=Open library folder');
    await p2.waitForSelector('table.shelf tbody tr', { timeout: 120000 });
    expect(/10,000 contents items/.test(await p2.locator('.summary').first().innerText()), 'the generated library opened: 10,000 contents items');
    const first = await p2.evaluate(async () => {
      const el = document.getElementById('top-search');
      const t = performance.now();
      el.focus();
      await new Promise(r => { const f = () => (SC.searchUI.stats().built ? r() : setTimeout(f, 2)); f(); });
      const s = SC.searchUI.stats();
      return { focusToBuilt: performance.now() - t, build: s.buildMs, order: s.orderMs, names: s.namesMs, docs: s.docs };
    });
    const tR = Date.now();
    await p2.evaluate(w => { location.hash = '#/search?q=' + w; }, word);
    await p2.waitForSelector('.search-group');
    const render = Date.now() - tR;
    await p2.click('#search-q', { clickCount: 3 });
    await p2.keyboard.type(word.slice(0, 3));
    const tT = Date.now();
    await p2.waitForFunction(w => ((document.querySelector('.search-bar .summary') || {}).textContent || '').indexOf('for “' + w + '”') !== -1, word.slice(0, 3));
    const typing = Date.now() - tT;
    const counts = await p2.locator('.search-bar .summary').innerText();
    const r1 = n => Math.round(n * 10) / 10;
    timings.tenThousand = { first_build_in_browser_ms: r1(first.build), order_ms: r1(first.order), focus_to_index_ready_ms: r1(first.focusToBuilt), documents: first.docs, results_page_ms: render, typing_to_results_ms: typing, query: word };
    const fb = first.build + first.order;
    step('first build in the browser (cold, on first focus of the box): ' + r1(first.build) + ' ms build + ' + r1(first.order) + ' ms catalog order; focus to index ready ' + r1(first.focusToBuilt) + ' ms');
    step('results page for "' + word + '" drawn in ' + render + ' ms; then "' + word.slice(0, 3) + '" typed over it: last key to visible results (' + counts.replace(/\s+/g, ' ').slice(0, 80) + ') ' + typing + ' ms, 150 ms of it the pause after typing');
    step('Phase 2 targets (diagnostic, never a failure): first build ' + TARGET.firstBuild + ' ms (a mid-range laptop) ' + metOr(fb, TARGET.firstBuild) + '; results page ' + TARGET.render + ' ms ' +
      metOr(render, TARGET.render) + '; typing to results ' + TARGET.typing + ' ms ' + metOr(typing, TARGET.typing));
    perfLines.push('Chromium (tools/test-walkthrough.js), generated 10,000-item library:',
      '  first build, with order ' + String(r1(fb) + ' ms').padStart(9) + '   target ' + TARGET.firstBuild + ' ms ' + metOr(fb, TARGET.firstBuild) + '   (focus to index ready ' + r1(first.focusToBuilt) + ' ms)',
      '  results page drawn      ' + String(render + ' ms').padStart(9) + '   target ' + TARGET.render + ' ms ' + metOr(render, TARGET.render),
      '  last key to results     ' + String(typing + ' ms').padStart(9) + '   target ' + TARGET.typing + ' ms ' + metOr(typing, TARGET.typing),
      '  limit 2,000 ms (first-use indexing, results page, typing): ' + (Math.max(first.focusToBuilt, render, typing) <= PERF_LIMIT_MS ? 'held' : 'EXCEEDED'));
    expect(first.focusToBuilt <= PERF_LIMIT_MS && render <= PERF_LIMIT_MS && typing <= PERF_LIMIT_MS,
      'at 10,000 items: first-use indexing (focus to index ready), the results page and typing to results within the 2,000 ms limit (' + r1(first.focusToBuilt) + ', ' + render + ' and ' + typing + ' ms)');
    await ctx2.close();
  }
  if (process.env.SC_SEARCH_BROWSER_TIMES) fs.writeFileSync(process.env.SC_SEARCH_BROWSER_TIMES, JSON.stringify(timings, null, 2) + '\n');
  if (process.env.SC_PERF_SUMMARY && perfLines.length) fs.appendFileSync(process.env.SC_PERF_SUMMARY, perfLines.join('\n') + '\n\n');

  console.log(log.join('\n'));
  if (errors.length) { console.log('\nPage errors:\n' + errors.join('\n')); failures += errors.length; }
  console.log(failures ? '\nFAILED (' + failures + ')' : '\nPASSED');
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch(async e => { console.log((globalThis.__log || []).join('\n')); console.log((globalThis.__errors || []).join('\n')); console.error(e.message.split('\n')[0]); if (globalThis.__page && process.argv[5]) await globalThis.__page.screenshot({ path: path.join(process.argv[5], 'failure.png') }); process.exit(2); });
