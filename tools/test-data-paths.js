#!/usr/bin/env node
/* Slaughter Cataloger 3 — reading, writing and library paths in the browser (Stage A2, data
   integrity: the class 1 rows of the A1 audit that no test had reached).

   usage: node tools/test-data-paths.js <app.html>

   The invented library of tools/lib/integrity-library.js, saved once as the app saves it, in a test
   folder kept by the page in its own IndexedDB database. The folder can withhold permission, refuse
   it, and be changed "elsewhere" between steps. Each section starts from a new browser profile.
   What the app does was established from the code first; each section checks it:
   1  several versions of one file: the newest is loaded, the other listed and never written (CSV-08);
   2  extra columns: kept on every row when the file is saved, empty for a new record (CSV-10);
   3  a loaded file that no longer reads cleanly on reconnecting: its records kept and flagged, the
      file not written unless changed here, then backed up first (REC-07, LIB-11);
   4  permission not granted, on reconnecting and on saving: nothing read or written, the work kept,
      then saved once granted (SAV-16);
   5  without folder access: a download not confirmed ("Not yet") stays unsaved (SAV-10);
   6  a Contents file in the folder that was not loaded: nothing can be added under its name (CON-23);
   7  contents of an issue missing from the Issues file: listed, opened and edited (CON-02);
   8  a Parent ContentID that cannot be used: kept and written back; nesting the item replaces it,
      Undo brings it back (CON-17);
   9  a new library in a folder: refused where Slaughter Cataloger files are, made in a folder
      without them; the first save makes its Titles file (LIB-05);
   10 renaming the library and editing its note: which files change and are written, undo (LIB-17);
   11 Title Code and First Year locked once the title exists; ? on the year still possible (LIB-22);
   12 the duplicate warning: a new issue numbered like one in the run is recorded beside it, never
      over it (ISS-14);
   13 Roman numerals run into letters in short names: one Rewrite, one undo step, the Contents
      files' Issue Reference following (ISS-02);
   14 rows that could not be taken in: listed, shown and hidden, written back as they were (LIB-11).
   Fails on any page error or failed check. */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const ROOT = path.join(__dirname, '..');
const app = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'slaughter-cataloger-3.html'));
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SCx = globalThis.SC, R = SCx.records, S = SCx.schema, CSV = SCx.csv;
const L = require('./lib/integrity-library')(SCx);
const ID = L.ids, N = L.names, SLUG = L.slug;
const FT = N.titles, FA = N.authorities, LI = N.issues(ID.LEDGER), LC = N.contents(ID.LEDGER), HI = N.issues(ID.HERALD), HC = N.contents(ID.HERALD), MI = N.issues(ID.MODEL);
const FOLDER = 'Test Library';
// The invented library after one read and write, as the app saves it, so every file it does not
// change is written back byte for byte.
const BASE = (() => { const b = R.buildLibrary(Object.keys(L.files).map(n => R.readFile(n, L.files[n], {})), {}); return Object.fromEntries(Object.keys(L.files).map(n => [n, R.writeFile(b.state, n)])); })();
// A CSV's rows as { header: value } (the header row first, as an array).
const table = text => { const p = CSV.parse(text); return { head: p.rows[0], rows: p.rows.slice(1).filter(r => r.some(v => String(v).trim())).map(r => Object.fromEntries(p.rows[0].map((h, i) => [h, r[i] === undefined ? '' : r[i]]))), style: p.style }; };
// A CSV with some of its rows or columns changed (fn gets the parsed rows, the header row first).
const reshape = (text, fn) => { const p = CSV.parse(text); const rows = p.rows.map(r => r.slice()); fn(rows); return CSV.serialize(rows, p.style); };
const col = (rows, h) => rows[0].indexOf(h);
const rowOf = (rows, idHeader, id) => rows.find(r => r[col(rows, idHeader)] === id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const H_ISSUE = h => S.entities.issue.byKey.get(h).header;

// ── The test folder ─────────────────────────────────────────────────────
// Kept in its own IndexedDB database (so it survives a reload and every write has landed before
// the next page reads it), with controls: ctl.permission ('granted' | 'prompt'), ctl.deny.
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
  const ctl = async () => Object.assign({ permission: 'granted', deny: false }, (await get('ctl')) || {});
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
      values: async function* () { const n = nodeAt(await load(), parts); for (const f of Object.keys(n.files)) yield fileHandle(parts, f); for (const d of Object.keys(n.dirs)) yield dirHandle(parts.concat(d), d); },
      getFileHandle: async (f, o) => { if (!nodeAt(await load(), parts).files[f]) { if (!(o && o.create)) throw notFound(); await mutate(parts, n => { if (!n.files[f]) n.files[f] = { text: '', lastModified: Date.now() }; }); } return fileHandle(parts, f); },
      getDirectoryHandle: async (d, o) => { if (!nodeAt(await load(), parts).dirs[d]) { if (!(o && o.create)) throw notFound(); await mutate(parts, n => { if (!n.dirs[d]) n.dirs[d] = { files: {}, dirs: {} }; }); } return dirHandle(parts.concat(d), d); },
      removeEntry: async n => mutate(parts, x => { delete x.files[n]; delete x.dirs[n]; }) };
  }
  window.__SC_TEST_FS__ = {
    root: dirHandle([], folderName),
    tree: load,
    put: (n, text) => mutate([], t => { t.files[n] = { text, lastModified: Date.now() }; }),
    ctl: setCtl
  };
}

