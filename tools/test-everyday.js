#!/usr/bin/env node
/* Slaughter Cataloger 3 — everyday features in the browser (Stage A2: the class 2 rows of the A1
   audit, core function, that no test had reached).

   usage: node tools/test-everyday.js <app.html>

   The invented library of tools/lib/integrity-library.js, saved once as the app saves it, in a test
   folder kept by the page in its own IndexedDB database. Each section starts from a new browser
   profile. What the app does was established from the code first; each section checks it:
   1  moving around: the stage rail, the context bar's selects and Previous and Next, Alt+Page Up and
      Page Down in Issues and Contents, the Next issue link, a title row and its Issues link
      (NAV-01, NAV-03, CON-21, LIB-16);
   2  a new issue: Follows, Start over, the draft kept per title, "Keep it" and "Start again after …"
      (ISS-09, ISS-16);
   3  how the numbers move on: the Moves on boxes, the date step, the settings remembered (ISS-08);
   4  months and seasons by click, and Set end year (ISS-10);
   5  the "Make it vol. …" suggestion (ISS-11);
   6  a title missing from the Titles file: its issues read only, the warnings (ISS-19, LIB-08);
   7  Contents cells: ? and N/A from the toolbar and the keys, Escape, Insert below, one row pasted
      into an item (CON-12, CON-13, CON-10, CON-05);
   8  starting a new library: the form, its slug rule and Cancel, and a library without a folder
      (LIB-04, LIB-06, WF-08);
   9  CSV files dropped on the welcome page; a folder of Beta 2 files only (LIB-03, LIB-07);
   10 adding a title: the code suggested, the code and year checked (LIB-23);
   11 Names: filters and Find, Possibly the same (Add, Add all), Find another form, Remove, Add to a
      heading, Suggested matches (Combine, Not the same), a form under two headings (NAM-01, NAM-03,
      NAM-05, NAM-06, NAM-08, NAM-09, NAM-11, WF-03);
   12 the Compiler: titles chosen (one, several, All, None) and remembered, its notes, Copy and Open
      (CMP-01, CMP-10, CMP-12);
   13 Save while the folder is being read (SAV-15);
   14 Entry Order missing or repeated: rows numbered in file order (CSV-11).
   Fails on any page error or failed check. */
