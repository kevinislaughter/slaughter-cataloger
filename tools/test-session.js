#!/usr/bin/env node
/* Browser tests of saving, restoring and reconnecting — regression tests for the 3.0
   readiness review (B-01, B-02, B-05, B-06, B-07, M-01, M-04, m-01).
   usage: node tools/test-session.js <app.html> <3.0 sample library folder>

   Two small libraries are made from the sample: A, one title with issues and contents
   (The Demonstration Quarterly); and B, another library (another slug) holding one title with
   issues and no contents (The Placeholder Bulletin), for the checks that need a folder of a
   different library.

   Part A runs the built app (file://) against an in-memory folder that can fail a write,
   withhold permission, and be changed "elsewhere" between steps.
   Part B serves the app over http://127.0.0.1 and runs it against a real folder of the
   browser's File System Access API (the origin-private file system), so reading, writing,
   backups and conflicts go through the browser's own implementation.
   Fails on any page error or failed expectation. */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }

const app = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'slaughter-cataloger-3.html'));
const sampleDir = process.argv[3];
if (!sampleDir) { console.error('usage: test-session.js <app.html> <3.0 sample library folder>'); process.exit(2); }
const readDir = d => Object.fromEntries(fs.readdirSync(d).filter(n => /\.csv$/i.test(n)).map(n => [n, fs.readFileSync(path.join(d, n), 'utf8')]));
globalThis.SC = {}; require(path.join(__dirname, '..', 'js', 'core', 'csv.js'));
const SC_csv = globalThis.SC.csv;
// ── The two libraries (see above) ──
const SAMPLE = readDir(sampleDir);
const A_SLUG = 'EXAMPLE-LIBRARY', A_TID = 'DEMQUARX-1995', B_SLUG = 'ANOTHER-LIBRARY', B_TID = 'PLABULLX-1961';
const SAMPLE_T = Object.keys(SAMPLE).find(n => /_TITLES\.csv$/.test(n));
const onlyTitle = (text, tid) => { const p = SC_csv.parse(text), h = p.rows[0]; return SC_csv.serialize([h].concat(p.rows.slice(1).filter(r => r[h.indexOf('TitleID')] === tid)), p.style); };
const reslug = text => { const p = SC_csv.parse(text), h = p.rows[0], si = h.indexOf('Title Library Slug'), ni = h.indexOf('Title Library Name');
  p.rows.slice(1).forEach(r => { r[si] = B_SLUG; if (ni !== -1) r[ni] = 'Another Library'; }); return SC_csv.serialize(p.rows, p.style); };
const LIB_A = { [SAMPLE_T]: onlyTitle(SAMPLE[SAMPLE_T], A_TID) };
Object.keys(SAMPLE).filter(n => n.indexOf('_' + A_TID + '_') !== -1).forEach(n => { LIB_A[n] = SAMPLE[n]; });
const LIB_B = { [SAMPLE_T.replace(A_SLUG, B_SLUG)]: reslug(onlyTitle(SAMPLE[SAMPLE_T], B_TID)) };
Object.keys(SAMPLE).filter(n => n.indexOf('_' + B_TID + '_ISSUES') !== -1).forEach(n => { LIB_B[n.replace(A_SLUG, B_SLUG)] = reslug(SAMPLE[n]); });
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const T = Object.keys(LIB_A).find(n => /_TITLES\.csv$/.test(n)), I = Object.keys(LIB_A).find(n => /_ISSUES\.csv$/.test(n)), C = Object.keys(LIB_A).find(n => /_CONTENTS\.csv$/.test(n));

// A test folder kept in its own IndexedDB database (so it survives reloads and crashes, is shared
// by the tabs of one browser context, and every write has landed before the next page reads it),
// with controls: ctl.permission ('granted' | 'prompt'), ctl.deny, ctl.failWrite (names whose
// writes throw), ctl.slow ({name: ms} to slow a write down; window.__slowHere does it in one tab only).
function fakeFS(seedJSON) {
  if (window.top !== window || !/^(file|https?):$/.test(location.protocol)) return;   // not in about:blank or the preview frame
  const seed = JSON.parse(seedJSON);
  const dbp = new Promise((res, rej) => { const r = indexedDB.open('__sc_test_folder__', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = async k => { const d = await dbp; return new Promise(res => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); }); };
  const set = async (k, v) => { const d = await dbp; return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); };
  const load = async () => {
    let tree = await get('tree');
    if (!tree) { tree = { files: {}, dirs: {} }; Object.keys(seed).forEach(n => { tree.files[n] = { text: seed[n], lastModified: 1000 }; }); await set('tree', tree); }
    return tree;
  };
  const ctl = async () => Object.assign({ permission: 'granted', failWrite: [], slow: {} }, (await get('ctl')) || {});
  const setCtl = async p => set('ctl', Object.assign(await ctl(), p));
  const nodeAt = (tree, parts) => parts.reduce((n, p) => n.dirs[p], tree);
  let lock = Promise.resolve();                      // one change to the tree at a time
  const mutate = (parts, fn) => (lock = lock.then(async () => { const tree = await load(); fn(nodeAt(tree, parts)); await set('tree', tree); }));
  const notFound = () => { const e = new Error('A requested file or directory could not be found.'); e.name = 'NotFoundError'; return e; };
  function fileHandle(parts, name) {
    return { kind: 'file', name,
      getFile: async () => { const f = nodeAt(await load(), parts).files[name]; if (!f) throw notFound(); return { name, lastModified: f.lastModified, text: async () => f.text }; },
      createWritable: async () => {
        const c = await ctl();
        if (c.failWrite.indexOf(name) !== -1) { const e = new Error('The file could not be written (test: disk full)'); e.name = 'QuotaExceededError'; throw e; }
        const slow = (window.__slowHere && window.__slowHere[name]) || c.slow[name] || 0;     // __slowHere: this tab only
        let buf = '';
        // A slow write streams slowly (as a large file does); close() then swaps it in at once.
        // abort() ends a write still in progress, as the browser's own does.
        let pendingWrite = null, aborted = false;
        return {
          write: t => new Promise((res, rej) => {
            if (aborted) { rej(Object.assign(new Error('The write was aborted'), { name: 'AbortError' })); return; }
            if (!slow) { buf += t; res(); return; }
            const timer = setTimeout(() => { pendingWrite = null; buf += t; res(); }, slow);
            pendingWrite = () => { clearTimeout(timer); rej(Object.assign(new Error('The write was aborted'), { name: 'AbortError' })); };
          }),
          abort: async () => { aborted = true; if (pendingWrite) { const p = pendingWrite; pendingWrite = null; p(); } },
          close: async () => {
            const sc = !parts.length && window.__slowCloseHere && window.__slowCloseHere[name];   // the swap into the library folder delayed (this tab only; not backups)
            if (sc) await new Promise(r => setTimeout(r, sc));
            await mutate(parts, n => { n.files[name] = { text: buf, lastModified: Date.now() }; });
          } };
      } };
  }
  function dirHandle(parts, name) {
    return { kind: 'directory', name,
      queryPermission: async () => (await ctl()).permission,
      requestPermission: async () => { if ((await ctl()).deny) return 'denied'; await setCtl({ permission: 'granted' }); return 'granted'; },
      values: async function* () { const n = nodeAt(await load(), parts); for (const f of Object.keys(n.files)) yield fileHandle(parts, f); for (const d of Object.keys(n.dirs)) yield dirHandle(parts.concat(d), d); },
      getFileHandle: async (f, o) => { if (!nodeAt(await load(), parts).files[f]) { if (!(o && o.create)) throw notFound(); await mutate(parts, n => { if (!n.files[f]) n.files[f] = { text: '', lastModified: Date.now() }; }); } return fileHandle(parts, f); },
      getDirectoryHandle: async (d, o) => { if (!nodeAt(await load(), parts).dirs[d]) { if (!(o && o.create)) throw notFound(); await mutate(parts, n => { if (!n.dirs[d]) n.dirs[d] = { files: {}, dirs: {} }; }); } return dirHandle(parts.concat(d), d); } };
  }
  window.__SC_TEST_FS__ = {
    root: dirHandle([], 'Sample library'),
    tree: load,
    get: async n => ((await load()).files[n] || {}).text,
    put: (n, text) => mutate([], t => { t.files[n] = { text, lastModified: Date.now() }; }),
    remove: n => mutate([], t => { delete t.files[n]; }),
    replace: (names, files) => mutate([], t => { names.forEach(n => { delete t.files[n]; }); Object.entries(files).forEach(([n, text]) => { t.files[n] = { text, lastModified: Date.now() }; }); }),
    ctl: setCtl
  };
}

