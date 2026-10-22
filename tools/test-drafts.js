#!/usr/bin/env node
/* Slaughter Cataloger 3 — a new issue entered and not recorded (K-D1), in Chromium.

   usage: node tools/test-drafts.js <app.html> [screenshot-dir]

   A new-issue draft lives in memory only, for the session; it is never a record and never stored.
   Since K-D1 (A2 repair), a draft the person has changed so that it differs from the draft the app
   would make afresh is protected: leaving or reloading the page asks (the browser's question), and
   Close library and Open another folder ask, in one question with any unsaved files; declined, the
   draft and its values stay; agreed, every draft goes, so the library opened next starts afresh.
   A draft only opened, ready after Record, changed back to what was proposed, or changed only in its
   "Moves on" settings asks nothing. On the invented library of tools/lib/integrity-library.js, in a
   folder held by this test (tools/lib/held-folder.js), each section from a fresh open; the records,
   the files marked changed and the folder (byte for byte) are checked throughout: a draft never
   becomes a record or reaches a file unless recorded and saved. */
'use strict';
const path = require('path'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const ROOT = path.join(__dirname, '..');
const app = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'slaughter-cataloger-3.html'));
const shots = process.argv[3] || '';
if (shots) fs.mkdirSync(shots, { recursive: true });
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const R = globalThis.SC.records;
const L = require('./lib/integrity-library')(globalThis.SC);
const H = require('./lib/held-folder');
const ID = L.ids, N = L.names, ORIGINAL = L.files;
const FT = N.titles, LI = N.issues(ID.LEDGER);

