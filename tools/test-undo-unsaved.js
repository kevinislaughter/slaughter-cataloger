#!/usr/bin/env node
/* Slaughter Cataloger 3 — keyboard Undo and Redo, and unsaved work when leaving, in Chromium
   (Stage A2, data integrity).

   usage: node tools/test-undo-unsaved.js <app.html> [screenshot-dir]

   On the invented library of tools/lib/integrity-library.js, in a folder held by this test
   (tools/lib/held-folder.js), each section from a fresh open:
   1. Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y (and ⌘, as Meta) on library operations: an edit, Record issue,
      Delete issue, a Contents cell, a select; nothing to undo.
   2. In a text box: the browser's own text undo while typing, the library's undo when nothing is
      typed; the search boxes never undo the library; Escape puts back the record's value; leaving a
      field writes exactly what it shows, or nothing. D-K1 (A2 keyboard batch): after typing that
      leaves a field showing the record's value (typed and deleted, or taken back with the browser's
      undo), Ctrl+Z undid the library but the field kept the old text and wrote it back on leaving,
      reversing the Undo and losing Redo; in the form fields and in Contents cells.
   3. Leaving or reloading the page: the browser's question when files are unsaved, and (D-K2) when a
      field holds typing not yet committed; declined: everything as it was; accepted: the working
      copy restored, the typing gone; none when nothing is unsaved; in-app navigation keeps typing.
   4. Close library and Open another folder with unsaved changes: the question word for word;
      declined: records, marked files, undo history, working copy and folder exactly as they were;
      accepted: the unsaved changes discarded as the question says, the folder untouched, the working
      copy holding what is now open; the same folder and another invented library.
   5. Ctrl+S, Undo across a save, Redo back to the saved state, reload, a fresh open.
   Files are compared byte for byte with what the app's own writer gives for the expected records,
   and listed by SHA-256 at each point (deterministic snapshots). */
'use strict';
const path = require('path'), fs = require('fs'), crypto = require('crypto');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const ROOT = path.join(__dirname, '..');
const app = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'slaughter-cataloger-3.html'));
const shots = process.argv[3] || '';
if (shots) fs.mkdirSync(shots, { recursive: true });
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const R = globalThis.SC.records, Sch = globalThis.SC.schema;
const L = require('./lib/integrity-library')(globalThis.SC);
const H = require('./lib/held-folder');
const ID = L.ids, N = L.names, ORIGINAL = L.files;
const FT = N.titles, LI = N.issues(ID.LEDGER), LC = N.contents(ID.LEDGER);