let failures = 0;
const log = [], errors = [];
const verbose = !!process.env.SC_VERBOSE;
const step = s => { log.push('· ' + s); if (verbose) console.error('· ' + s); };
// A failed check prints its detail, when one is given, on the line below.
const expect = (ok, what, detail) => {
  const line = (ok ? '  ok   ' : '  FAIL ') + what + (!ok && detail !== undefined && detail !== '' ? '\n         ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : '');
  log.push(line); if (verbose) console.error(line); if (!ok) failures++;
};

async function newContext(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(fakeFS, JSON.stringify(seed));
  return ctx;
}
async function newPage(ctx, url) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.dialogs = [];
  page.answer = true;
  page.on('dialog', d => { page.dialogs.push(d.message()); if (page.answer) d.accept(); else d.dismiss(); });
  if (url) await page.goto(url);
  return page;
}
const fileURL = 'file://' + app;
const ready = async page => { await page.waitForFunction(() => window.SC && SC.session && SC.session.whenReady); await page.evaluate(() => SC.session.whenReady()); await page.waitForFunction(() => SC.session.ui.access !== 'checking' && !SC.session.ui.busy); };
const settled = page => page.evaluate(() => SC.session.flush());
// Crash a page's renderer, as a browser crash would, and wait until the browser has seen it. First CDP's
// Page.crash; on GitHub's runners it sometimes did nothing (no crash event, and the page went on holding
// the library's Web Lock, so the reopened page rightly found the library open elsewhere). Then
// chrome://kill, a renderer debug URL: the renderer ends at once, without unloading the page.
// SC_CRASH=kill uses only chrome://kill (to check that way too).
async function crashPage(ctx, page) {
  const t0 = Date.now(), crashed = new Promise(r => page.once('crash', () => r(true)));
  const within = ms => Promise.race([crashed, new Promise(r => setTimeout(() => r(false), ms))]);
  if (process.env.SC_CRASH !== 'kill') {
    const cdp = await ctx.newCDPSession(page);
    cdp.send('Page.crash').catch(() => {});
    if (await within(3000)) return { how: 'Page.crash', ms: Date.now() - t0 };
  }
  page.goto('chrome://kill').catch(() => {});
  if (await within(5000)) return { how: 'chrome://kill', ms: Date.now() - t0 };
  return { how: 'no crash', ms: Date.now() - t0 };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const saveState = page => page.locator('.save-state').innerText().catch(() => '');
const titleOf = page => ev(page, () => Array.from(SC.session.store.state.titles.values())[0]);
const editTitle = (page, patch) => ev(page, p => { const s = SC.session.store; const t = Array.from(s.state.titles.values())[0]; s.put('title', Object.assign({}, t, p), 'test edit'); }, patch);
// Click Save and wait until the save has finished (its message or download notice has appeared).
const clickSave = async page => {
  await page.evaluate(() => { window.__before = [SC.session.ui.message, SC.session.ui.download]; });
  await page.click('.topbar .btn:has-text("Save"), .topbar .btn:has-text("Download")');
  await page.waitForFunction(() => !SC.session.ui.busy && (SC.session.ui.message !== window.__before[0] || SC.session.ui.download !== window.__before[1]));
};
const message = page => ev(page, () => (SC.session.ui.message || {}).text || '');
// What a page reopened after a crash found: printed with a failed check (the first GitHub run lost every
// crash check while they pass locally, so the log must say whether the library was refused or empty).
const crashState = page => ev(page, async () => ({ access: SC.session.ui.access, message: ((SC.session.ui.message || {}).text || '').slice(0, 120), titles: SC.session.store.state.titles.size,
  locks: navigator.locks ? (await navigator.locks.query()).held.map(l => l.name) : 'no Web Locks' }));
const openFolder = async page => { await page.click('text=Open library folder'); await page.waitForSelector('table.shelf tbody tr'); await settled(page); };
const counts = page => ev(page, () => { const st = SC.session.store.state; return { titles: st.titles.size, issues: st.issues.size, contents: st.contents.size }; });
const diskRows = (page, name) => ev(page, async n => { const t = await window.__SC_TEST_FS__.get(n); return t == null ? null : SC.csv.parse(t).rows.length - 1; }, name);

async function partA(browser) {
  // ── B-01: undo past a save, then a different edit ─────────────────────
  step('B-01: a different edit after undoing past a save stays unsaved');
  let ctx = await newContext(browser, LIB_A);
  let page = await newPage(ctx, fileURL);
  await ready(page);
  await openFolder(page);
  await editTitle(page, { generalNotes: 'B' });
  await clickSave(page);
  expect(/All changes saved/.test(await saveState(page)), 'B saved');
  await page.click('.topbar button:has-text("Undo")');
  await editTitle(page, { generalNotes: 'D' });
  expect(/1 file changed/.test(await saveState(page)), 'after undo + new edit: "1 file changed" (' + await saveState(page) + ')');
  expect(await page.locator('.topbar .btn.primary:has-text("Save")').isEnabled(), 'Save is enabled');
  page.dialogs.length = 0;
  await page.click('text=Close library');
  expect(page.dialogs.some(d => /unsaved changes/.test(d)), 'closing the library asks first (unsaved changes)');
  await ctx.close();

  // ── B-02: reconnect reads a file added while away ─────────────────────
  step('B-02: reconnecting reads a file added to the folder while away');
  ctx = await newContext(browser, { [T]: LIB_A[T] });
  page = await newPage(ctx, fileURL);
  await ready(page);
  await openFolder(page);
  expect((await counts(page)).issues === 0, 'only the Titles file at first: no issues');
  await ev(page, async ([n, t]) => { await window.__SC_TEST_FS__.put(n, t); await window.__SC_TEST_FS__.ctl({ permission: 'prompt' }); }, [I, LIB_A[I]]);
  await page.reload(); await ready(page);
  await page.waitForSelector('text=Allow access');
  await page.click('button:has-text("Allow access")');
  await page.waitForFunction(() => !SC.session.ui.busy && SC.session.ui.message);
  const issuesWant = SC_count(LIB_A[I]);
  expect((await counts(page)).issues === issuesWant, 'after reconnecting: ' + issuesWant + ' issues (' + (await counts(page)).issues + ')');
  expect(/New in the folder; read/.test(await message(page)), 'the message says a new file was read');
  const compiled = await ev(page, () => SC.catalog.build(SC.session.store, { titleIDs: Array.from(SC.session.store.state.titles.keys()) }).counts.issues);
  expect(compiled === issuesWant, 'the Compiler sees the new issues at once (' + compiled + ')');
  // A file of another library added to the folder is reported, not loaded.
  const bTitles = Object.keys(LIB_B).find(n => /_TITLES/.test(n));
  await ev(page, ([n, t]) => window.__SC_TEST_FS__.put('SCAT_OTHER_' + n, t), [bTitles, LIB_B[bTitles]]);
  await ev(page, () => window.__SC_TEST_FS__.ctl({ permission: 'prompt' }));
  await page.reload(); await ready(page);
  await page.click('button:has-text("Allow access")');
  await page.waitForFunction(() => !SC.session.ui.busy && SC.session.ui.message);
  expect((await counts(page)).titles === SC_count(LIB_A[T]), 'another library\'s Titles file is not loaded');
  expect(await ev(page, () => SC.session.ui.report.some(r => r.level === 'skip' && /Belongs to library|Another Titles file/.test(r.msg))), 'and is reported in the load notes');
  await ev(page, async () => window.__SC_TEST_FS__.remove(Object.keys((await window.__SC_TEST_FS__.tree()).files).find(n => /^SCAT_OTHER_/.test(n))));
  // Reconnecting with nothing changed keeps the undo history.
  await editTitle(page, { generalNotes: 'kept' });
  await ev(page, () => window.__SC_TEST_FS__.ctl({ permission: 'granted' }));
  await page.evaluate(() => SC.session.reconnect());
  expect(await ev(page, () => SC.session.store.canUndo), 'reconnecting with only my own change pending keeps undo');
  await ctx.close();

  // ── M-01: a file gone from the folder is kept and flagged ─────────────
  step('M-01: a file that disappears from the folder keeps its records');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page);
  const before = await counts(page);
  await ev(page, n => window.__SC_TEST_FS__.remove(n), C);
  await page.reload(); await ready(page);
  await page.waitForFunction(() => !SC.session.ui.busy);
  expect(JSON.stringify(await counts(page)) === JSON.stringify(before), 'records of the missing Contents file are kept (' + JSON.stringify(await counts(page)) + ')');
  await page.goto(fileURL + '#/library'); await ready(page); await page.waitForFunction(() => !SC.session.ui.busy);
  expect(await page.locator('.file-problems:has-text("no longer in the folder")').count() === 1, 'the Library page says the file is no longer in the folder');
  await ev(page, n => { const s = SC.session.store; const c = Array.from(s.state.contents.values()).find(x => x._src === n); s.put('content', Object.assign({}, c, { notes: 'edited while missing' })); }, C);
  await clickSave(page);
  expect((await diskRows(page, C)) === null, 'saving does not make the missing file again');
  expect(/not in the folder|no longer in the folder/.test(await message(page)), 'the save message says it was not saved');
  expect(/1 file changed/.test(await saveState(page)), 'and it stays unsaved');
  await page.goto(fileURL + '#/compiler/' + (await titleOf(page)).titleID); await ready(page); await page.waitForFunction(() => !SC.session.ui.busy);
  await page.waitForSelector('.cmp-file');
  expect(await page.locator('text=missing from the folder').count() > 0, 'the Compiler notes records kept from a missing file');
  // It comes back: the edit is kept, and saving backs up the version on disk.
  await ev(page, ([n, t]) => window.__SC_TEST_FS__.put(n, t), [C, LIB_A[C]]);
  await page.evaluate(() => SC.session.reconnect());
  expect(await ev(page, n => !SC.session.store.state.files.get(n).missing, C), 'back in the folder: no longer flagged');
  expect(await ev(page, n => Array.from(SC.session.store.state.contents.values()).some(c => c._src === n && c.notes === 'edited while missing'), C), 'the edit made meanwhile is kept');
  await clickSave(page);
  expect(/Saved .*CONTENTS/.test(await message(page)), 'and saves (' + (await message(page)).slice(0, 120) + ')');
  // Deliberately removed: Remove from library, after a confirmation.
  await ev(page, n => window.__SC_TEST_FS__.remove(n), C);
  await page.goto(fileURL + '#/library'); await page.reload(); await ready(page); await page.waitForFunction(() => !SC.session.ui.busy);
  page.dialogs.length = 0;
  await page.click('.file-problems button:has-text("Remove from library")');
  expect(page.dialogs.some(d => /Remove .* from the library/.test(d)), 'removing asks for confirmation');
  expect((await counts(page)).contents === 0 && (await counts(page)).issues === before.issues, 'its records are gone, the rest kept');
  await ctx.close();

  // ── M-04 / m-01: a save that fails part way ───────────────────────────
  step('M-04: a save that fails for one file');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page);
  await ev(page, ([iName, cName]) => {
    const s = SC.session.store;
    s.batch('three files', () => {
      const t = Array.from(s.state.titles.values())[0]; s.put('title', Object.assign({}, t, { generalNotes: 'x' }));
      const i = Array.from(s.state.issues.values()).find(x => x._src === iName); s.put('issue', Object.assign({}, i, { notes: 'y' }));
      const c = Array.from(s.state.contents.values()).find(x => x._src === cName); s.put('content', Object.assign({}, c, { notes: 'z' }));
    });
  }, [I, C]);
  expect(/3 files changed/.test(await saveState(page)), 'three files changed');
  await ev(page, n => window.__SC_TEST_FS__.ctl({ failWrite: [n] }), I);
  await clickSave(page);
  let msg = await message(page);
  expect(/Save did not finish/.test(msg) && new RegExp('Not saved: ' + I).test(msg), 'message names the file not saved and why: ' + msg.slice(0, 160));
  expect(/still here; Save again/.test(msg) && !/Nothing was lost/.test(msg), 'message is accurate (no "Nothing was lost")');
  expect(await ev(page, () => Array.from(SC.session.store.dirty)) + '' === I, 'only the file not written is still unsaved');
  expect(/"x"|,x,|x$/m.test(await ev(page, n => window.__SC_TEST_FS__.get(n), T)) || (await ev(page, n => window.__SC_TEST_FS__.get(n), T)).indexOf('x') !== -1, 'the Titles file was written');
  await ev(page, () => window.__SC_TEST_FS__.ctl({ failWrite: [] }));
  await clickSave(page);
  msg = await message(page);
  expect(new RegExp('Saved ' + I).test(msg) && !/changed on disk/.test(msg), 'retry saves it, with no false "changed on disk": ' + msg.slice(0, 160));
  // Written to disk, then the tab died before it could note that: the next start sees the file
  // already holds the changes and marks it saved — no conflict, no backup claimed.
  await editTitle(page, { generalNotes: 'written then crashed' });
  await settled(page);
  await ev(page, async n => { const st = SC.session.store.state; await SC.storage.writeFiles(window.__SC_TEST_FS__.root, [{ name: n, text: SC.records.writeFile(st, n), baseline: st.files.get(n).hash }]); }, T);
  await page.reload(); await ready(page); await page.waitForFunction(() => !SC.session.ui.busy);
  expect(/All changes saved/.test(await saveState(page)), 'restarted after the write: the file counts as saved');
  expect(((await titleOf(page)) || {}).generalNotes === 'written then crashed', 'and the change is there');
  await ctx.close();

  // ── B-05: downloads are not saves ─────────────────────────────────────
  step('B-05: without folder access, a download is not a save until confirmed');
  ctx = await newContext(browser, {});
  page = await newPage(ctx, fileURL);
  await ready(page);
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sc3-'));
  [T, I, C].forEach(n => fs.writeFileSync(path.join(tmp, n), LIB_A[n]));
  await page.setInputFiles('input[type=file]', [T, I, C].map(n => path.join(tmp, n)));
  await page.waitForSelector('table.shelf tbody tr');
  await editTitle(page, { generalNotes: 'download me' });
  const dl = page.waitForEvent('download');
  await clickSave(page);
  const d = await dl;
  expect(d.suggestedFilename() === T, 'the changed file is downloaded (' + d.suggestedFilename() + ')');
  expect(/1 file changed/.test(await saveState(page)), 'still "1 file changed" after the download');
  expect(await page.locator('.download-banner:has-text("count as saved once")').count() === 1, 'the app says the download counts once it replaces the old copy');
  page.dialogs.length = 0;
  page.answer = false;                       // "Continue without saving?" — no
  await page.click('text=Close library');
  page.answer = true;
  expect(page.dialogs.some(d => /unsaved changes/.test(d)), 'closing still warns about unsaved changes');
  expect(await ev(page, () => SC.session.ui.mode) === 'files', 'and declining keeps the library open');
  await page.reload(); await ready(page);
  expect(/1 file changed/.test(await saveState(page)) && ((await titleOf(page)) || {}).generalNotes === 'download me', 'after a reload the change is still there and unsaved');
  const dl2 = page.waitForEvent('download');
  await clickSave(page); await dl2;
  await editTitle(page, { generalNotes: 'download me, then more' });
  await page.click('button:has-text("I\'ve replaced the files")');
  expect(/1 file changed/.test(await saveState(page)), 'confirming covers what was downloaded; the later edit stays unsaved');
  const dl3 = page.waitForEvent('download');
  await clickSave(page); await dl3;
  await page.click('button:has-text("I\'ve replaced the files")');
  expect(/All changes saved/.test(await saveState(page)), 'confirmed: all changes saved');
  await ctx.close();

  // ── B-06: every change reaches the browser's copy at once ─────────────
  step('B-06: the browser keeps a change made just before a crash');
  for (const wait of [0, 50, 100, 300, 600, 1000]) {
    ctx = await newContext(browser, LIB_A);
    page = await newPage(ctx, fileURL);
    await ready(page); await openFolder(page);
    await settled(page);
    await editTitle(page, { generalNotes: 'crash ' + wait });
    if (wait) await page.waitForTimeout(wait);
    const crash = await crashPage(ctx, page);
    if (verbose) console.error('  crashed after ' + wait + ' ms');
    const again = await newPage(ctx, fileURL);
    await ready(again);
    await again.waitForFunction(() => !SC.session.ui.busy);
    const got = (await titleOf(again) || {}).generalNotes;
    if (wait >= 50) {
      let seen = '';
      if (got !== 'crash ' + wait) {
        const first = await crashState(again);
        await again.waitForTimeout(5000); await again.reload(); await ready(again);
        seen = { crash, first, after5s: await crashState(again), restoredAfter5s: ((await titleOf(again)) || {}).generalNotes === 'crash ' + wait };
      }
      expect(got === 'crash ' + wait, 'crash ' + wait + ' ms after a change: the change is restored', seen);
    }
    else log.push('  info crash at once after a change: ' + (got === 'crash ' + wait ? 'restored' : 'not restored (the change was still being written)'));
    if (wait === 1000) expect(/1 file changed/.test(await saveState(again)), 'and shows as unsaved');
    await ctx.close();
  }
  step('B-06: a storage failure is shown, not just logged');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page);
  await ev(page, () => { const w = SC.storage.working; SC.storage.__w = { append: w.append, compact: w.compact }; w.append = w.compact = () => Promise.reject(new Error('QuotaExceededError: the storage quota was exceeded')); });
  await editTitle(page, { generalNotes: 'not kept' });
  await settled(page);
  expect(await page.locator('.message.error:has-text("not being kept in this browser")').count() === 1, 'a banner says changes are not being kept');
  await ev(page, () => { Object.assign(SC.storage.working, SC.storage.__w); });
  await editTitle(page, { generalNotes: 'kept again' });
  await settled(page);
  expect(await page.locator('.message.error:has-text("not being kept in this browser")').count() === 0, 'the banner goes once writing works again');
  await ctx.close();

  // ── B-07: one tab at a time; the working copy stays with its folder ────
  step('B-07: a second tab cannot overwrite the first');
  ctx = await newContext(browser, LIB_A);
  const a = await newPage(ctx, fileURL);
  await ready(a); await openFolder(a);
  await editTitle(a, { generalNotes: 'from tab A' });
  await settled(a);
  const b = await newPage(ctx, fileURL);
  await ready(b);
  expect(await b.locator('text=Already open in another tab').count() === 1, 'tab B says the library is open in another tab');
  expect(await ev(b, () => SC.session.ui.mode) === 'none', 'tab B has not loaded or written anything');
  await b.click('text=Use this tab instead');
  await b.waitForSelector('table.shelf tbody tr');
  expect((await titleOf(b)).generalNotes === 'from tab A', 'tab B takes over with tab A\'s unsaved change');
  await a.waitForFunction(() => SC.session.ui.access === 'lost');
  expect(await a.locator('text=Opened in another tab').count() === 1, 'tab A says it has stopped');
  await ev(a, () => { const s = SC.session.store; const t = Array.from(s.state.titles.values())[0]; s.put('title', Object.assign({}, t, { generalNotes: 'late change in A' })); });
  await ev(a, () => SC.session.save());
  await settled(a);
  await b.reload(); await ready(b);
  expect((await titleOf(b)).generalNotes === 'from tab A', 'nothing tab A does afterwards reaches the working copy');
  expect((await ev(b, n => window.__SC_TEST_FS__.get(n), T)).indexOf('late change in A') === -1, 'or the folder');
  await ctx.close();

  step('B-07: a working copy is never joined to another library\'s folder');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page);
  await editTitle(page, { generalNotes: 'unsaved change in A' });
  await settled(page);
  // The remembered folder now holds another library.
  await ev(page, ([aNames, bFiles]) => window.__SC_TEST_FS__.replace(aNames, bFiles), [Object.keys(LIB_A), LIB_B]);
  const bSnapshot = await ev(page, async () => JSON.stringify((await window.__SC_TEST_FS__.tree()).files));
  await page.reload(); await ready(page); await page.waitForFunction(() => !SC.session.ui.busy);
  expect(new RegExp('holds the library ' + B_SLUG + ', not ' + A_SLUG).test(await message(page)), 'restoring says the folder holds another library');
  expect(((await titleOf(page)) || {}).generalNotes === 'unsaved change in A' && (await counts(page)).titles === SC_count(LIB_A[T]), 'the working copy is untouched');
  await ev(page, () => SC.session.save());
  expect(await ev(page, async () => JSON.stringify((await window.__SC_TEST_FS__.tree()).files)) === bSnapshot, 'Save writes nothing into the other library\'s folder');
  // Put the right library back and point to it: the unsaved change is kept and saves.
  await ev(page, ([bNames, aFiles]) => window.__SC_TEST_FS__.replace(bNames, aFiles), [Object.keys(LIB_B), LIB_A]);
  await page.click('button:has-text("Choose folder")');
  await page.waitForFunction(() => !SC.session.ui.busy && !SC.session.ui.wrongFolder);
  await clickSave(page);
  expect((await ev(page, n => window.__SC_TEST_FS__.get(n), T)).indexOf('unsaved change in A') !== -1, 'after Choose folder, the kept change saves to the right folder');
  await ctx.close();

  // ── Independent check, new 1: two saves at once ───────────────────────
  step('Two saves started together: the later edit is what ends up on disk');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page);
  await ev(page, n => window.__SC_TEST_FS__.ctl({ slow: { [n]: 800 } }), T);
  await editTitle(page, { generalNotes: 'first save' });
  await page.click('.topbar .btn:has-text("Save")');
  await page.waitForFunction(() => /Saving/.test(SC.session.ui.busy || ''));
  await editTitle(page, { publisher: 'Second Save Press', generalNotes: 'second save' });
  await page.keyboard.press('Control+s');
  await page.waitForFunction(async () => { const t = await window.__SC_TEST_FS__.tree(); const n = Object.keys(t.files).find(x => /_TITLES\.csv$/.test(x)); return /second save/.test(t.files[n].text); }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !SC.session.ui.busy);
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => !SC.session.ui.busy);
  const onDisk = await ev(page, n => window.__SC_TEST_FS__.get(n), T);
  expect(onDisk.indexOf('second save') !== -1 && onDisk.indexOf('Second Save Press') !== -1, 'the Titles file on disk holds the second edit');
  const appText = await ev(page, n => SC.records.writeFile(SC.session.store.state, n), T);
  const dirtyNow = await ev(page, () => Array.from(SC.session.store.dirty));
  expect(dirtyNow.length > 0 || appText === onDisk, '"All changes saved" only when every file on disk is what the app shows (' + JSON.stringify(dirtyNow) + ')');
  expect(dirtyNow.indexOf(T) === -1 && appText === onDisk, 'and here it is: the Titles file matches and shows as saved');
  await ctx.close();

  // ── Independent check, new 2: one tab at a time without Web Locks ─────
  step('Without Web Locks: still one tab at a time');
  ctx = await newContext(browser, LIB_A);
  await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true }); });
  const na = await newPage(ctx, fileURL);
  await ready(na);
  expect(await ev(na, () => !navigator.locks), 'this browser context has no Web Locks');
  await openFolder(na);
  await editTitle(na, { generalNotes: 'A before' });
  await settled(na);
  await na.reload(); await ready(na);
  expect(await ev(na, () => SC.session.ui.access) === 'owner', 'reloading the only tab is not taken for a second tab');
  const nb = await newPage(ctx, fileURL);
  await ready(nb);
  expect(await nb.locator('text=Already open in another tab').count() === 1, 'a second tab is refused');
  await nb.click('text=Use this tab instead');
  await nb.waitForSelector('table.shelf tbody tr');
  expect((await titleOf(nb)).generalNotes === 'A before', 'it takes over with the first tab\'s change');
  await editTitle(na, { generalNotes: 'A after takeover' });
  await na.waitForFunction(() => SC.session.ui.access === 'lost', null, { timeout: 8000 }).catch(() => {});
  expect(await ev(na, () => SC.session.ui.access) === 'lost', 'the first tab notices it has been taken over');
  await editTitle(nb, { generalNotes: 'B edit' });
  await settled(nb);
  await na.close();
  await nb.reload(); await ready(nb);
  expect((await titleOf(nb)).generalNotes === 'B edit', 'the first tab\'s later change did not overwrite the second\'s');
  await ctx.close();

  // ── Independent check, new 3: a snapshot that cannot be stored ────────
  step('Opening another library when the browser cannot store it: no mixing, notice stays');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page);
  await settled(page);
  await ev(page, () => { const w = SC.storage.working; SC.storage.__c = w.compact; w.compact = () => Promise.reject(new Error('QuotaExceededError: the storage quota was exceeded')); });
  // The folder now holds library B; open it as another library.
  await ev(page, ([aNames, bFiles]) => window.__SC_TEST_FS__.replace(aNames, bFiles), [Object.keys(LIB_A), LIB_B]);
  await page.click('text=Open another folder');
  await page.waitForFunction(slug => SC.session.store.state.library.slug === slug, B_SLUG);
  await settled(page);
  await editTitle(page, { generalNotes: 'edit on library B' });
  await settled(page);
  expect(await page.locator('.message.error:has-text("not being kept in this browser")').count() === 1, 'the notice stays while the library itself is not stored, though the edit\'s journal entry was');
  await crashPage(ctx, page);
  page = await newPage(ctx, fileURL);
  await ready(page);
  const lib = await ev(page, () => ({ slug: SC.session.store.state.library.slug, titles: Array.from(SC.session.store.state.titles.values()).map(t => t.titleID), files: Array.from(SC.session.store.state.files.keys()) }));
  expect(lib.slug === A_SLUG && lib.titles.every(t => t === A_TID) && lib.files.every(f => f.indexOf(A_SLUG) !== -1), 'the restored copy is the library last stored, not a mixture (' + JSON.stringify(lib) + ')', await crashState(page));
  expect(/could not be restored/.test(await message(page)) || await ev(page, () => SC.session.ui.report.some(r => /could not be restored/.test(r.msg))), 'and says the later changes could not be restored');
  await ctx.close();

  // ── Independent check (suspected): a copy appearing in the folder ─────
  step('A copy of a loaded file appearing in the folder does not replace it');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page);
  const issuesBefore = await ev(page, () => Array.from(SC.session.store.state.issues.values()).map(i => i.issueID + ':' + (i.notes || '')).sort().join('|'));
  const copyName = I.replace(/\.csv$/, ' (conflicted copy).csv');
  await ev(page, ([n, t]) => window.__SC_TEST_FS__.put(n, t.replace(/"Issue"|"Notes"/, m => m)), [copyName, LIB_A[I].split('\n').map((l, k) => k === 1 ? l.replace(/,"[^"]*"$/, ',"from the copy"') : l).join('\n')]);
  await page.evaluate(() => SC.session.reconnect());
  const issuesAfter = await ev(page, () => Array.from(SC.session.store.state.issues.values()).map(i => i.issueID + ':' + (i.notes || '')).sort().join('|'));
  expect(issuesAfter === issuesBefore, 'the loaded Issues file is kept');
  expect(await ev(page, n => SC.session.store.state.files.has(n), I), 'and stays the file saves go to');
  expect(await ev(page, () => SC.session.ui.report.some(r => r.level === 'warn' && /already loaded/.test(r.msg))), 'the copy is reported as a warning');
  { const m = await message(page); expect(!/New in the folder; read/.test(m) && /not loaded/.test(m), 'and the reconnect message says it was not loaded (round 2): ' + m.slice(0, 160)); }
  await ctx.close();

  // ── Independent check, round 2 ────────────────────────────────────────
  const tid = (LIB_A[T].split('\n')[1].match(/[A-Z0-9]{8}-\d{4}/) || [])[0];
  const shortRow = t => { const p = SC_csv.parse(t); p.rows[1].splice(5, 1); return SC_csv.serialize(p.rows, p.style); };
  step('Round 2, 1: a file that could not be read is never written over');
  ctx = await newContext(browser, Object.assign({}, LIB_A, { [I]: shortRow(LIB_A[I]) }));
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page);
  expect(await ev(page, n => !SC.session.store.state.files.has(n) && SC.session.ui.report.some(r => r.file === n), I), 'the Issues file with a missing value is not loaded, and the report says so');
  const blockedWhy = await ev(page, t => (SC.session.store.blocked ? SC.session.store.blocked(SC.session.store.fileForNew('issue', t)) : ''), tid);
  expect(blockedWhy.indexOf(I) === 0 && /was not loaded/.test(blockedWhy), 'a new issue for that title has nowhere safe to go: ' + blockedWhy.slice(0, 120));
  await ev(page, h => { location.hash = h; }, '#/issues/' + tid + '/new');
  await page.waitForSelector('.issue-form');
  await page.fill('#f-shortname', 'Round two test');
  await page.locator('#f-shortname').press('Enter');
  await page.click('button:has-text("Record issue")');
  expect(/was not loaded/.test(await message(page)) && await ev(page, () => SC.session.store.state.issues.size) === 0, 'Record issue says why and records nothing');
  // Even a record put straight into that file (not through the interface) is never written over the file in the folder.
  await ev(page, ([n, t]) => { const s = SC.session.store; s.put('issue', { issueID: t + '-K222222', titleID: t, shortname: 'bypass', spec: [], na: [], overrides: [], speculative: false, _src: n, entryOrder: 1 }); }, [I, tid]);
  const brokenOnDisk = await ev(page, n => window.__SC_TEST_FS__.get(n), I);
  await clickSave(page);
  expect(await ev(page, n => window.__SC_TEST_FS__.get(n), I) === brokenOnDisk, 'Save leaves the file in the folder exactly as it was');
  expect(/already in the folder/.test(await message(page)) && await ev(page, n => SC.session.store.dirty.has(n), I), 'and says so, keeping the new issue as unsaved');
  expect(!/Nothing needed saving/.test(await message(page)), 'without also saying nothing needed saving (round 3)');
  await ctx.close();
  ctx = await newContext(browser, Object.assign({}, LIB_A, { [T]: shortRow(LIB_A[T]) }));
  page = await newPage(ctx, fileURL);
  await ready(page);
  await page.click('text=Open library folder');
  await page.waitForFunction(() => SC.session.ui.mode === 'folder' && !SC.session.ui.busy);
  expect(/was not loaded/.test(await ev(page, () => (SC.session.store.blocked ? SC.session.store.blocked(SC.session.store.fileForNew('title')) : ''))), 'with the Titles file unreadable, a new title has nowhere safe to go');
  await ctx.close();

  for (const noLocks of [false, true]) {
    step('Round 2, 2: a take-over in the middle of a save writes nothing more from the old tab' + (noLocks ? ' (without Web Locks)' : ''));
    ctx = await newContext(browser, LIB_A);
    if (noLocks) await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true }); });
    const ta = await newPage(ctx, fileURL);
    await ready(ta); await openFolder(ta);
    await editTitle(ta, { generalNotes: 'A title edit' });
    await ev(ta, () => { const s = SC.session.store; const i = Array.from(s.state.issues.values()).sort((x, y) => x.issueID.localeCompare(y.issueID))[0]; s.put('issue', Object.assign({}, i, { notes: 'A issue edit' })); });
    await settled(ta);
    // Tab A's Issues file is slow to write (in tab A only), so A is still saving when B takes over and saves.
    await ev(ta, n => { window.__slowHere = { [n]: 3000 }; }, I);
    await ev(ta, () => { window.__saveA = SC.session.save().then(() => 'finished', e => 'error: ' + e.message); });
    await ta.waitForFunction(() => /Saving/.test(SC.session.ui.busy || ''));
    const tb = await newPage(ctx, fileURL);
    await ready(tb);
    await tb.click('text=Use this tab instead');
    await tb.waitForSelector('table.shelf tbody tr');
    await ev(tb, () => SC.session.whenReady());
    await ev(tb, () => { const s = SC.session.store; const i = Array.from(s.state.issues.values()).sort((x, y) => x.issueID.localeCompare(y.issueID))[0]; s.put('issue', Object.assign({}, i, { notes: 'B issue edit' })); });
    await settled(tb);
    await clickSave(tb);
    // Wait for tab A's save to end, however it ends (it may still be writing after it stopped showing it).
    const endA = await ev(ta, () => Promise.race([window.__saveA, new Promise(r => setTimeout(() => r('still running after 20 s'), 20000))]));
    expect(endA === 'finished', 'tab A\'s save has ended (' + endA + ')');
    const diskI = await ev(tb, n => window.__SC_TEST_FS__.get(n), I), diskT = await ev(tb, n => window.__SC_TEST_FS__.get(n), T);
    expect(diskI.indexOf('B issue edit') !== -1, 'the Issues file on disk holds the new tab\'s edit');
    expect(diskT.indexOf('A title edit') !== -1, 'and the Titles file the change the new tab took over');
    const same = await ev(tb, ([i, t]) => SC.records.writeFile(SC.session.store.state, i) + SC.records.writeFile(SC.session.store.state, t), [I, T]);
    expect(same === diskI + diskT && await ev(tb, () => SC.session.store.dirty.size) === 0, 'the new tab\'s "All changes saved" is true');
    expect(await ev(ta, () => SC.session.ui.access) === 'lost', 'the old tab knows it was taken over');
    { const m = await message(ta); expect(/another tab took over/.test(m) && !/Nothing needed saving/.test(m), 'its message says the save stopped, and does not also say nothing needed saving (round 3): ' + m.slice(0, 160)); }
    await ctx.close();
  }

  step('Round 2, 4: a change the browser failed to store is reported after a crash');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page); await settled(page);
  await ev(page, () => {
    const w = SC.storage.working, append = w.append; let first = true;
    w.append = (s, e) => { if (first) { first = false; return Promise.reject(new Error('QuotaExceededError: the storage quota was exceeded')); } return append(s, e); };
    w.compact = () => Promise.reject(new Error('QuotaExceededError: the storage quota was exceeded'));
  });
  await ev(page, () => { const s = SC.session.store; const i = Array.from(s.state.issues.values())[0]; s.put('issue', Object.assign({}, i, { notes: 'change that was not stored' })); });
  await settled(page);
  await editTitle(page, { generalNotes: 'later change, stored' });
  await settled(page);
  expect(await page.locator('.message.error:has-text("not being kept in this browser")').count() === 1, 'the notice stays after a later change is stored, because an earlier one was not');
  await crashPage(ctx, page);
  page = await newPage(ctx, fileURL);
  await ready(page);
  expect(((await titleOf(page)) || {}).generalNotes === 'later change, stored', 'after a crash the stored change is back', await crashState(page));
  expect(/could not be restored/.test(await message(page)) && await ev(page, () => SC.session.ui.report.some(r => /failed to store them/.test(r.msg))), 'and the restore says one change could not be brought back');
  await ctx.close();

  step('Round 2, minor: without Web Locks, reopening after a crash is not taken for a second tab');
  ctx = await newContext(browser, LIB_A);
  await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true }); });
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page);
  await editTitle(page, { generalNotes: 'before the crash' });
  await settled(page);
  await crashPage(ctx, page);
  page = await newPage(ctx, fileURL);
  await ready(page);
  expect(await ev(page, () => SC.session.ui.access) === 'owner' && ((await titleOf(page)) || {}).generalNotes === 'before the crash', 'the reopened tab gets the library, with the change');
  await ctx.close();

  // ── Independent check, round 3 ────────────────────────────────────────
  step('Round 3, A: a new file whose first write failed saves next time');
  { const stid = (LIB_B[Object.keys(LIB_B).find(n => /_TITLES\.csv$/.test(n))].split('\n')[1].match(/[A-Z0-9]{8}-\d{4}/) || [])[0];
    ctx = await newContext(browser, LIB_B);
    page = await newPage(ctx, fileURL);
    await ready(page); await openFolder(page);
    const target = await ev(page, t => { const s = SC.session.store; const iss = s.issuesOfTitle(t)[0]; const file = s.fileForNew('content', t);
      s.put('content', { contentID: t + '-C222222', issueID: iss.issueID, titleID: t, issueRef: '', parentID: '', sequence: '1', itemTitle: 'First item of a new file', author: '', contentType: '', parentItem: '', startPage: '', endPage: '', notes: '', spec: [], na: [], speculative: false, _src: file, entryOrder: 1 });
      return file; }, stid);
    await ev(page, n => window.__SC_TEST_FS__.ctl({ failWrite: [n] }), target);
    await clickSave(page);
    expect(/Not saved/.test(await message(page)) && await ev(page, n => SC.session.store.dirty.has(n), target), 'the first write fails and the new file stays unsaved');
    await ev(page, () => window.__SC_TEST_FS__.ctl({ failWrite: [] }));
    await clickSave(page);
    expect(/Saved/.test(await message(page)) && !/already in the folder/.test(await message(page)), 'the next save writes it: ' + (await message(page)).slice(0, 120));
    expect((await ev(page, n => window.__SC_TEST_FS__.get(n), target) || '').indexOf('First item of a new file') !== -1 && !(await ev(page, () => SC.session.store.dirty.size)), 'the file is in the folder, and shows as saved');
    await ctx.close(); }

  step('Round 3, C: changes the browser could not store at all are reported after a crash');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page); await settled(page);
  await ev(page, () => { const w = SC.storage.working; w.append = w.compact = () => Promise.reject(new Error('QuotaExceededError: the storage quota was exceeded')); });
  for (const n of ['one', 'two', 'three']) { await editTitle(page, { generalNotes: 'unstored ' + n }); await settled(page); }
  await crashPage(ctx, page);
  page = await newPage(ctx, fileURL);
  await ready(page);
  expect(/3 change\(s\) could not be restored/.test(await message(page)), 'reopening says 3 changes could not be restored: ' + (await message(page)).slice(0, 120), await crashState(page));
  await settled(page);
  await page.reload(); await ready(page);
  expect(!/could not be restored/.test(await message(page)), 'and says it once: after the next stored snapshot it is not repeated');
  await ctx.close();

  step('Round 3, D: a set-aside repeat in another file is pointed out when the record is deleted');
  { const p = SC_csv.parse(LIB_A[C]); const h = p.rows[0]; const row = p.rows[1].slice();
    row[h.indexOf('IssueID')] = row[h.indexOf('IssueID')].replace(/-K.*/, '-K999999'); row[h.indexOf('Item Title')] = 'COPY WITH REPEATED ID';
    const extra = C.replace(/_CONTENTS\.csv$/, '_EXTRA_CONTENTS.csv');
    ctx = await newContext(browser, Object.assign({}, LIB_A, { [extra]: SC_csv.serialize([h, row], p.style) }));
    page = await newPage(ctx, fileURL);
    await ready(page); await openFolder(page);
    const cid = p.rows[1][h.indexOf('ContentID')];
    expect(await ev(page, n => ((SC.session.store.state.files.get(n) || {}).setAside || []).length === 1, extra), 'the repeat in the other file is set aside');
    await ev(page, id => SC.session.store.remove('content', id), cid);
    await clickSave(page);
    expect(new RegExp(extra.replace(/[.]/g, '\\.') + ' row 2').test(await message(page)) && /will be read as that record/.test(await message(page)), 'saving the deletion points it out');
    await ctx.close(); }

  step('Round 3, E: a file that appears and cannot be read is mentioned on reconnecting');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page); await openFolder(page);
  await ev(page, n => window.__SC_TEST_FS__.put(n, 'a,b\n"never closed,1\n'), 'SCAT_' + A_SLUG + '_BROKEN_ISSUES.csv');
  await page.evaluate(() => SC.session.reconnect());
  { const m = await message(page); expect(/BROKEN_ISSUES\.csv: New in the folder, but cannot be read/.test(m) && !/Nothing had changed/.test(m), 'the message names it: ' + m.slice(0, 140)); }
  await ctx.close();

  step('Round 3, suspected: a take-over in the instant before a write lands — the new tab\'s save waits, and wins');
  ctx = await newContext(browser, LIB_A);
  { const ta = await newPage(ctx, fileURL);
    await ready(ta); await openFolder(ta);
    await ev(ta, () => { const s = SC.session.store; const i = Array.from(s.state.issues.values()).sort((x, y) => x.issueID.localeCompare(y.issueID))[0]; s.put('issue', Object.assign({}, i, { notes: 'A issue edit' })); });
    await settled(ta);
    await ev(ta, n => { window.__slowCloseHere = { [n]: 8000 }; }, I);     // A's last ownership check passes, then the swap takes 8 s
    await ev(ta, () => { window.__saveA = SC.session.save().then(() => 'finished', e => 'error: ' + e.message); });
    await ta.waitForFunction(() => /Saving/.test(SC.session.ui.busy || ''));
    await ta.waitForTimeout(1200);
    const tb = await newPage(ctx, fileURL);
    await ready(tb);
    await tb.click('text=Use this tab instead');
    await tb.waitForSelector('table.shelf tbody tr');
    await ev(tb, () => SC.session.whenReady());
    await ev(tb, () => { const s = SC.session.store; const i = Array.from(s.state.issues.values()).sort((x, y) => x.issueID.localeCompare(y.issueID))[0]; s.put('issue', Object.assign({}, i, { notes: 'B issue edit' })); });
    await settled(tb);
    expect((await ev(tb, n => window.__SC_TEST_FS__.get(n), I)).indexOf('A issue edit') === -1, '(the old tab\'s write has not landed yet when the new tab saves)');
    await clickSave(tb);
    await ev(ta, () => Promise.race([window.__saveA, new Promise(r => setTimeout(r, 20000))]));
    const diskI = await ev(tb, n => window.__SC_TEST_FS__.get(n), I);
    expect(diskI.indexOf('B issue edit') !== -1, 'the new tab\'s edit is what the folder holds');
    expect(await ev(tb, n => SC.records.writeFile(SC.session.store.state, n), I) === diskI && await ev(tb, () => SC.session.store.dirty.size) === 0, 'and its "All changes saved" is true');
    expect(/changed on disk/.test(await message(tb)), 'the old tab\'s late write was seen and backed up, not silently overwritten: ' + (await message(tb)).slice(0, 140)); }
  await ctx.close();

  // ── Independent check, round 4 ────────────────────────────────────────
  step('Round 4, 5: changes made before the library was ever stored here are reported after a crash');
  ctx = await newContext(browser, LIB_A);
  page = await newPage(ctx, fileURL);
  await ready(page);
  await ev(page, () => { const w = SC.storage.working; w.append = w.compact = () => Promise.reject(new Error('QuotaExceededError: the storage quota was exceeded')); });
  await openFolder(page);
  await editTitle(page, { generalNotes: 'never stored' }); await settled(page);
  await editTitle(page, { generalNotes: 'never stored either' }); await settled(page);
  await crashPage(ctx, page);
  page = await newPage(ctx, fileURL);
  await ready(page);
  expect(/2 change\(s\) made in this browser could not be stored/.test(await message(page)), 'reopening says so: ' + (await message(page)).slice(0, 120));
  await page.reload(); await ready(page);
  expect(!/could not be stored/.test(await message(page)), 'once');
  await ctx.close();

  step('Round 4, suspected: a tab taken over stops writing at once, so the new tab\'s save does not wait on it');
  ctx = await newContext(browser, LIB_A);
  { const ta = await newPage(ctx, fileURL);
    await ready(ta); await openFolder(ta);
    await ev(ta, () => { const s = SC.session.store; const i = Array.from(s.state.issues.values()).sort((x, y) => x.issueID.localeCompare(y.issueID))[0]; s.put('issue', Object.assign({}, i, { notes: 'A issue edit' })); });
    await settled(ta);
    await ev(ta, n => { window.__slowHere = { [n]: 30000 }; }, I);            // a very slow write in tab A
    await ev(ta, () => { window.__saveA = SC.session.save().then(() => 'finished', e => 'error: ' + e.message); });
    await ta.waitForFunction(() => /Saving/.test(SC.session.ui.busy || ''));
    const tb = await newPage(ctx, fileURL);
    await ready(tb);
    await tb.click('text=Use this tab instead');
    await tb.waitForSelector('table.shelf tbody tr');
    await ev(tb, () => SC.session.whenReady());
    await ev(tb, () => { const s = SC.session.store; const i = Array.from(s.state.issues.values()).sort((x, y) => x.issueID.localeCompare(y.issueID))[0]; s.put('issue', Object.assign({}, i, { notes: 'B issue edit' })); });
    await settled(tb);
    const t0 = Date.now();
    await clickSave(tb);
    const waited = Date.now() - t0;
    expect(waited < 8000, 'the new tab\'s save finishes in ' + waited + ' ms, without waiting for the old tab\'s 30 s write');
    expect((await ev(tb, n => window.__SC_TEST_FS__.get(n), I)).indexOf('B issue edit') !== -1, 'and its edit is in the folder');
    expect(await ev(ta, () => Promise.race([window.__saveA, new Promise(r => setTimeout(() => r('still running'), 3000))])) === 'finished', 'the old tab\'s save has stopped'); }
  await ctx.close();

  step('Round 2, minor: a set-aside repeat of a deleted record is pointed out when saving');
  { const p = SC_csv.parse(LIB_A[C]); const h = p.rows[0]; const dupRow = p.rows[1].slice(); dupRow[h.indexOf('Item Title')] = 'THE SET-ASIDE COPY'; p.rows.push(dupRow);
    ctx = await newContext(browser, Object.assign({}, LIB_A, { [C]: SC_csv.serialize(p.rows, p.style) }));
    page = await newPage(ctx, fileURL);
    await ready(page); await openFolder(page);
    const cid = p.rows[1][h.indexOf('ContentID')];
    expect(await ev(page, n => (SC.session.store.state.files.get(n).setAside || []).length === 1, C), 'the repeated row is set aside');
    await ev(page, id => SC.session.store.remove('content', id), cid);
    await clickSave(page);
    expect(/will be read as that record the next time/.test(await message(page)), 'deleting the record it repeated is pointed out on saving');
    await ctx.close(); }
}