const log = [], errors = [];
let failures = 0, count = 0;
const step = s => log.push('· ' + s);
const expect = (cond, what, detail) => { count++; log.push((cond ? '  ok   ' : '  FAIL ') + what + (cond || detail === undefined ? '' : '\n         ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 900))); if (!cond) failures++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function readerOf(files) {
  const b = R.buildLibrary(Object.keys(files).map(n => R.readFile(n, files[n], { allowEmpty: true })), {});
  const recs = {};
  ['titles', 'issues', 'contents', 'authorities'].forEach(k => { recs[k] = {}; Array.from(b.state[k].keys()).sort().forEach(id => { recs[k][id] = JSON.parse(JSON.stringify(b.state[k].get(id))); }); });
  return recs;
}
const S0 = readerOf(ORIGINAL);
// The same library with the Ledger's no. 4 in volume 2, so that Start next volume has numbers to move.
const VOL = (() => {
  const b = R.buildLibrary(Object.keys(ORIGINAL).map(n => R.readFile(n, ORIGINAL[n], {})), {});
  b.state.issues.set(ID.L4, R.freezeRec(Object.assign({}, b.state.issues.get(ID.L4), { volume: '2' })));
  return Object.assign({}, ORIGINAL, { [LI]: R.writeFile(b.state, LI) });
})();
const Q1 = 'The new issue being entered for The Specimen Ledger has not been recorded. Continue without recording it?';
const QF = '2 file(s) have unsaved changes. Continue without saving them?';
const QB = '2 file(s) have unsaved changes, and the new issue being entered for The Specimen Ledger has not been recorded. Continue without saving or recording them?';
const Q2 = 'The new issues being entered for The Sample Herald and The Specimen Ledger have not been recorded. Continue without recording them?';

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
    step(name); answer = true;
    try { await fn(); } catch (e) { failures++; log.push('  FAIL the section stopped: ' + String(e && e.message || e).split('\n')[0]); }
  };
  const start = async files => { if (run) await run.close().catch(() => {}); run = await H.open(browser, app, files || ORIGINAL, { onPage }); page = run.page; };
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(250); };
  const key = async k => { await page.keyboard.press(k); await page.waitForTimeout(120); };
  const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
  const waitLoaded = () => page.waitForFunction(() => SC.session && SC.session.ui.mode === 'folder' && !SC.session.ui.busy && SC.session.ui.access === 'owner');
  const pageRecs = () => page.evaluate(() => {
    const s = SC.session.store.state, o = {};
    ['titles', 'issues', 'contents', 'authorities'].forEach(k => { o[k] = {}; Array.from(s[k].keys()).sort().forEach(id => { o[k][id] = JSON.parse(JSON.stringify(s[k].get(id))); }); });
    return o;
  });
  const st = () => page.evaluate(() => ({ dirty: Array.from(SC.session.store.dirty).sort(), undo: SC.session.store.undoLabel, mode: SC.session.ui.mode }));
  const draftPage = async tid => { await go('#/issues/' + (tid || ID.LEDGER) + '/new'); await page.waitForSelector('.draft-card'); };
  const enter = async (sel, v) => { await page.fill(sel, v); await page.locator(sel).press('Tab'); await page.waitForTimeout(120); };
  const value = sel => page.inputValue(sel);
  // The folder byte for byte as expected, and nothing recorded or changed unless `recs` says so.
  const untouched = async (what, files, recs) => {
    const now = run.texts(), want = files || ORIGINAL;
    expect(same(Object.keys(now).sort(), Object.keys(want).sort()) && Object.keys(want).every(n => now[n] === want[n]), what + ': the folder byte for byte as expected');
    expect(same(await pageRecs(), recs || S0), what + ': every record as expected (the draft is not a record)');
  };
  const reload = async accept => {
    dialogs.length = 0; answer = accept;
    let done = true;
    await page.reload({ timeout: accept ? 15000 : 2500 }).catch(() => { done = false; });
    answer = true;
    if (done) { await waitLoaded().catch(() => {}); await page.waitForTimeout(300); }
    return { asked: dialogs.filter(d => /^beforeunload/.test(d)).length, done };
  };
  const libraryAction = async (label, accept) => {
    await go('#/library'); dialogs.length = 0; answer = accept;
    await page.click('button:has-text("' + label + '")'); await page.waitForTimeout(500);
    answer = true;
    if (accept && label === 'Open another folder') await waitLoaded().catch(() => {});
    return dialogs.slice();
  };

  // Every check below is of what a person sees: whether leaving, closing or opening asks, the
  // question word for word, and the draft's values afterwards.
  const asksOnLeave = async () => (await reload(false)).asked === 1;     // declined: the page stays
  const asksNothingOnReload = async () => { const r = await reload(true); return r.asked === 0 && r.done; };

  // ════ 1. Drafts that hold nothing ════
  await section('1. A draft only opened, ready after Record, changed back, or changed only in its settings: nothing is asked', async () => {
    await start();
    await draftPage(); await page.click('.draft-card');
    expect(await asksNothingOnReload(), 'New issue opened, nothing entered: a reload asks nothing');
    await draftPage();
    expect(same(await libraryAction('Close library', true), []) && (await st()).mode === 'none', 'Close library: nothing asked; closed');
    await page.click('text=Open library folder'); await waitLoaded();
    await draftPage();
    expect(same(await libraryAction('Open another folder', true), []), 'Open another folder: nothing asked');
    // Changed, then changed back to what was proposed.
    await start(); await draftPage();
    const proposed = await value('#f-number');
    await enter('#f-number', String(Number(proposed) + 1));
    expect(await asksOnLeave(), 'Whole no. changed from the proposed ' + proposed + ': leaving asks');
    await enter('#f-number', proposed);
    expect(await asksNothingOnReload(), 'changed back to ' + proposed + ': nothing asked');
    await draftPage();
    const tog = page.locator('.field:has(#f-printer) button.tog:has-text("?")');
    await tog.click(); await page.waitForTimeout(120);
    expect(await asksOnLeave(), 'Printer marked ?: leaving asks');
    await tog.click(); await page.waitForTimeout(120);
    expect(await asksNothingOnReload(), 'the ? taken off again: nothing asked');
    // A "Moves on" setting (kept per title in this browser).
    await draftPage();
    await page.locator('.adv-opts input[type=checkbox]').first().click(); await page.waitForTimeout(150);
    expect(await asksNothingOnReload(), 'a "Moves on" setting changed: nothing asked (the setting is kept in this browser)');
    // Ready after Record, saved.
    await go('#/issues/' + ID.LEDGER + '/' + ID.L4); await page.waitForSelector('.issue-form');
    await page.click('.sticky-actions button:has-text("New issue after this")'); await page.waitForSelector('.draft-card');
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    await page.click('.topbar button:has-text("Save")'); await page.waitForTimeout(600);
    expect((await st()).dirty.length === 0 && await page.locator('.draft-card').count() === 1, 'after Record and Save, the next draft is ready and nothing is unsaved');
    expect(await asksNothingOnReload(), 'a reload asks nothing');
  });

  // ════ 2. A changed draft ════
  await section('2. A draft with a value entered: reload and closing the page ask; declined keeps it; agreed loses it', async () => {
    await start(); await draftPage();
    await enter('#f-printer', 'Draft Printer');
    expect((await st()).dirty.length === 0, 'Printer entered (and the field left): nothing is marked changed (a draft is not a record)');
    const r1 = await reload(false);
    expect(r1.asked === 1 && !r1.done, 'reload: the browser asks first (before the repair: nothing asked, the draft lost)', r1);
    expect(await value('#f-printer') === 'Draft Printer', 'declined: the page stays, the draft and its Printer kept');
    await untouched('declined');
    await go('#/library'); await page.waitForSelector('.lib-name');
    await draftPage();
    expect(await value('#f-printer') === 'Draft Printer', 'to the Library page and back: the draft and its value kept, nothing asked');
    dialogs.length = 0; answer = false;
    await page.close({ runBeforeUnload: true }); await page.waitForTimeout(800);
    answer = true;
    expect(dialogs.filter(d => /^beforeunload/.test(d)).length === 1 && !page.isClosed(), 'closing the page (as closing the tab): asked; declined, the page stays open', { dialogs, closed: page.isClosed() });
    expect(await value('#f-printer') === 'Draft Printer', 'and the draft is still there');
    const r2 = await reload(true);
    expect(r2.asked === 1 && r2.done, 'reload, agreed: reloaded', r2);
    await draftPage();
    expect(await value('#f-printer') === '', 'the draft is gone, as the question warned: a fresh draft');
    await untouched('after the reload');
    // On a fresh page: after one declined close, Playwright does not run beforeunload again on that page.
    await start(); await draftPage(); await enter('#f-printer', 'Draft Printer');
    dialogs.length = 0;
    await page.close({ runBeforeUnload: true }); await new Promise(res => setTimeout(res, 800));
    expect(dialogs.filter(d => /^beforeunload/.test(d)).length === 1 && page.isClosed(), 'closing the page, agreed: asked, then closed', { dialogs, closed: page.isClosed() });
    run = await run.reopen(); page = run.page;
    await draftPage();
    expect(await value('#f-printer') === '' && same(await pageRecs(), S0), 'the folder opened afresh: a fresh draft; every record as in the folder');
  });
  await section('2b. Other changes that count: Start next volume, a ? on a value', async () => {
    await start(); await draftPage();
    await page.click('button:has-text("Start next volume")'); await page.waitForTimeout(150);
    expect(await asksNothingOnReload(), 'Start next volume where the run has no volume: it changes nothing in the draft, so nothing is asked');
    await start(VOL); await draftPage();
    const v0 = await value('#f-volume');
    await page.click('button:has-text("Start next volume")'); await page.waitForTimeout(150);
    const v1 = await value('#f-volume');
    expect(v0 === '2' && v1 === '3', 'Start next volume after no. 4 of vol. 2: the draft moves to vol. 3', { v0, v1 });
    expect(await asksOnLeave(), 'so leaving asks');
    await start(); await draftPage();
    await page.locator('.field:has(#f-year) button.tog:has-text("?")').click(); await page.waitForTimeout(120);
    expect(await asksOnLeave(), 'a ? put on the Year: leaving asks');
  });

  // ════ 3. Close library, Open another folder ════
  await section('3. Close library and Open another folder with a changed draft: one question; declined keeps it; agreed starts afresh', async () => {
    await start(); await draftPage(); await enter('#f-printer', 'Draft Printer');
    const q1 = await libraryAction('Close library', false);
    expect(same(q1, ['confirm: ' + Q1]), 'Close library asks: "' + Q1 + '" (before the repair: nothing asked)', q1);
    await draftPage();
    expect((await st()).mode === 'folder' && await value('#f-printer') === 'Draft Printer', 'declined: still open, the draft and its value kept');
    await untouched('declined');
    const q2 = await libraryAction('Close library', true);
    expect(same(q2, ['confirm: ' + Q1]) && (await st()).mode === 'none', 'agreed: closed', q2);
    await page.click('text=Open library folder'); await waitLoaded();
    await draftPage();
    expect(await value('#f-printer') === '', 'the folder opened again in the same page: a fresh draft (before the repair the old one came back)');
    await untouched('reopened');
    await enter('#f-printer', 'Draft Printer');
    const q3 = await libraryAction('Open another folder', false);
    await draftPage();
    expect(same(q3, ['confirm: ' + Q1]) && await value('#f-printer') === 'Draft Printer', 'Open another folder asks the same; declined, the draft kept', q3);
    const q4 = await libraryAction('Open another folder', true);
    await draftPage();
    expect(same(q4, ['confirm: ' + Q1]) && await value('#f-printer') === '', 'agreed: the folder read afresh, and a fresh draft', q4);
    await untouched('after Open another folder');
    await shot('3-fresh-draft-after-open-another-folder');
  });
  await section('3b. Unsaved files and a changed draft: one question for both; two drafts: one question naming both', async () => {
    await start();
    await go('#/library/' + ID.LEDGER); await page.waitForSelector('#f-publisher'); await enter('#f-publisher', 'Alpha Press');
    const edited = await pageRecs();
    await draftPage(); await enter('#f-printer', 'Draft Printer');
    const q1 = await libraryAction('Close library', false);
    expect(same(q1, ['confirm: ' + QB]), 'one question: "' + QB + '"', q1);
    expect(same(await pageRecs(), edited) && (await st()).dirty.length === 2, 'declined: the unsaved edit kept');
    await draftPage();
    expect(await value('#f-printer') === 'Draft Printer', 'and the draft kept');
    const r = await reload(false);
    expect(r.asked === 1, 'leaving asks once (the browser\'s one question covers both)', r);
    await page.click('.topbar button:has-text("Save")'); await page.waitForTimeout(600);
    const saved = run.texts();
    expect((await st()).dirty.length === 0 && saved[FT] !== ORIGINAL[FT], 'Save: the edit is written; the draft is not recorded by saving');
    expect(same(await libraryAction('Close library', false), ['confirm: ' + Q1]), 'after Save, Close library asks about the draft alone');
    expect(await asksOnLeave(), 'and leaving still asks');
    await draftPage(ID.HERALD); await enter('#f-printer', 'Herald Draft Printer');
    const q2 = await libraryAction('Open another folder', false);
    expect(same(q2, ['confirm: ' + Q2]), 'with a second title\'s draft changed too: one question naming both: "' + Q2 + '"', q2);
    const q3 = await libraryAction('Open another folder', true);
    await draftPage(ID.HERALD);
    const h = await value('#f-printer');
    await draftPage();
    expect(same(q3, ['confirm: ' + Q2]) && h === '' && await value('#f-printer') === '', 'agreed: both drafts gone');
    await untouched('after Open another folder', saved, readerOf(saved));
  });

  // ════ 4. With typing in a field, and the existing questions ════
  await section('4. Typing not yet left, Follows, Record: no second or contradictory question', async () => {
    await start(); await draftPage();
    await page.click('#f-printer'); await page.keyboard.type('Typed');
    const r1 = await reload(false);
    expect(r1.asked === 1, 'typing still in a draft field: leaving asks once (D-K2)', r1);
    await page.click('.rail a:has-text("Library")'); await page.waitForTimeout(250);
    expect(same(await libraryAction('Close library', false), ['confirm: ' + Q1]), 'going to the Library page commits the typing into the draft, so Close library asks about the draft, once');
    await draftPage();
    expect(await value('#f-printer') === 'Typed', 'declined: the typed value is in the draft');
    dialogs.length = 0; answer = false;
    await page.selectOption('.advance-bar select', ID.L2); await page.waitForTimeout(250);
    answer = true;
    expect(same(dialogs, ['confirm: Start the new issue again, following another issue? What you have entered in it will be cleared.']) && await value('#f-printer') === 'Typed',
      'Follows changed on the changed draft: its own question, as before; declined, the draft kept', dialogs);
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    const recs = await pageRecs();
    const added = Object.keys(recs.issues).filter(i => !(i in S0.issues));
    expect(added.length === 1 && recs.issues[added[0]].printer === 'Typed' && same((await st()).dirty, [LI]), 'Record issue: the draft becomes a record (Printer "Typed"); only the Ledger\'s Issues file marked changed');
    expect(same(await libraryAction('Close library', false), ['confirm: 1 file(s) have unsaved changes. Continue without saving them?']), 'the next draft holds nothing, so Close library asks about the unsaved file alone');
    await page.click('.topbar button:has-text("Save")'); await page.waitForTimeout(600);
    expect(await asksNothingOnReload(), 'saved: a reload asks nothing');
    run = await run.reopen(); page = run.page;
    expect(same(await pageRecs(), readerOf(run.texts())) && (await pageRecs()).issues[added[0]].printer === 'Typed', 'opened afresh: the recorded issue is in the folder with its Printer; every record as the reader reads the folder');
  });

  expect(errors.length === 0, 'no page errors', errors.join('; '));
  if (run) await run.close().catch(() => {});
  await browser.close();
  console.log(log.join('\n'));
  if (failures) { console.log('FAILED ' + failures + ' of ' + count + ' draft checks'); process.exit(1); }
  console.log('PASSED ' + count + ' draft checks');
})();