'use strict';
const path = require('path'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const ROOT = path.join(__dirname, '..');
const app = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'slaughter-cataloger-3.html'));
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SCx = globalThis.SC, R = SCx.records, S = SCx.schema, CSV = SCx.csv;
const L = require('./lib/integrity-library')(SCx);
const ID = L.ids, N = L.names;
const FT = N.titles, LI = N.issues(ID.LEDGER), LC = N.contents(ID.LEDGER), HI = N.issues(ID.HERALD), HC = N.contents(ID.HERALD);
const FOLDER = 'Test Library';
const BASE = (() => { const b = R.buildLibrary(Object.keys(L.files).map(n => R.readFile(n, L.files[n], {})), {}); return Object.fromEntries(Object.keys(L.files).map(n => [n, R.writeFile(b.state, n)])); })();
const table = text => { const p = CSV.parse(text); return { head: p.rows[0], rows: p.rows.slice(1).filter(r => r.some(v => String(v).trim())).map(r => Object.fromEntries(p.rows[0].map((h, i) => [h, r[i] === undefined ? '' : r[i]]))) }; };
const reshape = (text, fn) => { const p = CSV.parse(text); const rows = p.rows.map(r => r.slice()); fn(rows); return CSV.serialize(rows, p.style); };
const col = (rows, h) => rows[0].indexOf(h);
const rowOf = (rows, idHeader, id) => rows.find(r => r[col(rows, idHeader)] === id);
const setCells = (rows, idHeader, id, cells) => { const r = rowOf(rows, idHeader, id); Object.keys(cells).forEach(h => { r[col(rows, h)] = cells[h]; }); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const forms = v => String(v || '').split(/\s*[|;]\s*/).filter(Boolean).sort();     // a heading's forms, however they are joined
const HI_ = k => S.entities.issue.byKey.get(k).header;

// ── The test folder (as in test-data-paths.js), with one more control: ctl.slowRead (ms), which
// makes reading the folder slow, to catch the app in the middle of it.
function fakeFS(argJSON) {
  if (window.top !== window || !/^(file|https?):$/.test(location.protocol)) return;
  const { seed, folderName } = JSON.parse(argJSON);
  const dbp = new Promise((res, rej) => { const r = indexedDB.open('__sc_test_folder__', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = async k => { const d = await dbp; return new Promise(res => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); }); };
  const set = async (k, v) => { const d = await dbp; return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); };
  const load = async () => {
    let tree = await get('tree');
    if (!tree) { tree = { files: {}, dirs: {} }; Object.keys(seed).forEach(n => { tree.files[n] = { text: seed[n].text, lastModified: seed[n].lastModified }; }); await set('tree', tree); }
    return tree;
  };
  const ctl = async () => Object.assign({ permission: 'granted', deny: false, slowRead: 0 }, (await get('ctl')) || {});
  const setCtl = async p => set('ctl', Object.assign(await ctl(), p));
  const nodeAt = (tree, parts) => parts.reduce((n, p) => n.dirs[p], tree);
  let lock = Promise.resolve();
  const mutate = (parts, fn) => (lock = lock.then(async () => { const tree = await load(); fn(nodeAt(tree, parts)); await set('tree', tree); }));
  const notFound = () => { const e = new Error('A requested file or directory could not be found.'); e.name = 'NotFoundError'; return e; };
  function fileHandle(parts, name) {
    return { kind: 'file', name,
      getFile: async () => { const f = nodeAt(await load(), parts).files[name]; if (!f) throw notFound(); return { name, lastModified: f.lastModified, text: async () => f.text }; },
      createWritable: async () => { let buf = ''; return { write: async t => { buf += t; }, abort: async () => {}, close: async () => { await mutate(parts, n => { n.files[name] = { text: buf, lastModified: Date.now() }; }); } }; } };
  }
  function dirHandle(parts, name) {
    return { kind: 'directory', name,
      queryPermission: async () => (await ctl()).permission,
      requestPermission: async () => { if ((await ctl()).deny) return 'denied'; await setCtl({ permission: 'granted' }); return 'granted'; },
      values: async function* () { const c = await ctl(); if (c.slowRead && !parts.length) await new Promise(r => setTimeout(r, c.slowRead)); const n = nodeAt(await load(), parts); for (const f of Object.keys(n.files)) yield fileHandle(parts, f); for (const d of Object.keys(n.dirs)) yield dirHandle(parts.concat(d), d); },
      getFileHandle: async (f, o) => { if (!nodeAt(await load(), parts).files[f]) { if (!(o && o.create)) throw notFound(); await mutate(parts, n => { if (!n.files[f]) n.files[f] = { text: '', lastModified: Date.now() }; }); } return fileHandle(parts, f); },
      getDirectoryHandle: async (d, o) => { if (!nodeAt(await load(), parts).dirs[d]) { if (!(o && o.create)) throw notFound(); await mutate(parts, n => { if (!n.dirs[d]) n.dirs[d] = { files: {}, dirs: {} }; }); } return dirHandle(parts.concat(d), d); },
      removeEntry: async n => mutate(parts, x => { delete x.files[n]; delete x.dirs[n]; }) };
  }
  window.__SC_TEST_FS__ = { root: dirHandle([], folderName), tree: load, ctl: setCtl };
}

const log = [], errors = [];
let failures = 0, count = 0;
const step = s => log.push('· ' + s);
const expect = (cond, what, detail) => { count++; log.push((cond ? '  ok   ' : '  FAIL ') + what + (cond || detail === undefined ? '' : '\n         ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700))); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch();
  const contexts = [];
  const seedOf = files => JSON.stringify({ folderName: FOLDER, seed: Object.fromEntries(Object.keys(files).map(n => [n, typeof files[n] === 'string' ? { text: files[n], lastModified: 1000 } : files[n]])) });
  async function newPage(ctx) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('page error: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    page.dialogs = []; page.answer = true;
    page.on('dialog', d => { page.dialogs.push(d.message()); if (page.answer) d.accept(); else d.dismiss(); });
    page.setDefaultTimeout(8000);
    return page;
  }
  const ready = async page => { await page.waitForFunction(() => window.SC && SC.session && SC.session.whenReady); await page.evaluate(() => SC.session.whenReady()); await page.waitForFunction(() => SC.session.ui.access !== 'checking' && !SC.session.ui.busy); };
  async function begin(files, opts) {
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
    contexts.push(ctx);
    if (opts.clipboard) await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ctx.addInitScript(fakeFS, seedOf(files));
    const page = await newPage(ctx);
    await page.goto('file://' + app);
    await ready(page);
    if (!opts.noOpen) { await page.click('text=Open library folder'); await page.waitForFunction(() => SC.session.ui.mode === 'folder' && !SC.session.ui.busy); await page.evaluate(() => SC.session.flush()); }
    return { ctx, page };
  }
  // SC_SECTIONS=2,11 runs only those sections (for working on them; a full run runs every section).
  const only = (process.env.SC_SECTIONS || '').split(',').filter(Boolean);
  const section = async (name, fn) => {
    if (only.length && only.indexOf(name.split('.')[0]) === -1) return;
    step(name);
    try { await fn(); } catch (e) { failures++; log.push('  FAIL the section stopped: ' + String(e && e.message || e).split('\n')[0]); }
    while (contexts.length) await contexts.pop().close().catch(() => {});
  };
  const message = page => page.evaluate(() => (SC.session.ui.message || {}).text || '');
  const dirty = page => page.evaluate(() => Array.from(SC.session.store.dirty).sort());
  const hash = page => page.evaluate(() => decodeURIComponent(location.hash));
  const go = async (page, h) => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(200); };
  const rec = (page, kind, id) => page.evaluate(([k, i]) => { const r = SC.records.mapOfKind(SC.session.store.state, k).get(i); return r ? JSON.parse(JSON.stringify(r)) : null; }, [kind, id]);
  const disk = page => page.evaluate(async () => { const t = await window.__SC_TEST_FS__.tree(); return Object.fromEntries(Object.keys(t.files).map(n => [n, t.files[n].text])); });
  const topButton = async (page, label) => { const b = page.locator('.topbar button:has-text("' + label + '")'); if (await b.isDisabled()) return false; await b.click(); await page.waitForTimeout(150); return true; };
  const undoLabel = page => page.evaluate(() => SC.session.store.undoLabel);
  const save = async page => {
    await page.evaluate(() => { window.__m = SC.session.ui.message; });
    await page.click('.topbar button:has-text("Save")');
    await page.waitForFunction(() => SC.session.ui.message && SC.session.ui.message !== window.__m && !SC.session.ui.busy);
    return message(page);
  };
  const val = (page, sel) => page.inputValue(sel);
  // A field of the issue form: typed into, then left (as a person does).
  const type = async (page, sel, v) => { await page.fill(sel, v); await page.locator(sel).press('Tab'); await page.waitForTimeout(100); };
  const draftOpen = async (page, tid) => { await go(page, '#/issues/' + tid); await page.click('.panel-head button:has-text("New issue")'); await page.waitForSelector('.draft-card'); };
  const followsValue = page => page.inputValue('.advance-bar select');
  const issueIDs = (page, tid) => page.evaluate(t => SC.session.store.issuesOfTitle(t).map(i => i.issueID), tid);

  // ── 1. Moving around ───────────────────────────────────────────────
  await section('1. Moving around: the stage rail, the context bar, Previous and Next, Alt+Page Up/Down, Next issue (NAV-01, NAV-03, CON-21, LIB-16)', async () => {
    const { page } = await begin(BASE);
    const row = page.locator('table.shelf tbody tr:has-text("The Sample Herald")');
    await row.locator('a:has-text("Issues")').click(); await page.waitForTimeout(200);
    expect(await hash(page) === '#/issues/' + ID.HERALD, 'a title row\'s Issues link opens that title\'s issues', await hash(page));
    await go(page, '#/library'); await page.locator('table.shelf tbody tr:has-text("The Sample Herald") td').first().click(); await page.waitForTimeout(200);
    expect(await hash(page) === '#/library/' + ID.HERALD, 'clicking the row opens the title', await hash(page));
    await go(page, '#/issues/' + ID.HERALD + '/' + ID.H1);
    expect(await page.locator('.rail a:has-text("Contents")').getAttribute('href') === '#/contents/' + ID.HERALD + '/' + ID.H1, 'the stage rail\'s Contents link keeps the title and issue');
    await page.click('.rail a:has-text("Contents")'); await page.waitForTimeout(200);
    expect(await hash(page) === '#/contents/' + ID.HERALD + '/' + ID.H1, 'and opens that issue\'s contents');
    await page.selectOption('.context-bar label:has-text("Title") select', ID.LEDGER); await page.waitForTimeout(200);
    expect(await hash(page) === '#/contents/' + ID.LEDGER, 'the context bar\'s Title select changes the title, staying in Contents', await hash(page));
    await page.selectOption('.context-bar label:has-text("Issue") select', ID.L2); await page.waitForTimeout(200);
    expect(await hash(page) === '#/contents/' + ID.LEDGER + '/' + ID.L2, 'its Issue select opens an issue', await hash(page));
    await page.click('.context-bar button[aria-label="Next issue"]'); await page.waitForTimeout(150);
    expect(await hash(page) === '#/contents/' + ID.LEDGER + '/' + ID.L3, 'Next goes to no. 3');
    await page.click('.context-bar button[aria-label="Previous issue"]'); await page.waitForTimeout(150);
    expect(await hash(page) === '#/contents/' + ID.LEDGER + '/' + ID.L2, 'Previous back to no. 2');
    await go(page, '#/contents/' + ID.LEDGER + '/' + ID.L1);
    expect(await page.locator('.context-bar button[aria-label="Previous issue"]').isDisabled() && !(await page.locator('.context-bar button[aria-label="Next issue"]').isDisabled()), 'at the first issue Previous is off, Next on');
    const nextLink = page.locator('.next-issue a');
    expect(/Next issue: Specimen Ledger No\. 2 →/.test(await nextLink.innerText()) && /4 items recorded/.test(await page.locator('.next-issue .hint').innerText()), 'Contents shows "Next issue: Specimen Ledger No. 2 →" and how many items it has');
    await nextLink.click(); await page.waitForTimeout(200);
    expect(await hash(page) === '#/contents/' + ID.LEDGER + '/' + ID.L2, 'the Next issue link opens it');
    await page.keyboard.press('Alt+PageDown'); await page.waitForTimeout(200);
    expect(await hash(page) === '#/contents/' + ID.LEDGER + '/' + ID.L3, 'Alt+Page Down in Contents: the next issue');
    await page.keyboard.press('Alt+PageUp'); await page.waitForTimeout(200);
    expect(await hash(page) === '#/contents/' + ID.LEDGER + '/' + ID.L2, 'Alt+Page Up: the previous one');
    await go(page, '#/issues/' + ID.LEDGER + '/' + ID.L2);
    await page.fill('#f-notes', 'Typed, then moved on with the keys.');
    await page.keyboard.press('Alt+PageDown'); await page.waitForTimeout(250);
    expect(await hash(page) === '#/issues/' + ID.LEDGER + '/' + ID.L3 && (await rec(page, 'issue', ID.L2)).notes === 'Typed, then moved on with the keys.', 'Alt+Page Down in Issues, from a field being typed in: what was typed is kept, and the next issue opens');
    await go(page, '#/issues/' + ID.LEDGER + '/' + ID.L4);
    await page.keyboard.press('Alt+PageDown'); await page.waitForTimeout(200);
    expect(await hash(page) === '#/issues/' + ID.LEDGER + '/' + ID.L4, 'at the last issue Alt+Page Down stays');
  });

  // ── 2. Follows, Start over, a draft kept ─────────────────────────────
  await section('2. A new issue: Follows, Start over, the draft kept per title, "Keep it" and "Start again after …" (ISS-09, ISS-16)', async () => {
    const { page } = await begin(BASE);
    await draftOpen(page, ID.LEDGER);
    expect(await followsValue(page) === ID.L4 && await val(page, '#f-number') === '5', 'New issue follows the last issue, no. 4: its Whole no. is 5');
    page.dialogs.length = 0;
    await page.selectOption('.advance-bar select', ID.L1); await page.waitForTimeout(200);
    expect(page.dialogs.length === 0 && await followsValue(page) === ID.L1 && await val(page, '#f-number') === '2' && /after Specimen Ledger No\. 1/.test(await page.locator('.draft-tag').textContent()),
      'Follows changed on an untouched draft: nothing asked; it now follows no. 1 and is no. 2', [page.dialogs, await followsValue(page), await val(page, '#f-number'), await page.locator('.draft-tag').textContent()]);
    await type(page, '#f-notes', 'Entered by hand.');
    page.answer = false;
    await page.selectOption('.advance-bar select', ID.L2); await page.waitForTimeout(200);
    page.answer = true;
    expect(page.dialogs[0] === 'Start the new issue again, following another issue? What you have entered in it will be cleared.' && await followsValue(page) === ID.L1 && await val(page, '#f-notes') === 'Entered by hand.',
      'Follows changed on a touched draft: "Start the new issue again, following another issue? …"; declined, nothing changes', [page.dialogs, await followsValue(page), await val(page, '#f-notes'), await page.locator('.draft-tag').textContent()]);
    await page.selectOption('.advance-bar select', ID.L2); await page.waitForTimeout(200);
    expect(await followsValue(page) === ID.L2 && await val(page, '#f-number') === '3' && await val(page, '#f-notes') === '', 'agreed: it follows no. 2 and what was entered is cleared');
    await type(page, '#f-notes', 'Kept across stages.');
    await go(page, '#/library'); await go(page, '#/issues/' + ID.LEDGER + '/new');
    expect(await val(page, '#f-notes') === 'Kept across stages.' && await followsValue(page) === ID.L2, 'the draft is kept when moving to another stage and back');
    await go(page, '#/issues/' + ID.HERALD + '/new'); await page.waitForSelector('.draft-card');
    expect(await val(page, '#f-notes') === '' && await followsValue(page) === ID.H2, 'another title has its own draft');
    await go(page, '#/issues/' + ID.LEDGER + '/' + ID.L3);
    await page.click('.sticky-actions button:has-text("New issue after this")'); await page.waitForSelector('.draft-card');
    const offer = page.locator('.message.warn:has-text("The new issue you started earlier is kept below, not yet recorded.")');
    expect(await offer.count() === 1 && await offer.locator('button:has-text("Keep it")').count() === 1 && await offer.locator('button:has-text("Start again after Specimen Ledger No. 3")').count() === 1,
      'New issue after no. 3 with a touched draft open: "The new issue you started earlier is kept below, not yet recorded.", with Keep it and Start again after Specimen Ledger No. 3');
    await offer.locator('button:has-text("Keep it")').click(); await page.waitForTimeout(150);
    expect(await offer.count() === 0 && await val(page, '#f-notes') === 'Kept across stages.' && await followsValue(page) === ID.L2, 'Keep it: the draft stays as it was, following no. 2');
    await go(page, '#/issues/' + ID.LEDGER + '/' + ID.L3);
    await page.click('.sticky-actions button:has-text("New issue after this")'); await page.waitForSelector('.draft-card');
    page.dialogs.length = 0;
    await page.click('.message.warn button:has-text("Start again after")'); await page.waitForTimeout(200);
    expect(page.dialogs.length === 0 && await followsValue(page) === ID.L3 && await val(page, '#f-notes') === '' && await val(page, '#f-number') === '4', 'Start again after no. 3: a fresh draft following no. 3, without a second question');
    await type(page, '#f-notes', 'To be started over.');
    page.answer = false; page.dialogs.length = 0;
    await page.click('.sticky-actions button:has-text("Start over")'); await page.waitForTimeout(150);
    page.answer = true;
    expect(page.dialogs.length === 1 && await val(page, '#f-notes') === 'To be started over.', 'Start over on a touched draft asks the same question; declined, the draft is kept');
    await page.click('.sticky-actions button:has-text("Start over")'); await page.waitForTimeout(150);
    expect(await val(page, '#f-notes') === '' && await followsValue(page) === ID.L3, 'agreed: a fresh draft following the same issue');
    expect((await dirty(page)).length === 0 && (await issueIDs(page, ID.LEDGER)).length === 4, 'none of this records anything or marks a file changed');
  });

  // ── 3. How the numbers move on ──────────────────────────────────────
  await section('3. How the numbers move on: the Moves on boxes, the date step, settings remembered per title (ISS-08)', async () => {
    const { page } = await begin(BASE);
    await draftOpen(page, ID.LEDGER);
    const year0 = await val(page, '#f-year');
    expect(await val(page, '#f-number') === '5' && year0 === '1877', 'after no. 4 (1876), whose run moves on by a year: Whole no. 5, year 1877', year0);
    const box = page.locator('.advance-bar label:has-text("Whole no.") input');
    await box.uncheck(); await page.waitForTimeout(150);
    expect(await val(page, '#f-number') === '4', 'Whole no. unticked: the number stays at 4');
    await box.check(); await page.waitForTimeout(150);
    expect(await val(page, '#f-number') === '5', 'ticked again: 5');
    await page.selectOption('.advance-bar label:has-text("Date") select', 'none'); await page.waitForTimeout(150);
    expect(await val(page, '#f-year') === '1876', 'Date "not at all": the year stays at 1876');
    await page.selectOption('.advance-bar label:has-text("Date") select', 'y1'); await page.waitForTimeout(150);
    expect(await val(page, '#f-year') === '1877', 'Date "one year": 1877');
    await box.uncheck(); await page.selectOption('.advance-bar label:has-text("Date") select', 'none'); await page.waitForTimeout(150);
    const stored = await page.evaluate(id => JSON.parse(localStorage.getItem('sc3.advance.' + id) || 'null'), ID.LEDGER);
    expect(stored && stored.number === false && stored.date === 'none', 'the settings are kept for this title in this browser', stored);
    page.dialogs.length = 0;
    await page.reload(); await ready(page);
    expect(page.dialogs.length === 0, 'a draft changed only in its settings: reloading asks nothing');
    await draftOpen(page, ID.LEDGER);
    expect(!(await box.isChecked()) && await page.inputValue('.advance-bar label:has-text("Date") select') === 'none' && await val(page, '#f-number') === '4' && await val(page, '#f-year') === '1876',
      'after a reload, a new draft uses them: Whole no. unticked, Date not at all');
    await draftOpen(page, ID.HERALD);
    expect(await box.isChecked() && await page.inputValue('.advance-bar label:has-text("Date") select') === 'auto', 'another title keeps the defaults');
  });

  // ── 4. Months and seasons ───────────────────────────────────────────
  await section('4. Months and seasons by click; Set end year (ISS-10)', async () => {
    const herald = reshape(BASE[HI], rows => { setCells(rows, 'IssueID', ID.H1, { [HI_('months')]: 'Oct' }); setCells(rows, 'IssueID', ID.H2, { [HI_('months')]: 'Nov' }); });
    const { page } = await begin(Object.assign({}, BASE, { [HI]: herald }));
    await draftOpen(page, ID.HERALD);
    const pressed = () => page.$$eval('.months-pick button[aria-pressed="true"]', b => b.map(x => x.textContent.trim()));
    expect(await val(page, '#f-months') === 'Dec' && same(await pressed(), ['Dec']), 'after Oct and Nov, the draft is Dec, and Dec is shown pressed', await val(page, '#f-months'));
    await page.click('.months-pick button:has-text("Jan")'); await page.waitForTimeout(150);
    expect(same(await pressed(), ['Jan', 'Dec']) && /Dec.{1,3}Jan/.test(await val(page, '#f-months')), 'Jan clicked too: two months, written as a run across the turn of the year', await val(page, '#f-months'));
    const setEnd = page.locator('button:has-text("Set end year to 1881")');
    expect(await setEnd.count() === 1 && /Runs into the next year\./.test(await page.locator('.field:has(#f-months)').innerText()), 'it says "Runs into the next year." and offers "Set end year to 1881"');
    await setEnd.click(); await page.waitForTimeout(150);
    expect(await val(page, '#f-yearEnd') === '1881' && await setEnd.count() === 0, 'clicked: End Year 1881, and the offer goes');
    await page.click('.months-pick button:has-text("Dec")'); await page.waitForTimeout(150);
    expect(same(await pressed(), ['Jan']) && await val(page, '#f-months') === 'Jan', 'Dec clicked again: only Jan');
    await page.selectOption('#f-dateType', 'Season'); await page.waitForTimeout(150);
    const names = await page.$$eval('.months-pick button', b => b.map(x => x.textContent.trim()));
    expect(same(names, ['Spring', 'Summer', 'Fall', 'Winter']), 'Date Type Season: the picker shows the seasons', names);
    await page.click('.months-pick button:has-text("Summer")'); await page.waitForTimeout(150);
    expect(await val(page, '#f-months') === 'Summer' && same(await pressed(), ['Summer']), 'Summer clicked: Month(s) is "Summer"', await val(page, '#f-months'));
  });

  // ── 5. "Make it vol. …" ─────────────────────────────────────────────
  await section('5. The suggestion "Make it vol. …" when a volume may have ended (ISS-11)', async () => {
    const vols = reshape(BASE[LI], rows => [[ID.L1, '1', '1'], [ID.L2, '1', '2'], [ID.L3, '2', '1'], [ID.L4, '2', '2']].forEach(([id, v, n]) => setCells(rows, 'IssueID', id, { [HI_('volume')]: v, [HI_('issue')]: n })));
    const { page } = await begin(Object.assign({}, BASE, { [LI]: vols }));
    await draftOpen(page, ID.LEDGER);
    const hint = page.locator('.hint-line');
    expect(await val(page, '#f-volume') === '2' && await val(page, '#f-issue') === '3' && /Volume 1 ended with no\. 2, so this may be the first issue of a new volume\./.test(await hint.innerText()),
      'after vol. 2 no. 2 the draft is vol. 2 no. 3, and since vol. 1 ended with no. 2: "Volume 1 ended with no. 2, so this may be the first issue of a new volume."');
    await hint.locator('button:has-text("Make it vol. 3, no. 1")').click(); await page.waitForTimeout(150);
    expect(await val(page, '#f-volume') === '3' && await val(page, '#f-issue') === '1' && await hint.count() === 0, '"Make it vol. 3, no. 1": the draft becomes vol. 3 no. 1, and the hint goes');
  });

  // ── 6. A title missing from the Titles file ─────────────────────────
  await section('6. A title missing from the Titles file: its issues read only, the warnings (ISS-19, LIB-08)', async () => {
    const titles = reshape(BASE[FT], rows => { const k = rows.indexOf(rowOf(rows, 'TitleID', ID.MODEL)); rows.splice(k, 1); });
    const { page } = await begin(Object.assign({}, BASE, { [FT]: titles }));
    expect(/1 issue belongs to a title missing from the Titles file\./.test(await page.locator('p.summary').innerText()), 'the Library page: "1 issue belongs to a title missing from the Titles file."', await page.locator('p.summary').innerText());
    const opts = await page.evaluate(() => { location.hash = '#/issues'; return null; }).then(() => page.waitForTimeout(200)).then(() => page.$$eval('.context-bar label:has-text("Title") option', o => o.map(x => x.textContent)));
    expect(opts.indexOf(ID.MODEL + ' (not in Titles file)') !== -1, 'the context bar offers it as "MODELWKX-1901 (not in Titles file)"', opts);
    await go(page, '#/issues/' + ID.MODEL);
    expect(/This title is not in the Titles file, so its issues can be read here but not changed\./.test(await page.locator('.phase-note').innerText()) && await page.locator('.panel-head button:has-text("New issue"), .panel-head button:has-text("Record the first issue")').count() === 0,
      'its Issues page says it can be read but not changed, and offers no New issue');
    await go(page, '#/issues/' + ID.MODEL + '/' + ID.M1);
    expect(/Add the title in Library to edit them\./.test(await page.locator('.phase-note').innerText()) && await page.locator('#f-number').isDisabled() && await page.locator('#f-notes').isDisabled(), 'its issue page: the fields cannot be typed in, and it says to add the title in Library');
    expect(await page.locator('.sticky-actions button:has-text("New issue after this")').count() === 0 && await page.locator('.sticky-actions button:has-text("Delete issue")').count() === 0 && await page.locator('.field:has(#f-number) .toggles').count() === 0,
      'no New issue after this, no Delete issue, no ? or N/A');
    expect((await dirty(page)).length === 0, 'nothing is marked changed');
  });

  // ── 7. Contents cells ───────────────────────────────────────────────
  await section('7. Contents cells: ? and N/A, Escape, Insert below, one row pasted into an item (CON-12, CON-13, CON-10, CON-05)', async () => {
    const { page } = await begin(BASE);
    await go(page, '#/contents/' + ID.LEDGER + '/' + ID.L1);
    await page.waitForSelector('table.grid-toc tbody tr[data-item]');
    const cell = (id, c) => page.locator('[data-cell="' + id + ':' + c + '"]');
    const AUTH = S.entities.content.byKey.get('author').header;
    await cell(ID.L1a, 'author').click();
    await page.click('.grid-tools button.tog-btn.spec'); await page.waitForTimeout(150);
    let c = await rec(page, 'content', ID.L1a);
    expect(c.spec.indexOf(AUTH) !== -1 && c.author === 'J. Q. Public' && /is-spec/.test(await cell(ID.L1a, 'author').getAttribute('class')), 'the toolbar\'s ? on Author: marked uncertain, the value kept, the cell shown so');
    await cell(ID.L1a, 'author').click(); await page.keyboard.press('Alt+Shift+KeyS'); await page.waitForTimeout(200);
    c = await rec(page, 'content', ID.L1a);
    expect(c.spec.indexOf(AUTH) === -1, 'Alt+Shift+S: ? off again');
    await cell(ID.L1b, 'author').click(); await page.keyboard.press('Alt+Shift+KeyN'); await page.waitForTimeout(200);
    c = await rec(page, 'content', ID.L1b);
    expect(c.na.indexOf(AUTH) !== -1 && c.author === '' && await undoLabel(page) === 'Mark N/A on author / credit', 'Alt+Shift+N on Richard Roe\'s credit: N/A, the value cleared, one undo step', await undoLabel(page));
    await topButton(page, 'Undo');
    c = await rec(page, 'content', ID.L1b);
    expect(c.na.indexOf(AUTH) === -1 && c.author === 'Richard Roe', 'Undo: the credit back');
    await topButton(page, 'Undo'); await topButton(page, 'Undo');
    expect((await dirty(page)).length === 0, 'everything undone: nothing marked changed');
    await cell(ID.L1a, 'itemTitle').click(); await page.keyboard.press('End'); await page.keyboard.type(' (draft)');
    expect(await cell(ID.L1a, 'itemTitle').getAttribute('data-pending') === 'true', 'typing in a cell: the cell holds typing not yet kept');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    expect(await cell(ID.L1a, 'itemTitle').inputValue() === 'Opening Remarks' && (await rec(page, 'content', ID.L1a)).itemTitle === 'Opening Remarks' && (await dirty(page)).length === 0, 'Escape: the typing is undone; the item and the files unchanged');
    await cell(ID.L1a, 'itemTitle').click();
    await page.click('.grid-tools button:has-text("Insert below")'); await page.waitForTimeout(200);
    const order = () => page.evaluate(i => SC.session.store.contentsOfIssue(i).map(x => x.itemTitle), ID.L1);
    const rows = () => page.$$eval('table.grid-toc tbody tr', t => t.map(r => (r.querySelector('[data-cell$=":itemTitle"]') || {}).value));
    expect(same(await rows(), ['Opening Remarks', '', 'Town Notes', '']), 'Insert below: an empty row opens right after the item', await rows());
    await page.keyboard.type('An Inserted Note'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    expect(same(await order(), ['Opening Remarks', 'An Inserted Note', 'Town Notes']), 'typing in it makes the item there: sequence 2, and Town Notes moves to 3');
    await cell(ID.L1b, 'itemTitle').click(); await page.keyboard.press('Control+Enter'); await page.waitForTimeout(200);
    expect((await rows()).length === 5, 'Ctrl+Enter opens an empty row below Town Notes');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    expect((await rows()).length === 4 && same(await order(), ['Opening Remarks', 'An Inserted Note', 'Town Notes']), 'Escape closes it, and nothing is added');
    await cell(ID.L1b, 'itemTitle').click();
    await page.evaluate(sel => { const el = document.querySelector(sel); const dt = new DataTransfer(); dt.setData('text/plain', 'Town Notes, Revised\tR. R.\tnotice\t5\t6'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, '[data-cell="' + ID.L1b + ':itemTitle"]');
    await page.waitForTimeout(200);
    c = await rec(page, 'content', ID.L1b);
    expect(c.itemTitle === 'Town Notes, Revised' && c.author === 'R. R.' && c.contentType === 'notice' && c.startPage === '5' && c.endPage === '6' && await undoLabel(page) === 'Paste into Town Notes',
      'one row of cells pasted into Town Notes: its title, credit, type and pages filled from the columns, in one undo step "Paste into Town Notes"', [c.itemTitle, c.author, c.contentType, c.startPage, c.endPage, await undoLabel(page)]);
    expect(same(await order(), ['Opening Remarks', 'An Inserted Note', 'Town Notes, Revised']), 'no item is added by it');
  });

  // ── 8. A new library ────────────────────────────────────────────────
  await section('8. Starting a new library: the form, the slug rule, Cancel, and a library without a folder (LIB-04, LIB-06, WF-08)', async () => {
    const { page } = await begin({}, { noOpen: true });
    await page.click('text=Start a new library');
    await page.fill('#nl-name', 'Third Invented Library');
    expect(await val(page, '#nl-slug') === 'THIRD-INVENTED-LIBRARY', 'the slug follows the name: THIRD-INVENTED-LIBRARY');
    await page.fill('#nl-slug', 'third--library');
    expect(await val(page, '#nl-slug') === 'THIRD--LIBRARY' && /Use A–Z, 0–9 and single hyphens\./.test(await page.locator('.field:has(#nl-slug)').innerText()) && await page.locator('button:has-text("Start without a folder")').isDisabled() && await page.locator('button:has-text("Choose an empty folder for it")').isDisabled(),
      'typed in small letters it is made capitals; with two hyphens: "Use A–Z, 0–9 and single hyphens.", and both buttons are off');
    await page.click('.card button:has-text("Cancel")'); await page.waitForTimeout(150);
    expect(await page.locator('#nl-name').count() === 0 && await page.locator('button:has-text("Open library folder")').count() === 1 && await page.evaluate(() => SC.session.ui.mode) === 'none', 'Cancel: back to the welcome page, no library');
    await page.click('text=Start a new library');
    await page.fill('#nl-name', 'Third Invented Library'); await page.fill('#nl-note', 'Without a folder.');
    await page.click('button:has-text("Start without a folder")'); await page.waitForTimeout(250);
    expect(await page.evaluate(() => SC.session.ui.mode) === 'files' && await hash(page) === '#/library/new', 'Start without a folder: a library in this browser only (files mode), and the new-title page opens');
    await page.fill('#f-canonicalTitle', 'The Third Gazette'); await page.locator('#f-canonicalTitle').press('Tab');
    await page.fill('#f-firstYear', '1901'); await page.locator('#f-firstYear').press('Tab');
    await page.click('.sticky-actions button:has-text("Add title")'); await page.waitForTimeout(200);
    const T = 'SCAT_THIRD-INVENTED-LIBRARY_TITLES.csv';
    const btn = page.locator('.topbar button:has-text("Download changed files")');
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), btn.click()]);
    const text = d ? fs.readFileSync(await d.path(), 'utf8') : '';
    const r = text ? table(text).rows : [];
    expect(!!d && d.suggestedFilename() === T && r.length === 1 && r[0]['Canonical Title'] === 'The Third Gazette' && r[0]['Title Library Name'] === 'Third Invented Library' && r[0]['Title Library Note'] === 'Without a folder.',
      'the first save downloads ' + T + ', holding the title and the library\'s name and note', d && d.suggestedFilename());
    expect(Object.keys(await disk(page)).length === 0, 'and nothing is written into any folder');
  });

  // ── 9. Dropped files; a folder of Beta 2 files ──────────────────────
  await section('9. CSV files dropped on the welcome page; a folder of Beta 2 files only (LIB-03, LIB-07)', async () => {
    let { page } = await begin({}, { noOpen: true });
    await page.evaluate(files => {
      const dt = new DataTransfer();
      Object.keys(files).forEach(n => dt.items.add(new File([files[n]], n, { type: 'text/csv', lastModified: 1000 })));
      const el = document.querySelector('section.welcome');
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, BASE);
    await page.waitForFunction(() => SC.session.ui.mode === 'files' && !SC.session.ui.busy);
    expect(await page.evaluate(() => { const s = SC.session.store.state; return [s.titles.size, s.issues.size, s.contents.size, s.authorities.size].join('/'); }) === '4/7/13/3', 'the library\'s files dropped on the welcome page are loaded (files mode): 4 titles, 7 issues, 13 items, 3 headings');
    const B2 = path.join(ROOT, 'sample-data', 'beta2', 'example-library');
    const beta = Object.fromEntries(fs.readdirSync(B2).map(n => [n, fs.readFileSync(path.join(B2, n), 'utf8')]));
    const n = R.buildLibrary(Object.keys(beta).map(x => R.readFile(x, beta[x], { allowEmpty: true })), {}).needsConversion.length;
    ({ page } = await begin(beta, { noOpen: true }));
    await page.click('text=Open library folder'); await page.waitForTimeout(400);
    const msg = await message(page);
    expect(msg === 'These ' + n + ' files are in the Beta 2 format, which this version does not open. They have not been changed. Convert them to 3.0 once (see the Guide), then open the converted files here.' && await page.evaluate(() => SC.session.ui.mode) === 'none',
      'a folder of Beta 2 files only: "These ' + n + ' files are in the Beta 2 format, which this version does not open. …", and no library is open', msg);
    expect(same(await disk(page), beta), 'the folder is byte for byte what it was');
  });

  // ── 10. Adding a title ──────────────────────────────────────────────
  await section('10. Adding a title: the code suggested, the code and year checked (LIB-23)', async () => {
    const { page } = await begin(BASE);
    await go(page, '#/library/new');
    await page.fill('#f-canonicalTitle', 'The Fourth Estate'); await page.locator('#f-canonicalTitle').press('Tab'); await page.waitForTimeout(100);
    const code = await val(page, '#f-titleCode');
    expect(/^[A-Z0-9]{8}$/.test(code) && /Suggested from the title\./.test(await page.locator('.field:has(#f-titleCode)').innerText()), 'a code is suggested from the title (' + code + '), and says so');
    const add = page.locator('.sticky-actions button:has-text("Add title")');
    expect(await add.isDisabled() && /Needs a canonical title, an eight-character title code and a first year\./.test(await page.locator('.sticky-actions').innerText()), 'with no year yet, Add title is off and says what is needed');
    await type(page, '#f-titleCode', 'abc');
    expect(/Eight characters, A–Z and 0–9\./.test(await page.locator('.field:has(#f-titleCode)').innerText()) && await add.isDisabled(), 'a code of three letters: "Eight characters, A–Z and 0–9."');
    await type(page, '#f-titleCode', 'SPECLEDX');
    expect(/Another title already uses this code\./.test(await page.locator('.field:has(#f-titleCode)').innerText()), 'the Ledger\'s code: "Another title already uses this code."');
    await type(page, '#f-titleCode', 'FOURESTX');
    await type(page, '#f-firstYear', '18X5');
    expect(/YYYY, or X for unknown digits: 189X, 18XX, XXXX\./.test(await page.locator('.field:has(#f-firstYear)').innerText()) && await add.isDisabled(), 'a year of "18X5": "YYYY, or X for unknown digits: 189X, 18XX, XXXX."');
    await type(page, '#f-firstYear', '189X');
    expect(!(await add.isDisabled()) && /FOURESTX-189X/.test(await page.locator('.entry-id').innerText()), 'a good code and year 189X: Add title is on, and the entry shows the TitleID FOURESTX-189X');
    await add.click(); await page.waitForTimeout(200);
    const t = await rec(page, 'title', 'FOURESTX-189X');
    expect(t && t.canonicalTitle === 'The Fourth Estate' && t._src === FT && await hash(page) === '#/library/FOURESTX-189X' && same(await dirty(page), [FT]), 'added: the title is in the Titles file, its page opens, and only the Titles file is changed');
  });

  // ── 11. Names ───────────────────────────────────────────────────────
  await section('11. Names: filters, Find, Possibly the same, Find another form, Remove, Add to a heading, Suggested matches, a form under two headings (NAM-01, -03, -05, -06, -08, -09, -11, WF-03)', async () => {
    const AUTH = S.entities.content.byKey.get('author').header;
    const lc = reshape(BASE[LC], rows => { setCells(rows, 'ContentID', ID.L3a, { [AUTH]: 'R. Roe' }); setCells(rows, 'ContentID', ID.L2d, { [AUTH]: 'Roe' }); });
    const hc = reshape(BASE[HC], rows => setCells(rows, 'ContentID', ID.H2a, { [AUTH]: 'Anne N. Other' }));
    const mc = reshape(BASE[N.contents(ID.MODEL)], rows => setCells(rows, 'ContentID', ID.M1b, { [AUTH]: 'A. Other' }));
    const { page } = await begin(Object.assign({}, BASE, { [LC]: lc, [HC]: hc, [N.contents(ID.MODEL)]: mc }));
    await go(page, '#/names');
    const seg = async () => Object.fromEntries((await page.$$eval('.names .seg .seg-btn', b => b.map(x => x.textContent.trim()))).map(t => { const m = /^(.*?) (\d+)$/.exec(t); return [m[1], +m[2]]; }));
    const counts = await seg();
    expect(counts.All === 8 && counts.Headings === 3 && counts['No heading'] === 5 && counts['Needs review'] === 0 && counts['Suggested matches'] === 1, 'the filters count: All 8, Headings 3, No heading 5, Needs review 0, Suggested matches 1', counts);
    const listed = () => page.$$eval('.nm-list .nm-label', l => l.map(x => x.textContent));
    await page.click('.names .seg-btn:has-text("No heading")');
    expect(same((await listed()).slice().sort(), ['A. N. Other', 'A. Other', 'Anne N. Other', 'R. Roe', 'Roe'].sort()), 'No heading lists the five names without one', await listed());
    await page.click('.names .seg-btn:has-text("All")');
    await page.fill('input[aria-label="Find a name"]', 'roe');
    expect(same((await listed()).slice().sort(), ['R. Roe', 'Roe', 'Roe, Richard'].sort()), 'Find a name "roe": the heading and the two names with that surname', await listed());
    await page.fill('input[aria-label="Find a name"]', '');
    // Possibly the same: Add, then Add all.
    await go(page, '#/names/' + ID.ROE);
    const maybe = page.locator('.nm-maybe');
    expect(same((await maybe.locator('.nm-form').allInnerTexts()).sort(), ['R. Roe', 'Roe']) && await maybe.locator('button:has-text("Add all 2")').count() === 1, 'Roe, Richard: "Possibly the same name" lists R. Roe and Roe, with Add all 2');
    await maybe.locator('button:has-text("Add all 2")').click(); await page.waitForTimeout(200);
    let a = await rec(page, 'authority', ID.ROE);
    expect(same(forms(a.variants), ['R. Roe', 'Richard Roe', 'Roe']) && await undoLabel(page) === 'Add 2 forms to Roe, Richard', 'Add all: both forms are added to the heading in one step', a.variants);
    await topButton(page, 'Undo');
    await maybe.locator('li:has-text("R. Roe") button:has-text("Add")').click(); await page.waitForTimeout(200);
    a = await rec(page, 'authority', ID.ROE);
    expect(same(forms(a.variants), ['R. Roe', 'Richard Roe']), 'Add on R. Roe alone: that form only', a.variants);
    // Find another form, then Remove it.
    await page.fill('input[aria-label="Find a form to add"]', 'anne');
    await page.locator('.nm-find li:has-text("Anne N. Other") button:has-text("Add")').click(); await page.waitForTimeout(200);
    a = await rec(page, 'authority', ID.ROE);
    expect(a.variants.indexOf('Anne N. Other') !== -1 && await page.inputValue('input[aria-label="Find a form to add"]') === '', 'Find another form "anne": Anne N. Other added, and the search cleared');
    await page.locator('.nm-forms li:has-text("Anne N. Other") button:has-text("Remove")').click(); await page.waitForTimeout(200);
    a = await rec(page, 'authority', ID.ROE);
    expect(a.variants.indexOf('Anne N. Other') === -1 && await undoLabel(page) === 'Remove Anne N. Other from Roe, Richard', 'Remove: it is taken out again ("Remove Anne N. Other from Roe, Richard")');
    // Add to a heading, from a name without one.
    await go(page, '#/names/' + encodeURIComponent('k:another'));
    await page.fill('input[aria-label="Find a heading"]', 'doe');
    await page.locator('.nm-addto li:has-text("Doe, Jane") button:has-text("Add here")').click(); await page.waitForTimeout(250);
    a = await rec(page, 'authority', ID.DOE);
    expect(a.variants.indexOf('A. N. Other') !== -1 && await hash(page) === '#/names/' + ID.DOE, 'A. N. Other: Find a heading "doe", Add here: the form is added to Doe, Jane, whose heading opens');
    await topButton(page, 'Undo');
    // Suggested matches.
    await go(page, '#/names');
    await page.click('.names .seg-btn:has-text("Suggested matches")');
    const groups = page.locator('.nm-detail .nm-group');
    expect(await groups.count() === 1 && /Other, Anne N\./.test(await groups.first().innerText()), 'Suggested matches: one group, "Other, Anne N."');
    await groups.first().locator('button:has-text("Not the same")').click(); await page.waitForTimeout(150);
    expect(await groups.count() === 0 && /No suggested matches\./.test(await page.locator('.nm-detail').innerText()), 'Not the same: the group is set aside, "No suggested matches."');
    await page.click('.names .seg-btn:has-text("All")'); await page.click('.names .seg-btn:has-text("Suggested matches")');
    expect(await groups.count() === 1, 'shown again after leaving the view (Not the same is not stored)');
    const before = await page.evaluate(() => SC.session.store.state.authorities.size);
    await groups.first().locator('button:has-text("Combine")').click(); await page.waitForTimeout(250);
    const made = await page.evaluate(() => Array.from(SC.session.store.state.authorities.values()).find(x => x.name === 'Other, Anne N.') || null);
    expect(made && same(forms(made.variants), ['A. N. Other', 'A. Other', 'Anne N. Other']) && await page.evaluate(() => SC.session.store.state.authorities.size) === before + 1 && await undoLabel(page) === 'Combine 3 forms as Other, Anne N.',
      'Combine: one new heading, "Other, Anne N.", listing the three forms, in one undo step', made);
    const credits = await page.evaluate(ids => ids.map(i => SC.session.store.state.contents.get(i).author), [ID.L3b, ID.H2a, ID.M1b]);
    expect(same(credits, ['A. N. Other', 'Anne N. Other', 'A. Other']), 'the contents keep each credit as printed');
    // A form under two headings.
    await page.click('.names .seg-btn:has-text("All")');
    await go(page, '#/names/' + ID.DOE);
    // Find another form offers names without a heading only, so a form already filed under Public, John Q.
    // can reach Doe, Jane only through the list of forms as text (More), as it can in the file.
    expect(await page.fill('input[aria-label="Find a form to add"]', 'j q public').then(() => page.locator('.nm-find li').count()) === 0, 'Find another form does not offer a form already under another heading (J. Q. Public)');
    await page.fill('input[aria-label="Find a form to add"]', '');
    await page.click('.nm-detail details summary:has-text("More")');
    await page.fill('#f-a-variants', 'Jane Doe | J. Q. Public'); await page.locator('#f-a-variants').press('Tab'); await page.waitForTimeout(250);
    const warn = await page.locator('.names .message.warn').innerText().catch(() => '');
    expect(/^1 form is listed under two headings, and files under the first: (Public, John Q\. and Doe, Jane|Doe, Jane and Public, John Q\.)\.$/.test(warn.trim()), 'J. Q. Public typed into Doe, Jane\'s list of forms too: "1 form is listed under two headings, and files under the first: …"', warn);
    await save(page);
    const d = await disk(page);
    const heads = table(d[N.authorities]).rows.map(r => r[S.entities.authority.byKey.get('name').header]).sort();
    expect(same(heads, ['Doe, Jane', 'Other, Anne N.', 'Public, John Q.', 'Roe, Richard']) && d[LC] === lc && d[HC] === hc, 'saved: four headings in the Authorities file; the Contents files untouched');
  });

  // ── 12. The Compiler ────────────────────────────────────────────────
  await section('12. The Compiler: titles chosen and remembered, its notes, Copy and Open (CMP-01, CMP-10, CMP-12)', async () => {
    const titles = reshape(BASE[FT], rows => { const k = rows.indexOf(rowOf(rows, 'TitleID', ID.MODEL)); rows.splice(k, 1); });
    const noL3 = reshape(BASE[LI], rows => { const k = rows.indexOf(rowOf(rows, 'IssueID', ID.L3)); rows.splice(k, 1); });
    const repeat = reshape(BASE[HI], rows => { const r = rowOf(rows, 'IssueID', ID.H1).slice(); rows.push(r); });
    const { page } = await begin(Object.assign({}, BASE, { [FT]: titles, [LI]: noL3, [HI]: repeat }), { clipboard: true });
    await go(page, '#/compiler');
    expect(/0 of 4/.test(await page.locator('.cmp-sel').innerText()) && /Choose one or more titles to compile\./.test(await page.locator('.cmp-preview').innerText()), 'opened with no title: "0 of 4" (the three titles and the one missing from the Titles file), "Choose one or more titles to compile."');
    const tools = page.locator('.cmp-block').first().locator('.cmp-tools');
    await tools.locator('button:has-text("All")').click(); await page.waitForTimeout(150);
    expect(/4 of 4/.test(await page.locator('.cmp-sel').innerText()), 'All: 4 of 4');
    const notes = () => page.$$eval('.cmp-notes li', l => l.map(x => x.textContent));
    const n = await notes();
    expect(n.indexOf(ID.MODEL + ' is not in the Titles file, so its issues are compiled without title-level values.') !== -1, 'note: "MODELWKX-1901 is not in the Titles file, so its issues are compiled without title-level values."', n);
    expect(n.indexOf('2 contents items belong to issues not in any Issues file and are left out.') !== -1, 'note: "2 contents items belong to issues not in any Issues file and are left out."', n);
    expect(n.indexOf('1 row that could not be taken in (see the Library page) is not in outputs.') !== -1, 'note: "1 row that could not be taken in (see the Library page) is not in outputs."', n);
    await tools.locator('button:has-text("None")').click(); await page.waitForTimeout(150);
    expect(/0 of 4/.test(await page.locator('.cmp-sel').innerText()), 'None: 0 of 4');
    await page.locator('.cmp-title:has-text("The Sample Herald") input').check();
    await page.locator('.cmp-title:has-text("The Trial Quarterly") input').check();
    await page.locator('.cmp-output:has-text("Checklist") input').check(); await page.waitForTimeout(200);
    expect(/2 of 4/.test(await page.locator('.cmp-sel').innerText()), 'two titles ticked: 2 of 4');
    await page.reload(); await ready(page); await go(page, '#/compiler');
    const on = await page.$$eval('.cmp-title.on .ct-name', l => l.map(x => x.textContent.trim()));
    expect(same(on.sort(), ['The Sample Herald', 'The Trial Quarterly']) && await page.locator('.cmp-output:has-text("Checklist") input').isChecked(), 'after a reload the same two titles and the Checklist are chosen (kept in this browser)', on);
    // Copy: the whole output, as Download would write it.
    await page.locator('.cmp-actions button:has-text("Copy")').click(); await page.waitForTimeout(300);
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(e => 'ERROR ' + e.message);
    const want = await page.evaluate(([a, b]) => { const st = SC.session.store, o = Object.assign({}, SC.compiler.DEFAULTS.checklist, (JSON.parse(localStorage.getItem('sc3.compiler') || '{}').opts || {}).checklist); return SC.compiler.make(st, SC.catalog.build(st, { titleIDs: [a, b], issueIDs: null, nested: true }), 'checklist', o); }, [ID.HERALD, ID.TRIAL]);
    expect(/Copied/.test(await page.locator('.cmp-actions').innerText()) && copied.replace(/Compiled .*\n/, '') === want.replace(/Compiled .*\n/, '') && copied.indexOf('The Sample Herald') !== -1, 'Copy: "Copied", and the clipboard holds the whole checklist of both titles, as Download would write it', copied.slice(0, 200));
    // Open: a page output in a new tab.
    await page.locator('.cmp-output:has(.co-label:text-is("Catalog")) input').check(); await page.waitForTimeout(200);
    const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 8000 }).catch(() => null), page.locator('.cmp-actions button:has-text("Open")').click()]);
    let body = '';
    if (popup) { await popup.waitForLoadState().catch(() => {}); body = await popup.evaluate(() => document.body.innerText).catch(() => ''); }
    expect(!!popup && /^blob:/.test(popup.url()) && body.indexOf('The Sample Herald') !== -1, 'Open: the whole catalog opens in a new tab', popup && popup.url());
    expect((await dirty(page)).length === 0, 'none of this changes the library');
  });

  // ── 13. Save while the folder is being read ─────────────────────────
  await section('13. Save while the folder is being read: refused until it is done (SAV-15)', async () => {
    const { page } = await begin(BASE);
    await page.evaluate(id => { const s = SC.session.store; s.put('issue', Object.assign({}, s.state.issues.get(id), { notes: 'Saved after the read.' }), 'test edit'); }, ID.L1);
    await page.evaluate(() => window.__SC_TEST_FS__.ctl({ permission: 'prompt', slowRead: 2500 }));
    await page.reload(); await ready(page);
    await page.click('button:has-text("Allow access")');
    await page.waitForFunction(() => !!SC.session.ui.busy);
    const busy = await page.evaluate(() => SC.session.ui.busy);
    expect(await page.locator('.topbar button:has-text("Save")').isDisabled(), 'while "' + busy + '" is shown, Save is off');
    await page.keyboard.press('Control+s'); await page.waitForTimeout(150);
    const msg = await message(page);
    expect(msg === 'Not saved yet: wait until "' + busy + '" has finished, then save.', 'Ctrl+S then: "Not saved yet: wait until "Checking Test Library for changes…" has finished, then save."', msg);
    expect(table((await disk(page))[LI]).rows.find(r => r.IssueID === ID.L1)[HI_('notes')] === '', 'nothing was written');
    await page.waitForFunction(() => !SC.session.ui.busy, null, { timeout: 15000 });
    await page.evaluate(() => window.__SC_TEST_FS__.ctl({ slowRead: 0 }));
    await page.evaluate(() => { window.__m = SC.session.ui.message; });
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => SC.session.ui.message !== window.__m && !SC.session.ui.busy);
    expect(/^Saved SCAT_INTEGRITY-TEST_SPECLEDX-1875_ISSUES\.csv\./.test(await message(page)) && table((await disk(page))[LI]).rows.find(r => r.IssueID === ID.L1)[HI_('notes')] === 'Saved after the read.', 'once it has finished, Ctrl+S saves', await message(page));
  });

  // ── 14. Entry Order missing or repeated ─────────────────────────────
  await section('14. Entry Order missing or repeated: rows numbered in the order of the file (CSV-11)', async () => {
    // The file lists no. 3 first; its Entry Order cells are 3, (blank), 1, 1.
    const odd = reshape(BASE[LI], rows => {
      const head = rows[0], body = rows.slice(1).filter(r => r.some(v => String(v).trim()));
      const by = id => body.find(r => r[col(rows, 'IssueID')] === id);
      const order = [by(ID.L3), by(ID.L1), by(ID.L2), by(ID.L4)];
      const eo = col(rows, 'Entry Order');
      order[0][eo] = '3'; order[1][eo] = ''; order[2][eo] = '1'; order[3][eo] = '1';
      rows.length = 0; rows.push(head, ...order);
    });
    const { page } = await begin(Object.assign({}, BASE, { [LI]: odd }));
    const note = await page.evaluate(n => (SC.session.ui.report || []).filter(r => r.file === n).map(r => r.msg), LI);
    expect(note.indexOf('Entry Order numbers were missing or repeated; rows are numbered in the order they appear in the file.') !== -1, 'the load report says "Entry Order numbers were missing or repeated; rows are numbered in the order they appear in the file."', note);
    expect(same(await issueIDs(page, ID.LEDGER), [ID.L3, ID.L1, ID.L2, ID.L4]), 'the run is shown in the file\'s order: nos. 3, 1, 2, 4');
    expect((await dirty(page)).length === 0, 'nothing is marked changed by reading it');
    await page.evaluate(id => { const s = SC.session.store; s.put('issue', Object.assign({}, s.state.issues.get(id), { notes: 'Renumbered on save.' }), 'test edit'); }, ID.L4);
    await save(page);
    const t = table((await disk(page))[LI]).rows;
    expect(same(t.map(r => r.IssueID), [ID.L3, ID.L1, ID.L2, ID.L4]) && same(t.map(r => r['Entry Order']), ['1', '2', '3', '4']), 'saved: the same order, Entry Order written 1 to 4', t.map(r => r['Entry Order']));
  });

  expect(errors.length === 0, 'no page errors', errors.join('; '));
  await browser.close();
  console.log(log.join('\n'));
  if (failures) { console.log('FAILED ' + failures + ' of ' + count + ' everyday browser checks'); process.exit(1); }
  console.log('PASSED ' + count + ' everyday browser checks');
})();