// ── Part B: the browser's real File System Access API (origin-private file system) ──
async function partB(browser) {
  const html = fs.readFileSync(app);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  try {
    step('Real folder API: open, save with backup, conflict, missing file, already written');
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { window.__SC_TEST_FS__ = { root: navigator.storage.getDirectory() }; });
    const page = await newPage(ctx, url);
    await ready(page);
    await ev(page, async files => {
      const root = await navigator.storage.getDirectory();
      for (const [n, t] of Object.entries(files)) { const fh = await root.getFileHandle(n, { create: true }); const w = await fh.createWritable(); await w.write(t); await w.close(); }
    }, LIB_A);
    const disk = n => ev(page, async name => { try { const root = await navigator.storage.getDirectory(); return await (await (await root.getFileHandle(name)).getFile()).text(); } catch (e) { return null; } }, n);
    const backups = () => ev(page, async () => { const out = {}; try { const b = await (await navigator.storage.getDirectory()).getDirectoryHandle('_backups'); for await (const d of b.values()) { out[d.name] = []; for await (const f of d.values()) out[d.name].push(f.name); } } catch (e) { /* none */ } return out; });
    await openFolder(page);
    expect(JSON.stringify(await counts(page)) === JSON.stringify({ titles: SC_count(LIB_A[T]), issues: SC_count(LIB_A[I]), contents: SC_count(LIB_A[C]) }), 'the real folder opens with every record');
    await editTitle(page, { generalNotes: 'real save' });
    await clickSave(page);
    if (verbose) console.error('  save message: ' + await message(page));
    expect((await disk(T)).indexOf('real save') !== -1, 'the file is written through the browser\'s file API');
    const bk = await backups();
    const stampDir = Object.keys(bk)[0];
    expect(stampDir && bk[stampDir].indexOf(T) !== -1, 'the replaced version is in _backups/' + stampDir);
    const readBack = (dir, name) => ev(page, async ([d, n]) => { const b = await (await navigator.storage.getDirectory()).getDirectoryHandle('_backups'); return await (await (await (await b.getDirectoryHandle(d)).getFileHandle(n)).getFile()).text(); }, [dir, name]);
    expect(await readBack(stampDir, T) === LIB_A[T], 'and it reads back byte for byte as the original (second review, F2-01)');
    expect(new RegExp('\\t' + reEsc(T) + '\\t' + reEsc(T) + '\\treplaced by the first save').test(await readBack(stampDir, 'BACKUPS.txt')), 'BACKUPS.txt in that folder says what the copy is');
    // A new session at once (reopening the folder): its copy goes elsewhere; the first stays.
    await ev(page, () => SC.storage.resetSessionBackups());
    const before2 = await disk(T);
    await editTitle(page, { generalNotes: 'real save, new session' });
    await clickSave(page);
    const bk2 = await backups();
    const dir2 = Object.keys(bk2).find(d => d !== stampDir);
    expect(dir2 && await readBack(dir2, T) === before2 && await readBack(stampDir, T) === LIB_A[T], 'a second session\'s copy goes into its own folder; the first copy is unchanged (' + dir2 + ')');
    // Changed elsewhere while open: saving backs that version up and says so.
    await ev(page, async n => { const root = await navigator.storage.getDirectory(); const fh = await root.getFileHandle(n); const t = await (await fh.getFile()).text(); const w = await fh.createWritable(); await w.write(t.replace('real save', 'edited in a spreadsheet')); await w.close(); }, T);
    await editTitle(page, { generalNotes: 'real save 2' });
    await clickSave(page);
    const m = await message(page);
    expect(/had been changed on disk since it was read; that version is kept as _backups\//.test(m), 'conflict reported with where the other version is kept');
    const kept = await ev(page, async () => { const b = await (await navigator.storage.getDirectory()).getDirectoryHandle('_backups'); for await (const d of b.values()) for await (const f of d.values()) { const t = await (await f.getFile()).text(); if (t.indexOf('edited in a spreadsheet') !== -1) return f.name; } return ''; });
    expect(!!kept, 'and the spreadsheet edit is in the backup folder (' + kept + ')');
    // A file removed from the real folder is not made again by a save.
    await ev(page, async n => { const root = await navigator.storage.getDirectory(); await root.removeEntry(n); }, C);
    await ev(page, n => { const s = SC.session.store; const c = Array.from(s.state.contents.values()).find(x => x._src === n); s.put('content', Object.assign({}, c, { notes: 'x' })); }, C);
    await clickSave(page);
    expect((await disk(C)) === null && /no longer in the folder/.test(await message(page)), 'a removed file is not written again');
    await ctx.close();

    // ── Independent check after review 2: bytes, encodings, a deleted backup folder ──
    step('Real folder API: a BOM is kept, a file not in UTF-8 is refused and left alone, backups are the bytes, a deleted _backups is made again');
    const ctx2 = await browser.newContext();
    await ctx2.addInitScript(() => { window.__SC_TEST_FS__ = { root: navigator.storage.getDirectory() }; });
    const pg = await newPage(ctx2, url);
    await ready(pg);
    const W = 'SCAT_' + A_SLUG + '_OTHERXXX-1990_ISSUES.csv';
    const cp1252 = Array.from(Buffer.from(LIB_A[I].split('\n').slice(0, 2).join('\n').replace(/[^\x00-\x7f]/g, '') + '\n', 'latin1')).concat([0x43, 0x61, 0x66, 0xE9, 0x0A]);
    await ev(pg, async ([files, t, w, wBytes]) => {
      const root = await navigator.storage.getDirectory();
      const put = async (n, data) => { const fh = await root.getFileHandle(n, { create: true }); const x = await fh.createWritable(); await x.write(data); await x.close(); };
      for (const [n, text] of Object.entries(files)) await put(n, n === t ? new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode(text)]) : text);
      await put(w, new Uint8Array(wBytes));
    }, [LIB_A, T, W, cp1252]);
    const bytesOf = n => ev(pg, async name => { const root = await navigator.storage.getDirectory(); return Array.from(new Uint8Array(await (await (await root.getFileHandle(name)).getFile()).arrayBuffer())); }, n);
    const tBefore = await bytesOf(T), wBefore = await bytesOf(W);
    await openFolder(pg);
    expect(await ev(pg, n => SC.session.ui.report.some(r => r.file === n && /not UTF-8/.test(r.msg)) && !SC.session.store.state.files.has(n), W), 'a file not in UTF-8 is not loaded, and the report says why');
    await editTitle(pg, { generalNotes: 'saved with its BOM' });
    await clickSave(pg);
    const tAfter = await bytesOf(T);
    expect(tAfter[0] === 0xEF && tAfter[1] === 0xBB && tAfter[2] === 0xBF && Buffer.from(tAfter).toString('utf8').indexOf('saved with its BOM') !== -1, 'a file with a byte-order mark keeps it when saved');
    const copyOf = (name) => ev(pg, async n => { const b = await (await navigator.storage.getDirectory()).getDirectoryHandle('_backups'); for await (const d of b.values()) for await (const f of d.values()) if (f.name === n) return Array.from(new Uint8Array(await (await f.getFile()).arrayBuffer())); return null; }, name);
    expect(JSON.stringify(await copyOf(T)) === JSON.stringify(tBefore), 'its backup is the original byte for byte, BOM included');
    expect(JSON.stringify(await bytesOf(W)) === JSON.stringify(wBefore), 'the file not in UTF-8 is left exactly as it was');
    await ev(pg, async () => { await (await navigator.storage.getDirectory()).removeEntry('_backups', { recursive: true }); });
    await ev(pg, () => { const s = SC.session.store; const i = Array.from(s.state.issues.values())[0]; s.put('issue', Object.assign({}, i, { notes: 'after _backups was deleted' })); });
    const iBefore = await bytesOf(I);
    await clickSave(pg);
    expect(/^Saved /.test(await message(pg)) && JSON.stringify(await copyOf(I)) === JSON.stringify(iBefore), 'with _backups deleted while open, the next save makes it again and keeps the copy: ' + (await message(pg)).slice(0, 80));
    await ctx2.close();
  } finally { server.close(); }
}

function SC_count(text) {   // data rows in a CSV text (no embedded-newline cells in these files' first column)
  globalThis.SC = globalThis.SC || {};
  if (!globalThis.SC.csv) require(path.join(__dirname, '..', 'js', 'core', 'csv.js'));
  return globalThis.SC.csv.parse(text).rows.length - 1;
}

(async () => {
  const browser = await chromium.launch();
  try {
    await partA(browser);
    await partB(browser);
  } finally { await browser.close(); }
  console.log(log.join('\n'));
  if (errors.length) { console.log(errors.join('\n')); failures += errors.length; }
  const n = log.filter(l => /^ {2}(ok|FAIL)/.test(l)).length;
  console.log(failures ? 'FAILED ' + failures + ' of ' + n + ' session checks' : 'PASSED ' + n + ' session checks');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log(log.join('\n')); console.log(errors.join('\n')); console.error(e.stack || e.message); process.exit(2); });