const log = [], errors = [];
let failures = 0, count = 0;
const step = s => log.push('· ' + s);
const expect = (cond, what, detail) => { count++; log.push((cond ? '  ok   ' : '  FAIL ') + what + (cond || detail === undefined ? '' : '\n         ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 900))); if (!cond) failures++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const snapshotOf = texts => Object.keys(texts).sort().map(n => n + ' ' + sha(texts[n]).slice(0, 16));

// What the app's reader makes of a folder: every record, by kind and ID.
function readerOf(files) {
  const b = R.buildLibrary(Object.keys(files).map(n => R.readFile(n, files[n], { allowEmpty: true })), {});
  const recs = {};
  ['titles', 'issues', 'contents', 'authorities'].forEach(k => { recs[k] = {}; Array.from(b.state[k].keys()).sort().forEach(id => { recs[k][id] = JSON.parse(JSON.stringify(b.state[k].get(id))); }); });
  return { recs, state: b.state };
}
// The folder after saving records changed by `mutate(state)`: the files in `written` as the app's
// writer writes them from those records, every other file as it was.
function savedFolder(mutate, written) {
  const st = readerOf(ORIGINAL).state;
  mutate(st);
  const out = Object.assign({}, ORIGINAL);
  written.forEach(n => { out[n] = R.writeFile(st, n); });
  return out;
}
const withPublisher = v => st => st.titles.set(ID.LEDGER, R.freezeRec(Object.assign({}, st.titles.get(ID.LEDGER), { publisher: v })));
// Another invented library, for Open another folder: one title.
function otherLibrary() {
  const st = globalThis.SC.emptyState();
  st.library = Object.freeze({ slug: 'OTHER-TEST', name: 'Other Test Library', note: 'Invented for the keyboard tests.' });
  const ft = R.defaultFileName('title', 'OTHER-TEST');
  st.files.set(ft, { name: ft, kind: 'title', extraHeaders: [], hash: '', lastModified: 0, schemaVersion: Sch.VERSION, setAside: [] });
  const t = { spec: [], na: [], speculative: false };
  Sch.entities.title.fields.forEach(c => { t[c.key] = c.type === 'bool' ? false : ''; });
  Object.assign(t, { titleID: 'OTHGAZEX-1890', titleCode: 'OTHGAZEX', firstYear: '1890', canonicalTitle: 'The Other Gazette', _src: ft, entryOrder: 1 });
  st.titles.set(t.titleID, R.freezeRec(t));
  return { [ft]: R.writeFile(st, ft) };
}

(async () => {
  const browser = await chromium.launch();
  let run, page, answer = true;
  const dialogs = [];
  const onPage = p => {
    p.on('pageerror', e => errors.push('page error: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::/.test(m.text())) errors.push('console: ' + m.text()); });
    p.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); if (answer) d.accept(); else d.dismiss(); });
    p.setDefaultTimeout(8000);
  };
  const section = async (name, fn) => {
    step(name);
    answer = true;
    try { await fn(); } catch (e) { failures++; log.push('  FAIL the section stopped: ' + String(e && e.message || e).split('\n')[0]); }
  };
  const start = async files => { if (run) await run.close(); run = await H.open(browser, app, files || ORIGINAL, { onPage }); page = run.page; };
  const reopen = async () => { run = await run.reopen(); page = run.page; };
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(200); };
  const key = async k => { await page.keyboard.press(k); await page.waitForTimeout(120); };
  const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
  const pageRecs = () => page.evaluate(() => {
    const s = SC.session.store.state, o = {};
    ['titles', 'issues', 'contents', 'authorities'].forEach(k => { o[k] = {}; Array.from(s[k].keys()).sort().forEach(id => { o[k][id] = JSON.parse(JSON.stringify(s[k].get(id))); }); });
    return o;
  });
  const st = () => page.evaluate(() => ({ dirty: Array.from(SC.session.store.dirty).sort(), undo: SC.session.store.undoLabel, redo: SC.session.store.redoLabel, mode: SC.session.ui.mode }));
  const pub = () => page.evaluate(t => SC.session.store.state.titles.get(t).publisher, ID.LEDGER);
  const fieldOf = sel => page.evaluate(s => { const e = document.querySelector(s); return e ? { value: e.value, pending: e.getAttribute('data-pending') } : null; }, sel);
  const titlePage = async () => { await go('#/library/' + ID.LEDGER); await page.waitForSelector('#f-publisher'); };
  // Type into a field and leave it with Enter: one committed edit.
  const commitPublisher = async v => { await titlePage(); await page.click('#f-publisher'); await page.keyboard.type(v); await key('Enter'); };
  const save = async () => {
    await page.evaluate(() => { window.__m = SC.session.ui.message; });
    await page.click('.topbar button:has-text("Save")');
    await page.waitForFunction(() => SC.session.ui.message && SC.session.ui.message !== window.__m && !SC.session.ui.busy);
    return page.evaluate(() => (SC.session.ui.message || {}).text || '');
  };
  // The folder held by the test, byte for byte, against an expected folder.
  const folderIs = (expected, what) => {
    const now = run.texts();
    const ok = same(Object.keys(now).sort(), Object.keys(expected).sort()) && Object.keys(expected).every(n => now[n] === expected[n]);
    expect(ok, what + ': the folder byte for byte as expected [' + snapshotOf(now).join(', ') + ']', { now: snapshotOf(now), expected: snapshotOf(expected) });
  };
  const S0 = readerOf(ORIGINAL).recs;
  const edited = readerOf(savedFolder(withPublisher('Alpha Press'), [FT, LI])).recs;
  const DIRTY = [LI, FT].sort();
  const waitLoaded = () => page.waitForFunction(() => SC.session && SC.session.ui.mode === 'folder' && !SC.session.ui.busy && SC.session.ui.access === 'owner');
  // Reload; `accept` answers the browser's question if it asks. Returns the questions asked.
  const reload = async accept => {
    dialogs.length = 0; answer = accept;
    let done = true;
    await page.reload({ timeout: accept ? 15000 : 2500 }).catch(() => { done = false; });
    answer = true;
    if (done) { await waitLoaded().catch(() => {}); await page.waitForTimeout(300); }
    return { asked: dialogs.filter(d => /^beforeunload/.test(d)).length, done };
  };
  const working = () => page.evaluate(async () => { await SC.session.flush(); const w = await SC.storage.working.read(); const s = w && w.session && w.session.snapshot; return s ? { slug: s.library.slug, titles: s.titles.length, dirty: (s.dirty || []).slice().sort() } : null; });

  // ════ 1. Library operations ════
  await section('1. Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y and their ⌘ forms undo and redo library operations', async () => {
    await start();
    expect(same(await pageRecs(), S0), 'opened: the records exactly as the app\'s reader reads the folder');
    await commitPublisher('Alpha Press');
    expect(same(await pageRecs(), edited) && same((await st()).dirty, DIRTY), 'an edit committed with Enter: the publisher, and the Titles and Issues files marked changed (the issues inherit it)');
    await page.evaluate(() => document.activeElement.blur());
    for (const [u, r] of [['Control+z', 'Control+Shift+z'], ['Control+z', 'Control+y'], ['Meta+z', 'Meta+Shift+z'], ['Meta+z', 'Meta+y']]) {
      await key(u);
      const a = await st();
      expect(same(await pageRecs(), S0) && a.dirty.length === 0 && a.redo === 'Edit publisher', u + ' (focus on the page): every record exactly as opened, nothing marked changed, Redo offers "Edit publisher"', a);
      await key(r);
      const b = await st();
      expect(same(await pageRecs(), edited) && same(b.dirty, DIRTY) && b.undo === 'Edit publisher' && b.redo === '', r + ': the edit again, record for record; the same files marked changed', b);
    }
    await page.focus('#f-catalogingStatus');
    await key('Control+z');
    expect(same(await pageRecs(), S0), 'Ctrl+Z with a select focused undoes the library (a select takes no typing)');
    await key('Control+y');
    // Record issue, then Ctrl+Z from the next draft (its first field focused, nothing typed).
    await go('#/issues/' + ID.LEDGER + '/' + ID.L4); await page.waitForSelector('.issue-form');
    await page.click('.sticky-actions button:has-text("New issue after this")'); await page.waitForSelector('.draft-card');
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    await page.waitForTimeout(200);
    const recorded = await pageRecs();
    const added = Object.keys(recorded.issues).filter(i => !(i in edited.issues));
    expect(added.length === 1, 'Record issue: one issue added (' + added[0] + ')');
    const focusIn = await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-sc-field') && document.activeElement.getAttribute('data-pending') !== 'true');
    expect(focusIn, 'the next draft is ready, its first field focused with nothing typed');
    await key('Control+z');
    expect(same(await pageRecs(), edited) && (await st()).redo.indexOf('Record issue') === 0, 'Ctrl+Z there: the recorded issue is gone, every other record exactly as before; Redo offers it');
    await key('Control+Shift+z');
    expect(same(await pageRecs(), recorded), 'Ctrl+Shift+Z: the issue recorded again, record for record (the same IssueID)');
    // Delete issue (with its contents), then Ctrl+Z / Ctrl+Y.
    await go('#/issues/' + ID.LEDGER + '/' + ID.L3); await page.waitForSelector('.issue-form');
    dialogs.length = 0;
    await page.click('.sticky-actions button:has-text("Delete issue")'); await page.waitForTimeout(300);
    const deleted = await pageRecs();
    expect(!(ID.L3 in deleted.issues) && !(ID.L3a in deleted.contents) && !(ID.L3b in deleted.contents), 'Delete issue: no. 3 and its two contents items removed');
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await key('Control+z');
    expect(same(await pageRecs(), recorded), 'Ctrl+Z: no. 3 and its contents back, exactly as they were');
    await key('Control+y');
    expect(same(await pageRecs(), deleted), 'Ctrl+Y: deleted again, exactly');
    // Nothing to undo.
    await start();
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await key('Control+z'); await key('Control+Shift+z'); await key('Control+y');
    const z = await st();
    expect(same(await pageRecs(), S0) && z.dirty.length === 0 && z.undo === '' && z.redo === '', 'nothing to undo or redo: the keys change nothing', z);
    folderIs(ORIGINAL, 'nothing saved in this section');
  });

  // ════ 2. Text boxes ════
  await section('2. In a text box: the browser\'s own undo while typing, the library\'s when nothing is typed (D-K1)', async () => {
    await start();
    await commitPublisher('Alpha Press');
    await page.keyboard.type(' Two');
    expect(same(await fieldOf('#f-publisher'), { value: 'Alpha Press Two', pending: 'true' }), 'typing more: the field holds " Two", not yet committed');
    await key('Control+z');
    const a = await st();
    expect(await pub() === 'Alpha Press' && a.undo === 'Edit publisher' && a.redo === '', 'Ctrl+Z while typing is the browser\'s text undo: the library is not undone', a);
    await key('Control+Shift+z');
    expect(await pub() === 'Alpha Press' && (await st()).redo === '', 'Ctrl+Shift+Z while typing is the browser\'s too: the library is not redone');
    await page.keyboard.type('!');
    await key('Escape');
    expect(same(await fieldOf('#f-publisher'), { value: 'Alpha Press', pending: null }) && await pub() === 'Alpha Press', 'Escape: the field shows the record\'s value again; nothing written');
    // D-K1, a form field: typed and deleted, then Ctrl+Z.
    await start();
    await commitPublisher('Alpha Press');
    await page.keyboard.type('x'); await key('Backspace');
    await key('Control+z');
    const b = await st();
    expect(await pub() === '' && b.redo === 'Edit publisher' && b.dirty.length === 0, 'D-K1: a letter typed and deleted, then Ctrl+Z: the edit undone, nothing marked changed', b);
    expect(same(await fieldOf('#f-publisher'), { value: '', pending: null }), 'D-K1: the field shows the undone value (before the repair it kept "Alpha Press")', await fieldOf('#f-publisher'));
    await key('Tab');
    const c = await st();
    expect(await pub() === '' && c.redo === 'Edit publisher' && c.undo === '' && c.dirty.length === 0, 'D-K1: leaving the field writes nothing: the Undo stands and Redo is kept (before the repair "Alpha Press" was written back as a new edit)', c);
    await key('Control+y');
    expect(await pub() === 'Alpha Press' && same(await fieldOf('#f-publisher'), { value: 'Alpha Press', pending: null }), 'Ctrl+Y: the edit again, shown in the field');
    // D-K1 by the browser's own undo: leave, come back, type more, Ctrl+Z twice.
    await start();
    await titlePage();
    await page.click('#f-publisher'); await page.keyboard.type('Alpha Press'); await key('Tab');
    await page.click('#f-publisher'); await key('End'); await page.keyboard.type(' Two');
    await key('Control+z');
    expect(same(await fieldOf('#f-publisher'), { value: 'Alpha Press', pending: null }) && await pub() === 'Alpha Press', 'back in the field, " Two" typed, Ctrl+Z: the browser takes back " Two"; the library is untouched');
    await key('Control+z');
    expect(await pub() === '' && same(await fieldOf('#f-publisher'), { value: '', pending: null }), 'Ctrl+Z again: the library\'s undo; the field shows the undone value', await fieldOf('#f-publisher'));
    await key('Tab');
    expect(await pub() === '' && (await st()).redo === 'Edit publisher', 'leaving the field writes nothing; Redo is kept');
    // The same in a long field (textarea).
    await page.click('#f-generalNotes'); await page.keyboard.type('A note.'); await key('Tab');
    await page.click('#f-generalNotes'); await key('End'); await page.keyboard.type(' More.');
    await key('Control+z'); await key('Control+z');
    const ta = await page.evaluate(t => [SC.session.store.state.titles.get(t).generalNotes, document.querySelector('#f-generalNotes').value], ID.LEDGER);
    expect(same(ta, ['', '']), 'in a long field (General notes): the same, the undone value shown', ta);
    await key('Tab');
    expect(await page.evaluate(t => SC.session.store.state.titles.get(t).generalNotes, ID.LEDGER) === '' && (await st()).redo === 'Edit general notes', 'and leaving it writes nothing');
    // D-K1 in a Contents cell.
    await go('#/contents/' + ID.LEDGER + '/' + ID.L1); await page.waitForSelector('table.grid-toc');
    const cell = '[data-cell="' + ID.L1a + ':itemTitle"]';
    const it = () => page.evaluate(id => SC.session.store.state.contents.get(id).itemTitle, ID.L1a);
    await page.click(cell); await key('End'); await page.keyboard.type(' Revised'); await key('Enter');
    expect(await it() === 'Opening Remarks Revised', 'a Contents cell edited ("Opening Remarks Revised")');
    await page.click(cell); await key('End'); await page.keyboard.type('!');
    await key('Control+z');
    expect(await it() === 'Opening Remarks Revised' && same(await fieldOf(cell), { value: 'Opening Remarks Revised', pending: null }), 'typing "!", Ctrl+Z: the browser takes it back; the library is untouched');
    await key('Control+z');
    expect(await it() === 'Opening Remarks' && same(await fieldOf(cell), { value: 'Opening Remarks', pending: null }), 'D-K1 in the grid: Ctrl+Z again undoes the edit and the cell shows it (before the repair it kept the old text)', await fieldOf(cell));
    await key('Tab');
    const d = await st();
    expect(await it() === 'Opening Remarks' && d.redo.indexOf('Edit item title') === 0, 'leaving the cell writes nothing; Redo is kept', d);
    // The search boxes never undo the library (from a fresh open).
    await start();
    await commitPublisher('Alpha Press');
    await page.click('#top-search'); await page.keyboard.type('led'); await key('Control+z');
    expect(await pub() === 'Alpha Press' && (await st()).undo === 'Edit publisher', 'in the search box, Ctrl+Z is the browser\'s text undo only: the library is not undone');
    await key('Escape');
    await go('#/library'); await page.waitForSelector('input.search');
    await page.click('input.search'); await key('Control+z');
    expect(await pub() === 'Alpha Press', 'in the Find-a-title box (empty), Ctrl+Z does not undo the library either');
    // Whatever happens in a field, leaving it writes exactly what it shows, or nothing.
    await titlePage();
    await page.click('#f-publisher'); await key('End'); await page.keyboard.type(' Ltd'); await key('Control+z'); await key('Control+z');
    const shown = (await fieldOf('#f-publisher')).value;
    await key('Tab');
    expect(await pub() === shown, 'after any mix of typing and Ctrl+Z, leaving the field writes exactly what it showed ("' + shown + '")');
    folderIs(ORIGINAL, 'nothing saved in this section');
  });

  // ════ 3. Leaving the page ════
  await section('3. Leaving or reloading the page: unsaved files, typing not committed (D-K2), nothing unsaved', async () => {
    await start();
    await page.click('.lib-name'); // the page has been used (browsers ask only then)
    const r0 = await reload(true);
    expect(r0.asked === 0 && r0.done, 'nothing unsaved: a reload asks nothing');
    await titlePage();
    await page.click('#f-publisher'); await page.keyboard.type('Typed Only');
    const r1 = await reload(false);
    expect(r1.asked === 1 && !r1.done, 'D-K2: text typed and not committed (nothing marked changed): leaving asks first (before the repair it did not, and the text was lost)', r1);
    expect(same(await fieldOf('#f-publisher'), { value: 'Typed Only', pending: 'true' }) && await pub() === '', 'declined: the page stays, the text still in the field, nothing written');
    await key('Tab');
    expect(await pub() === 'Typed Only' && same((await st()).dirty, DIRTY), 'and leaving the field commits it as usual');
    await key('Control+z');
    await page.click('#f-publisher'); await page.keyboard.type('Typed Only');
    const r2 = await reload(true);
    expect(r2.asked === 1 && r2.done && await pub() === '' && (await st()).dirty.length === 0, 'accepted: the page reloads; the typing is gone (as the question warns), nothing else changed', r2);
    folderIs(ORIGINAL, 'after the reload');
    // Unsaved files.
    await commitPublisher('Alpha Press');
    const before = await st();
    const r3 = await reload(false);
    expect(r3.asked === 1 && !r3.done, 'files unsaved: leaving asks first', r3);
    expect(same(await pageRecs(), edited) && same(await st(), before), 'declined: every record, the files marked changed and the undo history exactly as they were');
    const r4 = await reload(true);
    const after = await st();
    expect(r4.asked === 1 && r4.done && same(await pageRecs(), edited) && same(after.dirty, DIRTY), 'accepted: reloaded; the working copy brings every change back, the same files marked changed', after);
    expect(after.undo === '' && after.redo === '', 'the undo history does not survive a reload (the store starts it afresh when a library is loaded)', after);
    folderIs(ORIGINAL, 'nothing was written to the folder');
    await save();
    const r5 = await reload(true);
    expect(r5.asked === 0, 'after Save: a reload asks nothing');
    // Navigating inside the app keeps typing and unsaved changes, with no question.
    for (const how of ['the rail', 'Back', 'Alt+PageDown']) {
      await start();
      await go('#/issues/' + ID.LEDGER + '/' + ID.L1); await page.waitForSelector('#f-printer');
      let target = ID.L1;
      if (how === 'Back') { await go('#/issues/' + ID.LEDGER + '/' + ID.L2); await page.waitForSelector('#f-printer'); target = ID.L2; }
      await page.click('#f-printer'); await page.keyboard.type('Pending Printer');
      dialogs.length = 0;
      if (how === 'the rail') await page.click('.rail a:has-text("Library")');
      if (how === 'Back') await page.goBack();
      if (how === 'Alt+PageDown') await key('Alt+PageDown');
      await page.waitForTimeout(300);
      const v = await page.evaluate(i => SC.session.store.state.issues.get(i).printer, target);
      expect(v === 'Pending Printer' && dialogs.length === 0 && same((await st()).dirty, [LI]), 'typing, then away by ' + how + ': committed, no question, the Issues file marked changed');
    }
  });

  // ════ 4. Close library, Open another folder ════
  const Q = '2 file(s) have unsaved changes. Continue without saving them?';
  await section('4. Close library with unsaved changes: declined, then accepted', async () => {
    await start();
    await commitPublisher('Alpha Press');
    await go('#/library');
    const before = await st();
    dialogs.length = 0; answer = false;
    await page.click('button:has-text("Close library")'); await page.waitForTimeout(400);
    answer = true;
    expect(same(dialogs, ['confirm: ' + Q]), 'the question: "' + Q + '"', dialogs);
    expect(same(await pageRecs(), edited) && same(await st(), before), 'declined: still open, every record, the files marked changed and the undo history exactly as they were');
    const w1 = await working();
    expect(w1 && w1.slug === L.slug && same(w1.dirty, DIRTY), 'the working copy still holds the library with its unsaved changes', w1);
    const r = await reload(true);
    expect(r.done && same(await pageRecs(), edited) && same((await st()).dirty, DIRTY), 'a reload after declining brings the same unsaved work back');
    folderIs(ORIGINAL, 'declined');
    await go('#/library');
    dialogs.length = 0;
    await page.click('button:has-text("Close library")'); await page.waitForTimeout(500);
    const s = await st();
    expect(same(dialogs, ['confirm: ' + Q]) && s.mode === 'none' && await page.locator('text=Open library folder').count() === 1, 'accepted: the library is closed; the welcome page', s);
    expect(await working() === null, 'the working copy is cleared: the unsaved changes are discarded, as the question says');
    folderIs(ORIGINAL, 'accepted: nothing written to the folder');
    const r2 = await reload(true);
    expect(r2.asked === 0 && (await st()).mode === 'none', 'a reload: nothing asked, nothing restored');
    await page.click('text=Open library folder'); await waitLoaded();
    expect(same(await pageRecs(), S0) && (await st()).dirty.length === 0, 'the folder opened again: its records as they are, nothing marked changed');
  });
  await section('4b. Open another folder with unsaved changes: the same folder', async () => {
    await start();
    await commitPublisher('Alpha Press');
    await go('#/library');
    const before = await st();
    dialogs.length = 0; answer = false;
    await page.click('button:has-text("Open another folder")'); await page.waitForTimeout(400);
    answer = true;
    expect(same(dialogs, ['confirm: ' + Q]) && same(await pageRecs(), edited) && same(await st(), before), 'declined: the question, and nothing changed (records, marked files, undo history)');
    folderIs(ORIGINAL, 'declined');
    dialogs.length = 0;
    await page.click('button:has-text("Open another folder")'); await waitLoaded(); await page.waitForTimeout(300);
    const s = await st();
    expect(same(dialogs, ['confirm: ' + Q]) && same(await pageRecs(), S0) && s.dirty.length === 0 && s.undo === '', 'accepted: the folder read afresh: its records as they are, the unsaved change discarded, nothing marked changed, no undo history', s);
    folderIs(ORIGINAL, 'accepted: nothing written to the folder');
    const w = await working();
    expect(w && w.slug === L.slug && w.dirty.length === 0, 'the working copy holds the folder as read, with nothing unsaved', w);
    const r = await reload(true);
    expect(r.asked === 0 && same(await pageRecs(), S0), 'a reload asks nothing and brings back the folder as read; the discarded change does not come back');
  });
  await section('4c. Open another folder with unsaved changes: another library', async () => {
    const other = otherLibrary();
    await start();
    await commitPublisher('Alpha Press');
    await go('#/library');
    // The folder picker of the test now hands over a second folder, held in the page.
    await page.evaluate(files => {
      const tree = { files: Object.fromEntries(Object.entries(files).map(([n, t]) => [n, { text: t, lastModified: 1000 }])), dirs: {} };
      const fh = (node, name) => ({ kind: 'file', name, getFile: async () => ({ name, lastModified: node.files[name].lastModified, text: async () => node.files[name].text }),
        createWritable: async () => { let b = ''; return { write: async t => { b += t; }, close: async () => { node.files[name] = { text: b, lastModified: Date.now() }; }, abort: async () => {} }; } });
      const dh = (node, name) => ({ kind: 'directory', name, queryPermission: async () => 'granted', requestPermission: async () => 'granted',
        values: async function* () { for (const n of Object.keys(node.files)) yield fh(node, n); for (const d of Object.keys(node.dirs)) yield dh(node.dirs[d], d); },
        getFileHandle: async (n, o) => { if (!node.files[n]) { if (!(o && o.create)) { const e = new Error('not found'); e.name = 'NotFoundError'; throw e; } node.files[n] = { text: '', lastModified: Date.now() }; } return fh(node, n); },
        getDirectoryHandle: async (n, o) => { if (!node.dirs[n]) { if (!(o && o.create)) { const e = new Error('not found'); e.name = 'NotFoundError'; throw e; } node.dirs[n] = { files: {}, dirs: {} }; } return dh(node.dirs[n], n); },
        removeEntry: async n => { delete node.files[n]; delete node.dirs[n]; } });
      window.__otherTree = tree;
      window.__SC_TEST_FS__.root = dh(tree, 'Other Folder');
    }, other);
    dialogs.length = 0; answer = false;
    await page.click('button:has-text("Open another folder")'); await page.waitForTimeout(400);
    answer = true;
    expect(same(dialogs, ['confirm: ' + Q]) && same(await pageRecs(), edited) && (await st()).dirty.length === 2, 'declined: still the Integrity Test Library with its unsaved change');
    dialogs.length = 0;
    await page.click('button:has-text("Open another folder")'); await page.waitForTimeout(800);
    const now = await page.evaluate(() => ({ slug: SC.session.store.state.library.slug, folder: SC.session.ui.folderName, titles: Array.from(SC.session.store.state.titles.keys()), dirty: SC.session.store.dirty.size, undo: SC.session.store.undoLabel }));
    expect(same(dialogs, ['confirm: ' + Q]) && same(now, { slug: 'OTHER-TEST', folder: 'Other Folder', titles: ['OTHGAZEX-1890'], dirty: 0, undo: '' }), 'accepted: the other library is open, nothing marked changed, no undo history', now);
    const otherNow = await page.evaluate(() => Object.fromEntries(Object.entries(window.__otherTree.files).map(([n, f]) => [n, f.text])));
    expect(same(otherNow, other), 'the other folder byte for byte as it was');
    folderIs(ORIGINAL, 'the first library\'s folder: nothing written to it, the unsaved change discarded');
    const w = await working();
    expect(w && w.slug === 'OTHER-TEST' && w.titles === 1, 'the working copy now holds the other library, none of the first one\'s changes', w);
    await shot('4c-other-library-opened');
    await reopen();
    expect(same(await pageRecs(), S0) && (await st()).dirty.length === 0, 'the first library\'s folder opened afresh in a new browser profile: its records as they are');
  });

  // ════ 5. Save ════
  await section('5. Ctrl+S, Undo across the save, Redo back to it, reload, a fresh open', async () => {
    await start();
    await commitPublisher('Alpha Press');
    await page.evaluate(() => { window.__m = SC.session.ui.message; });
    await key('Control+s');
    await page.waitForFunction(() => SC.session.ui.message && SC.session.ui.message !== window.__m && !SC.session.ui.busy);
    const msg = await page.evaluate(() => (SC.session.ui.message || {}).text || '');
    expect(/^Saved /.test(msg) && (await st()).dirty.length === 0, 'Ctrl+S saves: "' + msg.slice(0, 120) + '"; nothing left marked changed');
    const saved = savedFolder(withPublisher('Alpha Press'), [FT, LI]);
    folderIs(saved, 'saved: the Titles and Ledger Issues files exactly as the app\'s writer writes the edited records, every other file as it was');
    const bdirs = Object.values((run.folder().dirs._backups || { dirs: {} }).dirs);
    expect(bdirs.some(d => d.files[FT] && d.files[FT].text === ORIGINAL[FT] && d.files[LI] && d.files[LI].text === ORIGINAL[LI]), 'the two files\' previous versions are in _backups/, byte for byte');
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await key('Control+z');
    const u = await st();
    expect(same(await pageRecs(), S0) && same(u.dirty, DIRTY), 'Ctrl+Z after saving: the edit undone, and the two files marked changed again (they differ from what was saved)', u);
    const rq = await reload(false);
    expect(rq.asked === 1, 'so leaving now asks');
    await key('Control+y');
    const v = await st();
    expect(same(await pageRecs(), edited) && v.dirty.length === 0, 'Ctrl+Y: back to the saved state: nothing marked changed', v);
    const r = await reload(true);
    expect(r.asked === 0 && same(await pageRecs(), edited) && (await st()).dirty.length === 0, 'a reload asks nothing; the saved records, nothing marked changed');
    folderIs(saved, 'after the reload');
    await reopen();
    expect(same(await pageRecs(), readerOf(saved).recs) && (await st()).dirty.length === 0, 'a fresh open in a new browser profile: every record exactly as the app\'s reader reads the saved folder');
  });

  expect(errors.length === 0, 'no page errors', errors.join('; '));
  if (run) await run.close();
  await browser.close();
  console.log(log.join('\n'));
  if (failures) { console.log('FAILED ' + failures + ' of ' + count + ' undo and unsaved-change checks'); process.exit(1); }
  console.log('PASSED ' + count + ' undo and unsaved-change checks');
})();