// ── Checks and the browser ──────────────────────────────────────────────
const log = [], errors = [];
let failures = 0, count = 0;
const step = s => log.push('· ' + s);
const expect = (cond, what, detail) => { count++; log.push((cond ? '  ok   ' : '  FAIL ') + what + (cond || detail === undefined ? '' : '\n         ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700))); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch();
  const contexts = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc3-paths-'));
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
  // A new browser profile on a folder holding these files; the folder opened unless noOpen.
  async function begin(files, opts) {
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
    contexts.push(ctx);
    await ctx.addInitScript(fakeFS, seedOf(files));
    const page = await newPage(ctx);
    await page.goto('file://' + app);
    await ready(page);
    if (!opts.noOpen) { await page.click('text=Open library folder'); await page.waitForFunction(() => SC.session.ui.mode === 'folder' && !SC.session.ui.busy); await page.evaluate(() => SC.session.flush()); }
    return { ctx, page };
  }
  const section = async (name, fn) => {
    step(name);
    try { await fn(); } catch (e) { failures++; log.push('  FAIL the section stopped: ' + String(e && e.message || e).split('\n')[0]); }
    while (contexts.length) await contexts.pop().close().catch(() => {});
  };
  // What the page and the folder hold.
  const disk = page => page.evaluate(async () => { const t = await window.__SC_TEST_FS__.tree(); return Object.fromEntries(Object.keys(t.files).map(n => [n, t.files[n].text])); });
  const backups = page => page.evaluate(async () => { const t = await window.__SC_TEST_FS__.tree(), out = {}; const b = t.dirs._backups; if (b) Object.keys(b.dirs).forEach(d => Object.keys(b.dirs[d].files).forEach(n => { out[d + '/' + n] = b.dirs[d].files[n].text; })); return out; });
  const message = page => page.evaluate(() => (SC.session.ui.message || {}).text || '');
  const dirty = page => page.evaluate(() => Array.from(SC.session.store.dirty).sort());
  const notes = page => page.evaluate(() => (SC.session.ui.report || []).map(r => ({ level: r.level, file: r.file || '', msg: r.msg })));
  const saveState = page => page.locator('.save-state').innerText().catch(() => '');
  const go = async (page, h) => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(200); };
  const rec = (page, kind, id) => page.evaluate(([k, i]) => { const r = SC.records.mapOfKind(SC.session.store.state, k).get(i); return r ? JSON.parse(JSON.stringify(r)) : null; }, [kind, id]);
  const sizes = page => page.evaluate(() => { const s = SC.session.store.state; return [s.titles.size, s.issues.size, s.contents.size, s.authorities.size].join('/'); });
  const put = (page, kind, id, patch, label) => page.evaluate(([k, i, p, l]) => { const s = SC.session.store; s.put(k, Object.assign({}, SC.records.mapOfKind(s.state, k).get(i), p), l); }, [kind, id, patch, label || 'test edit']);
  const save = async page => {
    await page.evaluate(() => { window.__m = SC.session.ui.message; });
    await page.click('.topbar button:has-text("Save")');
    await page.waitForFunction(() => SC.session.ui.message && SC.session.ui.message !== window.__m && !SC.session.ui.busy);
    return message(page);
  };
  const topButton = async (page, label) => { const b = page.locator('.topbar button:has-text("' + label + '")'); if (await b.isDisabled()) return false; await b.click(); await page.waitForTimeout(150); return true; };
  const undoLabel = page => page.evaluate(() => SC.session.store.undoLabel);
  // A reload in the same profile with the folder asking for permission again; the banner's button clicked.
  const reloadAsking = async (page, deny) => {
    await page.evaluate(d => window.__SC_TEST_FS__.ctl({ permission: 'prompt', deny: d }), !!deny);
    await page.reload(); await ready(page);
  };
  const allowAccess = async page => {
    await page.evaluate(() => { window.__m = SC.session.ui.message; });
    await page.click('button:has-text("Allow access")');
    await page.waitForFunction(() => SC.session.ui.message !== window.__m && !SC.session.ui.busy);
    return message(page);
  };
  // The folder as the app's reader reads it, as the app opens a folder.
  const readBack = files => { const res = Object.keys(files).filter(n => /\.csv$/i.test(n)).map(n => R.readFile(n, files[n], { allowEmpty: true, lastModified: 1000 })); return R.buildLibrary(res, {}); };

  // ── 1. Several versions of one file ─────────────────────────────────
  const COPY = 'SCAT_INTEGRITY-TEST_SPECLEDX-1875_ISSUES_copy.csv';
  await section('1. Several versions of one file on opening: the newest is loaded, the other listed and never written (CSV-08)', async () => {
    // An older copy of the Ledger's Issues file.
    let { page } = await begin(Object.assign({}, BASE, { [COPY]: { text: BASE[LI], lastModified: 500 } }));
    let st = await page.evaluate(() => ({ files: Array.from(SC.session.store.state.files.keys()), unloaded: Array.from(SC.session.store.unloaded.keys()) }));
    expect(st.files.indexOf(LI) !== -1 && st.files.indexOf(COPY) === -1 && st.unloaded.indexOf(COPY) !== -1, 'an older copy beside the Ledger\'s Issues file: the newer one (the original) is loaded, the copy is not', st);
    expect((await notes(page)).some(n => n.level === 'skip' && n.file === COPY && n.msg === 'Older copy of data in ' + LI + '. Not loaded.'), 'the load report says so: "Older copy of data in …_ISSUES.csv. Not loaded."');
    expect(await sizes(page) === '4/7/13/3', 'the library holds each issue once (4 titles, 7 issues, 13 contents items, 3 headings)', await sizes(page));
    await page.click('.report button.link');
    expect(/Not loaded/.test(await page.locator('.report').innerText()) && (await page.locator('.report').innerText()).indexOf(COPY) !== -1, 'the Library page lists it under "Not loaded"');
    expect(await page.evaluate(id => SC.session.store.fileForNew('issue', id), ID.LEDGER) === LI, 'a new Ledger issue would go into the loaded file, not the copy');
    await put(page, 'issue', ID.L1, { notes: 'Edited beside an older copy.' });
    let msg = await save(page);
    let d = await disk(page);
    expect(/^Saved SCAT_INTEGRITY-TEST_SPECLEDX-1875_ISSUES\.csv\./.test(msg) && d[COPY] === BASE[LI] && d[LI] !== BASE[LI] && table(d[LI]).rows.find(r => r.IssueID === ID.L1)[H_ISSUE('notes')] === 'Edited beside an older copy.',
      'an edit is saved into the loaded file; the copy is byte for byte what it was', msg);
    expect(Object.keys(await backups(page)).every(k => k.indexOf(COPY) === -1), 'the copy is not backed up or touched by the save');
    // A newer copy: it is the one loaded, and the original is the one left alone.
    const newer = reshape(BASE[LI], rows => { rowOf(rows, 'IssueID', ID.L1)[col(rows, H_ISSUE('notes'))] = 'From the newer copy.'; });
    ({ page } = await begin(Object.assign({}, BASE, { [COPY]: { text: newer, lastModified: 3000 } })));
    st = await page.evaluate(() => ({ files: Array.from(SC.session.store.state.files.keys()), unloaded: Array.from(SC.session.store.unloaded.keys()) }));
    expect(st.files.indexOf(COPY) !== -1 && st.files.indexOf(LI) === -1 && (await rec(page, 'issue', ID.L1)).notes === 'From the newer copy.', 'a newer copy beside it: the copy is loaded, the original is not', st);
    expect((await notes(page)).some(n => n.level === 'skip' && n.file === LI && n.msg === 'Older copy of data in ' + COPY + '. Not loaded.'), 'and the report names the original as the older copy');
    await put(page, 'issue', ID.L2, { notes: 'Edited in the newer copy.' });
    msg = await save(page);
    d = await disk(page);
    expect(d[LI] === BASE[LI] && d[COPY] !== newer && /^Saved SCAT_INTEGRITY-TEST_SPECLEDX-1875_ISSUES_copy\.csv\./.test(msg), 'the save writes the copy in use; the original is byte for byte what it was', msg);
  });

  // ── 2. Extra columns ────────────────────────────────────────────────
  await section('2. Extra columns: kept on every row when the file is saved (CSV-10)', async () => {
    const EXTRA = ['Local Shelf Mark', 'Checked By'];
    const withExtra = reshape(BASE[LI], rows => { rows[0].push(...EXTRA); rows.slice(1).forEach((r, k) => r.push('Shelf ' + (k + 1), k % 2 ? 'R. R.' : '')); });
    const { page } = await begin(Object.assign({}, BASE, { [LI]: withExtra }));
    expect((await notes(page)).some(n => n.level === 'info' && n.file === LI && n.msg === 'Extra columns kept as they are: Local Shelf Mark, Checked By.'), 'opening notes "Extra columns kept as they are: Local Shelf Mark, Checked By."');
    await put(page, 'issue', ID.L2, { notes: 'Checked against the shelf.' });
    await save(page);
    const want = reshape(withExtra, rows => { rowOf(rows, 'IssueID', ID.L2)[col(rows, H_ISSUE('notes'))] = 'Checked against the shelf.'; });
    let d = await disk(page);
    expect(d[LI] === want, 'an edit to one issue: the file is saved with both extra columns, every row\'s values in them unchanged, and only the edited cell different');
    // A new issue: its extra cells are empty, every other row's are kept.
    await go(page, '#/issues/' + ID.LEDGER);
    await page.click('.panel-head button:has-text("New issue")'); await page.waitForSelector('.draft-card');
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    await save(page);
    d = await disk(page);
    const t = table(d[LI]);
    expect(same(t.head.slice(-2), EXTRA) && t.rows.length === 5, 'a new issue recorded and saved: still both extra columns, now 5 rows', t.head.slice(-2));
    expect(t.rows.slice(0, 4).every((r, k) => r['Local Shelf Mark'] === 'Shelf ' + (k + 1) && r['Checked By'] === (k % 2 ? 'R. R.' : '')) && t.rows[4]['Local Shelf Mark'] === '' && t.rows[4]['Checked By'] === '',
      'the four issues keep their values; the new one has none');
    const back = readBack(d);
    expect(back.report.filter(r => r.level !== 'info').length === 0 && back.state.issues.size === 8, 'the saved folder reads back with no warning and 8 issues');
  });

  // ── 3. A loaded file that no longer reads cleanly ───────────────────
  await section('3. A loaded file that no longer reads cleanly on reconnecting: kept, flagged, not written unless changed here (REC-07)', async () => {
    const { page } = await begin(BASE);
    const broken = reshape(BASE[HI], rows => { const k = col(rows, 'Title Library Name'); rows.forEach(r => r.push(r[k])); });
    const why = 'Column "Title Library Name" appears twice. Not loaded: rename or remove one of them, then open the folder again.';
    await page.evaluate(([n, t]) => window.__SC_TEST_FS__.put(n, t), [HI, broken]);
    await reloadAsking(page);
    expect(await page.locator('button:has-text("Allow access")').count() === 1, 'reloaded with the folder asking for permission: the app offers "Allow access"');
    const msg = await allowAccess(page);
    expect(msg.indexOf(HI + ': No longer reads cleanly: ' + why + ' The records read from it before are kept here.') !== -1,
      'reconnecting says: "…_ISSUES.csv: No longer reads cleanly: Column "Title Library Name" appears twice. … The records read from it before are kept here."', msg);
    expect(await sizes(page) === '4/7/13/3' && (await rec(page, 'issue', ID.H1)) && (await rec(page, 'issue', ID.H2)), 'every record is still here, the Herald\'s two issues among them');
    await go(page, '#/library');
    const fp = await page.locator('.file-problems').innerText().catch(() => '');
    expect(/1 file in the folder no longer reads cleanly\./.test(fp) && fp.indexOf(HI) !== -1 && fp.indexOf(why) !== -1, 'the Library page: "1 file in the folder no longer reads cleanly.", with the file and why', fp);
    expect((await dirty(page)).length === 0, 'nothing is marked changed');
    await put(page, 'issue', ID.L1, { notes: 'An edit elsewhere in the library.' });
    let m2 = await save(page);
    let d = await disk(page);
    expect(d[HI] === broken && /^Saved SCAT_INTEGRITY-TEST_SPECLEDX-1875_ISSUES\.csv\./.test(m2), 'saving another change writes only that file: the one that does not read cleanly is left exactly as it is on disk', m2);
    await put(page, 'issue', ID.H1, { notes: 'An edit to the Herald.' });
    m2 = await save(page);
    d = await disk(page);
    const b = await backups(page), copy = Object.keys(b).find(k => k.split('/').pop().indexOf('SCAT_INTEGRITY-TEST_SAMHERAX-1880_ISSUES') === 0 && b[k] === broken);
    expect(m2.indexOf(HI + ' had been changed on disk since it was read; that version is kept as ') !== -1 && !!copy, 'changing a record in it and saving: the version on disk is backed up first, byte for byte, and the message says so', m2);
    expect(R.readFile(HI, d[HI], {}).ok && table(d[HI]).rows.find(r => r.IssueID === ID.H1)[H_ISSUE('notes')] === 'An edit to the Herald.', 'the file is then written from the records kept here, and reads cleanly');
    await page.reload(); await ready(page);
    expect(await page.locator('.file-problems').count() === 0 && !(await page.evaluate(n => (SC.session.store.state.files.get(n) || {}).unreadable, HI)), 'after a reload the file reads cleanly again and the warning is gone');
  });

  // ── 4. Permission not granted ───────────────────────────────────────
  await section('4. Permission not granted, on reconnecting and on saving (SAV-16)', async () => {
    const { page } = await begin(BASE);
    await put(page, 'issue', ID.L3, { notes: 'Waiting for permission.' });
    const before = await disk(page);
    await page.evaluate(() => window.__SC_TEST_FS__.ctl({ permission: 'prompt', deny: true }));
    let msg = await save(page);
    expect(msg === 'Grant access to ' + FOLDER + ' to save.', 'Save with permission refused: "Grant access to Test Library to save."', msg);
    expect(same(await disk(page), before) && same(await dirty(page), [LI]), 'nothing was written, and the file is still marked changed');
    expect(await page.locator('button:has-text("Allow access")').count() === 1, 'the app offers "Allow access"');
    msg = await allowAccess(page);
    expect(msg === 'Access to ' + FOLDER + ' was not granted. Your work is still here; you can grant access later.', '"Allow access" refused: "Access to Test Library was not granted. Your work is still here; you can grant access later."', msg);
    expect((await rec(page, 'issue', ID.L3)).notes === 'Waiting for permission.' && same(await disk(page), before), 'the edit is kept; the folder is untouched');
    await page.reload(); await ready(page);
    expect(await page.locator('button:has-text("Allow access")').count() === 1 && (await rec(page, 'issue', ID.L3)).notes === 'Waiting for permission.' && /1 file changed/.test(await saveState(page)),
      'after a reload, still refused: the work is restored from the browser, unsaved, and access is offered again');
    msg = await allowAccess(page);
    expect(/was not granted/.test(msg) && same(await disk(page), before), 'refused again: nothing read or written');
    await page.evaluate(() => window.__SC_TEST_FS__.ctl({ deny: false }));
    msg = await allowAccess(page);
    expect(msg === 'Connected to ' + FOLDER + '. Nothing had changed there.', 'granted: "Connected to Test Library. Nothing had changed there."', msg);
    msg = await save(page);
    const d = await disk(page);
    expect(/^Saved SCAT_INTEGRITY-TEST_SPECLEDX-1875_ISSUES\.csv\./.test(msg) && table(d[LI]).rows.find(r => r.IssueID === ID.L3)[H_ISSUE('notes')] === 'Waiting for permission.' && /All changes saved/.test(await saveState(page)),
      'then Save writes the edit made before the refusal', msg);
  });

  // ── 5. Without folder access: "Not yet" ─────────────────────────────
  await section('5. Without folder access, a download not confirmed stays unsaved ("Not yet") (SAV-10)', async () => {
    const { page } = await begin({}, { noOpen: true });
    const dir = path.join(tmp, 'files'); fs.mkdirSync(dir, { recursive: true });
    Object.keys(BASE).forEach(n => fs.writeFileSync(path.join(dir, n), BASE[n]));
    await page.setInputFiles('input[type=file]', Object.keys(BASE).map(n => path.join(dir, n)));
    await page.waitForSelector('table.shelf tbody tr');
    await put(page, 'title', ID.TRIAL, { generalNotes: 'Downloaded, not yet confirmed.' }, 'Edit general notes');
    // Clicks "Download changed files" and returns the download, or null when none comes (the button off, say).
    const download = async () => {
      const btn = page.locator('.topbar button:has-text("Download changed files")');
      if (await btn.isDisabled()) return null;
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), btn.click()]);
      return d;
    };
    let file = await download();
    const got = file ? fs.readFileSync(await file.path(), 'utf8') : '';
    expect(!!file && file.suggestedFilename() === FT && table(got).rows.find(r => r.TitleID === ID.TRIAL)['General Notes'] === 'Downloaded, not yet confirmed.', 'the changed Titles file is downloaded, holding the edit');
    await page.waitForSelector('.download-banner');
    await page.click('.download-banner button:has-text("Not yet")');
    expect(await page.locator('.download-banner').count() === 0 && /1 file changed/.test(await saveState(page)), '"Not yet": the notice goes, and the file is still "1 file changed"');
    page.dialogs.length = 0; page.answer = false;
    await page.click('text=Close library'); await page.waitForTimeout(200);
    page.answer = true;
    expect(page.dialogs.some(x => /1 file\(s\) have unsaved changes/.test(x)) && await page.evaluate(() => SC.session.ui.mode) === 'files', 'closing still asks about the unsaved file (declined: still open)', page.dialogs);
    file = await download();
    expect(!!file && file.suggestedFilename() === FT, 'Download again: the file is downloaded again');
    if (file) await page.click('.download-banner button:has-text("I\'ve replaced the files")');
    expect(/All changes saved/.test(await saveState(page)), 'confirmed this time: all changes saved');
  });

  // ── 6. A Contents file that was not loaded ──────────────────────────
  await section('6. A Contents file in the folder that was not loaded: nothing can be added under its name (CON-23)', async () => {
    const broken = reshape(BASE[LC], rows => { const k = col(rows, 'Title Library Slug'); rows.forEach(r => r.push(r[k])); });
    const { page } = await begin(Object.assign({}, BASE, { [LC]: broken }));
    const why = 'Column "Title Library Slug" appears twice. Not loaded: rename or remove one of them, then open the folder again.';
    const un = await page.evaluate(n => SC.session.store.unloaded.get(n) || '', LC);
    expect(un === why && await sizes(page) === '4/7/5/3', 'the Ledger\'s Contents file is not loaded (a column twice); the other 5 contents items are', un);
    await go(page, '#/contents/' + ID.LEDGER + '/' + ID.L4);
    await page.waitForSelector('table.grid-toc');
    const cell = page.locator('table.grid-toc tbody tr').last().locator('[data-cell$=":itemTitle"]');
    await cell.click(); await cell.fill('A New Item'); await cell.press('Enter'); await page.waitForTimeout(250);
    const msg = await message(page);
    expect(msg === LC + ' is in the folder but was not loaded (' + why + '). Anything new here would be saved under that name, so nothing can be added until that file is corrected or moved out of the folder; then reconnect or reopen the folder. See the Library page.',
      'typing a new item: refused, saying which file and why', msg);
    expect(await sizes(page) === '4/7/5/3' && (await dirty(page)).length === 0 && (await disk(page))[LC] === broken, 'no item is made, nothing is marked changed, and the file is untouched');
  });

  // ── 7. Contents of an issue missing from the Issues file ────────────
  await section('7. Contents of an issue missing from the Issues file: listed, opened and edited (CON-02)', async () => {
    const noL3 = reshape(BASE[LI], rows => { const k = rows.indexOf(rowOf(rows, 'IssueID', ID.L3)); rows.splice(k, 1); });
    const { page } = await begin(Object.assign({}, BASE, { [LI]: noL3 }));
    expect(await sizes(page) === '4/6/13/3' && (await rec(page, 'content', ID.L3a)).issueID === ID.L3, 'opened: 6 issues, and all 13 contents items, among them the two of the missing issue');
    await go(page, '#/contents/' + ID.LEDGER);
    const row = page.locator('tr:has-text("' + ID.L3 + '")');
    expect(await row.count() === 1 && /not in the Issues file/.test(await row.innerText()), 'the title\'s contents list shows the missing issue, tagged "not in the Issues file"');
    await row.click(); await page.waitForTimeout(250);
    expect(await page.evaluate(() => location.hash) === '#/contents/' + ID.LEDGER + '/' + ID.L3 && /This issue is not in the Issues file; its contents can still be edite/.test(await page.locator('.entry').first().innerText()),
      'opening it: "This issue is not in the Issues file; its contents can still be edited…"');
    const cell = page.locator('[data-cell="' + ID.L3a + ':itemTitle"]');
    await cell.click(); await cell.fill('Market Report, Revised'); await cell.press('Enter'); await page.waitForTimeout(200);
    expect((await rec(page, 'content', ID.L3a)).itemTitle === 'Market Report, Revised' && same(await dirty(page), [LC]), 'an item edited in the grid: only the Ledger\'s Contents file is marked changed');
    await save(page);
    const d = await disk(page), r = table(d[LC]).rows.find(x => x.ContentID === ID.L3a);
    expect(r['Item Title'] === 'Market Report, Revised' && r.IssueID === ID.L3 && d[LI] === noL3, 'saved: the item keeps its IssueID; the Issues file is byte for byte what it was');
  });

  // ── 8. A Parent ContentID that cannot be used ───────────────────────
  await section('8. A Parent ContentID that cannot be used: kept and written back; nesting replaces it; Undo brings it back (CON-17)', async () => {
    const LOST = ID.LEDGER + '-CZZZZZ2';
    const kept = reshape(BASE[LC], rows => { const r = rowOf(rows, 'ContentID', ID.L2d); r[col(rows, 'Parent ContentID')] = LOST; r[col(rows, 'Parent Item')] = 'Lost Section'; r[col(rows, 'N/A Fields')] = ''; });
    const { page } = await begin(Object.assign({}, BASE, { [LC]: kept }));
    let c = await rec(page, 'content', ID.L2d);
    expect(c.parentID === '' && c.parentKept === LOST, 'opened: the item is at the top level, its Parent ContentID kept as it is', [c.parentID, c.parentKept]);
    await put(page, 'content', ID.L1a, { itemTitle: 'Opening Remarks, Revised' });
    await save(page);
    let r = table((await disk(page))[LC]).rows.find(x => x.ContentID === ID.L2d);
    expect(r['Parent ContentID'] === LOST && r['Parent Item'] === 'Lost Section', 'saving another change to the file writes the kept Parent ContentID and Parent Item back unchanged');
    await go(page, '#/contents/' + ID.LEDGER + '/' + ID.L2);
    await page.waitForSelector('table.grid-toc tbody tr[data-item]');
    await page.click('[data-cell="' + ID.L2d + ':itemTitle"]'); await page.waitForTimeout(50);
    await page.click('.grid-tools button[title^="Make it part"]'); await page.waitForTimeout(150);
    c = await rec(page, 'content', ID.L2d);
    expect(c.parentID === ID.L2a && c.parentKept === '' && c.parentItem === 'Poetry' && await undoLabel(page) === 'Nest Notices', 'Nest: it becomes part of "Poetry", and the kept link is replaced (one undo step, "Nest Notices")', [c.parentID, c.parentKept, await undoLabel(page)]);
    await topButton(page, 'Undo');
    c = await rec(page, 'content', ID.L2d);
    expect(c.parentID === '' && c.parentKept === LOST && c.parentItem === 'Lost Section' && (await dirty(page)).length === 0, 'Undo: the kept link is back exactly, and nothing is marked changed');
    await topButton(page, 'Redo');
    await save(page);
    r = table((await disk(page))[LC]).rows.find(x => x.ContentID === ID.L2d);
    expect(r['Parent ContentID'] === ID.L2a && r['Parent Item'] === 'Poetry', 'Redo and save: the new parent is written');
    const back = readBack(await disk(page));
    expect(back.state.contents.get(ID.L2d).parentID === ID.L2a && !back.report.some(x => x.file === LC && x.level === 'warn'), 'read back: nested under "Poetry", with no warning about the link');
  });

  // ── 9. A new library in a folder ────────────────────────────────────
  await section('9. A new library in a folder: refused where Slaughter Cataloger files are, made where they are not (LIB-05)', async () => {
    let { page } = await begin(BASE, { noOpen: true });
    await page.click('text=Start a new library');
    await page.fill('#nl-name', 'Second Invented Library');
    expect(await page.inputValue('#nl-slug') === 'SECOND-INVENTED-LIBRARY', 'the slug is made from the name: SECOND-INVENTED-LIBRARY');
    await page.click('button:has-text("Choose an empty folder for it")'); await page.waitForTimeout(300);
    expect(await message(page) === 'That folder already holds Slaughter Cataloger files. Use Open library folder instead, or pick an empty folder.' && await page.evaluate(() => SC.session.ui.mode) === 'none',
      'a folder holding a library\'s files: refused, "That folder already holds Slaughter Cataloger files. …", and no library is open', await message(page));
    expect(same(await disk(page), BASE), 'that folder is byte for byte what it was');
    const OTHER = { 'contacts.csv': 'Name,Phone\nA. N. Other,555-0100\n' };
    ({ page } = await begin(OTHER, { noOpen: true }));
    await page.click('text=Start a new library');
    await page.fill('#nl-name', 'Second Invented Library');
    await page.fill('#nl-note', 'Made by the data-path test.');
    await page.click('button:has-text("Choose an empty folder for it")');
    await page.waitForFunction(() => SC.session.ui.mode === 'folder');
    expect(await page.evaluate(() => location.hash) === '#/library/new' && await page.evaluate(() => SC.session.store.state.library.slug) === 'SECOND-INVENTED-LIBRARY', 'a folder with no Slaughter Cataloger file (another CSV in it): the library is made there, and the new-title page opens');
    await page.fill('#f-canonicalTitle', 'The Invented Gazette'); await page.locator('#f-canonicalTitle').press('Tab');
    await page.fill('#f-firstYear', '1899'); await page.locator('#f-firstYear').press('Tab');
    await page.click('.sticky-actions button:has-text("Add title")'); await page.waitForTimeout(200);
    const T = 'SCAT_SECOND-INVENTED-LIBRARY_TITLES.csv';
    const msg = await save(page);
    const d = await disk(page);
    expect(msg.indexOf('Saved ' + T + '.') === 0 && d['contacts.csv'] === OTHER['contacts.csv'] && Object.keys(d).sort().join() === [T, 'contacts.csv'].sort().join(), 'the first save makes ' + T + '; the other CSV is untouched', msg);
    const t = table(d[T]).rows;
    expect(t.length === 1 && t[0]['Canonical Title'] === 'The Invented Gazette' && t[0]['Title Library Slug'] === 'SECOND-INVENTED-LIBRARY' && t[0]['Title Library Name'] === 'Second Invented Library' && t[0]['Title Library Note'] === 'Made by the data-path test.' && /^INVENTED-1899$|^[A-Z0-9]{8}-1899$/.test(t[0].TitleID),
      'its one row: the title, the library\'s slug, name and note, and a TitleID ending in 1899', t[0] && t[0].TitleID);
  });

  // ── 10. Renaming the library ────────────────────────────────────────
  await section('10. Renaming the library and editing its note: which files change, undo, save (LIB-17)', async () => {
    const { page } = await begin(BASE);
    await page.click('button:has-text("Library details")');
    await page.fill('#f-name', 'Integrity Test Library, Renamed'); await page.locator('#f-name').press('Enter'); await page.waitForTimeout(150);
    const all = Object.keys(BASE).sort();
    // Since the minor-UI round (O-1 of the data-safety round): only the files that carry the name are marked changed.
    expect(same(await dirty(page), [FT, HI, LI, MI].sort()) && await undoLabel(page) === 'Rename library', 'renamed: the four files that carry the library\'s name are marked changed (Titles and the Issues files), not the other four; one undo step "Rename library"', await dirty(page));
    await topButton(page, 'Undo');
    expect((await dirty(page)).length === 0 && await page.evaluate(() => SC.session.store.state.library.name) === 'Integrity Test Library', 'Undo: the old name back, nothing marked changed');
    await topButton(page, 'Redo');
    let msg = await save(page);
    let d = await disk(page);
    const carries = n => table(BASE[n]).head.indexOf('Title Library Name') !== -1;
    const written = all.filter(carries);
    expect(same(written, [FT, HI, LI, MI].sort()) && written.every(n => msg.indexOf(n) !== -1) && all.filter(n => !carries(n)).every(n => d[n] === BASE[n]),
      'saved: the four files that carry the library\'s name (Titles and the Issues files) are written; the Contents and Authorities files are left byte for byte', msg);
    const unchangedBut = (n, h) => { const a = table(BASE[n]), b = table(d[n]); return same(a.head, b.head) && a.rows.length === b.rows.length && a.rows.every((r, k) => Object.keys(r).every(x => x === h ? b.rows[k][x] === 'Integrity Test Library, Renamed' : b.rows[k][x] === r[x])); };
    expect(written.every(n => unchangedBut(n, 'Title Library Name')), 'in each, every row has the new name, and every other cell is as it was');
    expect(/All changes saved/.test(await saveState(page)), 'and nothing is left marked changed');
    await page.fill('#f-note', 'The note, edited.'); await page.locator('#f-note').press('Enter'); await page.waitForTimeout(150);
    expect(same(await dirty(page), [FT]), 'the note edited: only the Titles file is marked changed', await dirty(page));
    msg = await save(page);
    d = await disk(page);
    expect(msg.indexOf('Saved ' + FT + '.') === 0 && table(d[FT]).rows.every(r => r['Title Library Note'] === 'The note, edited.'), 'the note edited and saved: only the Titles file is written, every row with the new note', msg);
    const back = readBack(d);
    expect(back.state.library.name === 'Integrity Test Library, Renamed' && back.state.library.note === 'The note, edited.' && back.report.filter(x => x.level !== 'info').length === 0, 'read back: the new name and note, no warning');
  });

  // ── 11. Title Code and First Year locked ────────────────────────────
  await section('11. Title Code and First Year locked once the title exists (LIB-22)', async () => {
    const { page } = await begin(BASE);
    await go(page, '#/library/' + ID.LEDGER);
    await page.waitForSelector('#f-titleCode');
    expect(await page.locator('#f-titleCode').isDisabled() && await page.locator('#f-firstYear').isDisabled(), 'on the Ledger\'s page, Title Code and First Year cannot be typed in');
    const fieldOf = id => page.locator('.field:has(#' + id + ')');
    expect(/Part of the permanent TitleID SPECLEDX-1875\./.test(await fieldOf('f-titleCode').innerText()) && /Year is part of the TitleID; marking it \? is still possible\./.test(await fieldOf('f-firstYear').innerText()),
      'each says why: "Part of the permanent TitleID SPECLEDX-1875." and "Year is part of the TitleID; marking it ? is still possible."');
    expect(await fieldOf('f-titleCode').locator('.toggles').count() === 0 && await fieldOf('f-firstYear').locator('.toggles button:has-text("?")').count() === 1, 'Title Code has no ? or N/A; First Year keeps its ?');
    await fieldOf('f-firstYear').locator('.toggles button:has-text("?")').click(); await page.waitForTimeout(150);
    const t = await rec(page, 'title', ID.LEDGER);
    expect(t.titleID === ID.LEDGER && t.firstYear === '1875' && t.titleCode === 'SPECLEDX' && t.spec.indexOf('First Year of Publication (CE)') !== -1 && same(await dirty(page), [FT]),
      '? on the year: marked uncertain, the TitleID, code and year unchanged; only the Titles file changes');
    await save(page);
    const r = table((await disk(page))[FT]).rows.find(x => x.TitleID === ID.LEDGER);
    expect(r['Title Code'] === 'SPECLEDX' && r['First Year of Publication (CE)'] === '1875' && /^(TRUE|true|Yes|yes|1)$/.test(r['First Year Speculative'] || ''), 'saved: the same TitleID, code and year, the year marked speculative', r['First Year Speculative']);
  });

  // ── 12. The duplicate warning ───────────────────────────────────────
  await section('12. A new issue numbered like one in the run: warned, and recorded beside it, never over it (ISS-14)', async () => {
    const { page } = await begin(BASE);
    const l2 = await rec(page, 'issue', ID.L2);
    await go(page, '#/issues/' + ID.LEDGER);
    await page.click('.panel-head button:has-text("New issue")'); await page.waitForSelector('.draft-card');
    await page.fill('#f-number', '2'); await page.locator('#f-number').press('Tab');
    await page.fill('#f-year', '1875'); await page.locator('#f-year').press('Tab'); await page.waitForTimeout(150);
    const warn = await page.locator('.sticky-actions .warn-text').innerText().catch(() => '');
    expect(warn === 'Already in the run: ' + l2.shortname + '. Record it anyway if this is another copy or state.', 'the draft says "Already in the run: Specimen Ledger No. 2. Record it anyway if this is another copy or state."', warn);
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    const issues = await page.evaluate(id => SC.session.store.issuesOfTitle(id).map(i => i.issueID), ID.LEDGER);
    const added = issues.filter(i => [ID.L1, ID.L2, ID.L3, ID.L4].indexOf(i) === -1);
    expect(issues.length === 5 && added.length === 1 && same(await rec(page, 'issue', ID.L2), l2), 'recorded anyway: a fifth issue with its own IssueID; no. 2 is exactly as it was');
    await save(page);
    const t = table((await disk(page))[LI]);
    const was = table(BASE[LI]).rows.find(r => r.IssueID === ID.L2);
    expect(t.rows.length === 5 && same(t.rows.find(r => r.IssueID === ID.L2), was) && t.rows.find(r => r.IssueID === added[0])[H_ISSUE('number')] === '2', 'saved: 5 rows; no. 2\'s row is cell for cell what it was; the new row is also no. 2');
  });

  // ── 13. Roman numerals in short names ───────────────────────────────
  await section('13. Roman numerals run into letters in short names: one Rewrite, one undo step (ISS-02)', async () => {
    const SN = H_ISSUE('shortname'), VOL = H_ISSUE('volume');
    const herald = reshape(BASE[HI], rows => rows.slice(1).forEach(r => { const n = r[col(rows, H_ISSUE('number'))]; r[col(rows, VOL)] = 'XIII'; r[col(rows, SN)] = 'VXIIIN' + n; }));
    const heraldC = reshape(BASE[HC], rows => rows.slice(1).forEach(r => { r[col(rows, 'Issue Reference')] = 'VXIIIN' + (r[col(rows, 'IssueID')] === ID.H1 ? '1' : '2'); }));
    const { page } = await begin(Object.assign({}, BASE, { [HI]: herald, [HC]: heraldC }));
    await go(page, '#/issues/' + ID.HERALD);
    const bar = page.locator('.message.warn:has-text("run a Roman numeral")');
    expect(await bar.count() === 1 && /2 short names run a Roman numeral into the letters beside it, as in VXIIIN1/.test(await bar.innerText()), 'the Issues page says "2 short names run a Roman numeral into the letters beside it, as in VXIIIN1 …"');
    await bar.locator('button:has-text("Rewrite them")').click(); await page.waitForTimeout(200);
    const names = [(await rec(page, 'issue', ID.H1)).shortname, (await rec(page, 'issue', ID.H2)).shortname];
    expect(same(names, ['V.XIII N1', 'V.XIII N2']) && await undoLabel(page) === 'Separate Roman numerals in 2 short names', 'Rewrite: both become V.XIII N1 and V.XIII N2, in one undo step', names);
    expect(same(await dirty(page), [HC, HI].sort()), 'the Herald\'s Issues file and its Contents file (which carries each issue\'s short name) are marked changed');
    await topButton(page, 'Undo');
    expect(same([(await rec(page, 'issue', ID.H1)).shortname, (await rec(page, 'issue', ID.H2)).shortname], ['VXIIIN1', 'VXIIIN2']) && (await dirty(page)).length === 0, 'one Undo puts both back, and nothing is marked changed');
    await topButton(page, 'Redo');
    await save(page);
    const d = await disk(page), ti = table(d[HI]), tc = table(d[HC]);
    expect(same(ti.rows.map(r => r[SN]), ['V.XIII N1', 'V.XIII N2']) && tc.rows.every(r => r['Issue Reference'] === (r.IssueID === ID.H1 ? 'V.XIII N1' : 'V.XIII N2')), 'saved: the Issues rows have the new short names, and the Contents rows their Issue Reference');
    const was = table(herald).rows;
    expect(ti.rows.every((r, k) => Object.keys(r).every(h => h === SN || r[h] === was[k][h])), 'every other cell of the Issues file is as it was');
    expect(await page.locator('.message.warn:has-text("run a Roman numeral")').count() === 0, 'the warning is gone');
  });

  // ── 14. Rows that could not be taken in ─────────────────────────────
  await section('14. Rows that could not be taken in: listed, shown and hidden, written back as they were (LIB-11)', async () => {
    let repeat = null;
    const withRepeat = reshape(BASE[LI], rows => { repeat = rowOf(rows, 'IssueID', ID.L1).slice(); repeat[col(rows, H_ISSUE('notes'))] = 'A second row with the same IssueID.'; rows.push(repeat); });
    const { page } = await begin(Object.assign({}, BASE, { [LI]: withRepeat }));
    await go(page, '#/library');
    const box = page.locator('.file-problems');
    expect(/1 row in 1 file could not be taken in\./.test(await box.innerText()) && await box.locator('button:has-text("Show the rows")').count() === 1, 'the Library page: "1 row in 1 file could not be taken in.", with "Show the rows"');
    await box.locator('button:has-text("Show the rows")').click();
    const shown = await box.innerText();
    expect(shown.indexOf(LI + ' row 6:') !== -1 && /already used/.test(shown) && await box.locator('button:has-text("Hide the rows")').count() === 1, 'shown: the file, row 6 and why (its IssueID already used); the button now hides them');
    await box.locator('button:has-text("Hide the rows")').click();
    expect((await box.innerText()).indexOf(LI + ' row 6:') === -1, 'hidden again');
    expect(await sizes(page) === '4/7/13/3' && (await rec(page, 'issue', ID.L1)).notes !== 'A second row with the same IssueID.', 'the record read is the first row\'s; the repeat is not loaded');
    await put(page, 'issue', ID.L4, { notes: 'Saved beside a row set aside.' });
    await save(page);
    const rows = CSV.parse((await disk(page))[LI]).rows.filter(r => r.some(v => String(v).trim()));
    expect(same(rows[rows.length - 1], repeat) && rows.length === 6, 'saved: the set-aside row is written back at the end, cell for cell as it was read');
  });

  expect(errors.length === 0, 'no page errors', errors.join('; '));
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(log.join('\n'));
  if (failures) { console.log('FAILED ' + failures + ' of ' + count + ' data-path browser checks'); process.exit(1); }
  console.log('PASSED ' + count + ' data-path browser checks');
})();
