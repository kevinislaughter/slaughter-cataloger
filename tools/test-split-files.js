#!/usr/bin/env node
/* Slaughter Cataloger 3 — titles whose issues are in more than one Issues file (DF-22), in Chromium.

   usage: node tools/test-split-files.js <app.html> [screenshot-dir]

   A run split over several Issues files is shown file by file, the files in the order of their names
   (store.indexes; unchanged, DF-22 registered). The Library page names every such title, its files in
   exactly that order and the issues each holds, and says the order may not be the order of
   publication; it changes nothing. Checked here, on the invented library of
   tools/lib/integrity-library.js arranged in several ways, each opened afresh in a folder held by
   this test (tools/lib/held-folder.js):
   - the warning's text, word for word, and its title and file lists, for several namings: the A2 batch
     1 pair (…_ISSUES.csv, …_ISSUES_2.csv), …_1/…_2, three files …_01/…_02/…_03, names without the
     TitleID, two titles split with one file shared between them;
   - the files it lists are in the order the run is shown (the store's own run);
   - the same text whichever order the folder lists the files, after a reload, after a fresh open in a
     new browser profile, and when the files are loaded as files instead of a folder;
   - nothing changed by it: the records exactly as the app's reader reads the files, nothing marked
     changed, nothing to undo, the folder byte for byte, no backups, the load report unchanged;
   - no warning for a library with one Issues file per title, for one file holding all the issues of
     two titles, or for an emptied (header-only) Issues file beside a title's run (DF-19);
   - it follows the records during the session: a new issue recorded (DF-20), Undo, Redo, Save and a
     fresh open; the run brought back into one file by deleting issues, and Undo. */
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
const ID = L.ids, LI = L.names.issues(ID.LEDGER), HI = L.names.issues(ID.HERALD);
const ORIGINAL = L.files;
const P = 'SCAT_INTEGRITY-TEST_';

const log = [], errors = [];
let failures = 0, count = 0;
const step = s => log.push('· ' + s);
const expect = (cond, what, detail) => { count++; log.push((cond ? '  ok   ' : '  FAIL ') + what + (cond || detail === undefined ? '' : '\n         ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 900))); if (!cond) failures++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The invented library with issues moved between Issues files. moves: [[file, [IssueIDs in order]], …]:
// each listed file holds those issues (Entry Order 1, 2, …) besides any it held that were not moved.
// An Issues file left with no issue is left out of the folder. extra: more files as they are.
// reverse: the folder lists its files in the opposite order.
function arrange(moves, opts) {
  opts = opts || {};
  const b = R.buildLibrary(Object.keys(ORIGINAL).map(n => R.readFile(n, ORIGINAL[n], {})), {});
  const st = b.state;
  moves.forEach(([file, iids]) => {
    if (!st.files.has(file)) st.files.set(file, Object.assign({}, st.files.get(LI), { name: file }));
    iids.forEach((iid, k) => st.issues.set(iid, R.freezeRec(Object.assign({}, st.issues.get(iid), { _src: file, entryOrder: k + 1 }))));
  });
  const out = {};
  st.files.forEach((f, n) => {
    const held = Array.from(R.mapOfKind(st, f.kind).values()).some(r => r._src === n);
    if (held || f.kind !== 'issue') out[n] = R.writeFile(st, n);
  });
  Object.assign(out, opts.extra || {});
  const names = Object.keys(out).sort();
  if (opts.reverse) names.reverse();
  return Object.fromEntries(names.map(n => [n, out[n]]));
}
// What the app's reader makes of a folder, as the app reads it: every record (with its file and Entry
// Order) and the load report.
function readerOf(files) {
  const b = R.buildLibrary(Object.keys(files).map(n => R.readFile(n, files[n], { allowEmpty: true })), {});
  const recs = {};
  ['titles', 'issues', 'contents', 'authorities'].forEach(k => { recs[k] = {}; Array.from(b.state[k].keys()).sort().forEach(id => { recs[k][id] = JSON.parse(JSON.stringify(b.state[k].get(id))); }); });
  return { recs, report: b.report.map(r => r.level + ' ' + (r.file || '') + ': ' + r.msg) };
}

const INTRO = 'Such a run is shown file by file: the files in the order listed here, and the issues of each file in their order in that file. ' +
  'The order of the files comes from their names, not from the issues’ dates or numbers, so it may not be the order in which the issues were published. ' +
  'Nothing has been reordered, merged or changed.';
const TAIL = 'If an order is wrong: save, rename the files outside the app so that their names sort in run order (…_ISSUES_01.csv, …_ISSUES_02.csv and so on), and open the library again.';
const head = n => n + ' title' + (n === 1 ? ' has its' : 's have their') + ' issues in more than one Issues file.';
// One title as the warning should list it: [name, TitleID, [[file, [short names of its issues]], …]].
const want = (name, tid, parts) => {
  const total = parts.reduce((k, p) => k + p[1].length, 0);
  return { name, id: tid, line: name + ' ' + tid + ': ' + total + ' issues in ' + parts.length + ' files, shown in this order:',
    files: parts.map(([f, labels]) => f + ': ' + labels.length + (labels.length === 1 ? ' issue, ' : ' issues, ') + labels[0] + (labels.length > 1 ? ' to ' + labels[labels.length - 1] : '')) };
};
const SL = n => 'Specimen Ledger No. ' + n, SH = n => 'Sample Herald No. ' + n;

(async () => {
  const browser = await chromium.launch();
  let run, page;
  const dialogs = [];
  const onPage = p => {
    p.on('pageerror', e => errors.push('page error: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::/.test(m.text())) errors.push('console: ' + m.text()); });
    p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    p.setDefaultTimeout(8000);
  };
  const section = async (name, fn) => {
    step(name);
    try { await fn(); } catch (e) { failures++; log.push('  FAIL the section stopped: ' + String(e && e.message || e).split('\n')[0]); }
  };
  const start = async files => { if (run) await run.close(); run = await H.open(browser, app, files, { onPage }); page = run.page; await library(); };
  const reopen = async () => { run = await run.reopen(); page = run.page; await library(); };
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(200); };
  const library = async () => { await go('#/library'); await page.waitForSelector('.lib-name'); };
  const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
  // The warning as shown: its whole text, and its parts.
  const panel = () => page.evaluate(() => {
    const boxes = document.querySelectorAll('.split-runs');
    if (!boxes.length) return null;
    const inner = boxes[0].firstElementChild;
    return {
      boxes: boxes.length, text: boxes[0].innerText, cls: boxes[0].className, role: boxes[0].getAttribute('role'),
      head: inner.querySelector(':scope > strong').textContent,
      titles: Array.from(inner.querySelectorAll(':scope > ul > li')).map(li => ({
        name: li.querySelector(':scope > strong').textContent, id: li.querySelector(':scope > code').textContent,
        line: li.innerText.split('\n')[0].trim(), files: Array.from(li.querySelectorAll(':scope > ol > li')).map(x => x.textContent.trim()) }))
    };
  });
  // A title's Issues files in the order its run is shown (the store's run).
  const runFiles = tid => page.evaluate(t => { const out = []; SC.session.store.issuesOfTitle(t).forEach(i => { if (out[out.length - 1] !== i._src) out.push(i._src); }); return out; }, tid);
  const pageRecs = () => page.evaluate(() => {
    const s = SC.session.store.state, o = {};
    ['titles', 'issues', 'contents', 'authorities'].forEach(k => { o[k] = {}; Array.from(s[k].keys()).sort().forEach(id => { o[k][id] = JSON.parse(JSON.stringify(s[k].get(id))); }); });
    return o;
  });
  const state = () => page.evaluate(() => ({ dirty: Array.from(SC.session.store.dirty), canUndo: SC.session.store.canUndo,
    report: (SC.session.ui.report || []).map(r => r.level + ' ' + (r.file || '') + ': ' + r.msg) }));
  // The warning against what it should say, for a folder arranged as `files`.
  const checkPanel = async (files, titles, what) => {
    const p = await panel();
    expect(p && p.boxes === 1 && p.role === 'status' && /\bmessage\b/.test(p.cls) && /\bwarn\b/.test(p.cls), what + ': one warning on the Library page (a status message, not a dialog: nothing waits for it)', p && { boxes: p.boxes, cls: p.cls, role: p.role });
    if (!p) return null;
    expect(p.head === head(titles.length) && p.text.indexOf(INTRO) !== -1 && p.text.trim().endsWith(TAIL),
      'it says: "' + head(titles.length) + '", that the order comes from the names and may not be the order of publication, that nothing was changed, and how to change the order', p.text);
    expect(same(p.titles, titles), 'it lists ' + titles.map(t => t.name).join(' and ') + ', each with its files in order: ' + titles.map(t => t.files.join(' | ')).join(' || '), p.titles);
    for (const t of titles) {
      const rf = await runFiles(t.id);
      expect(same(t.files.map(f => f.split(': ')[0]), rf), 'the files of ' + t.name + ' are listed in the order its run is shown', rf);
    }
    return p;
  };
  // Nothing changed by opening and showing the warning.
  const untouched = async (files, what) => {
    const rd = readerOf(files), s = await state();
    expect(same(await pageRecs(), rd.recs), what + ': every record exactly as the app\'s reader reads the files (file and Entry Order included)');
    expect(s.dirty.length === 0 && !s.canUndo, 'nothing marked changed, nothing to undo', s);
    const now = run.texts();
    expect(same(Object.keys(now).sort(), Object.keys(files).sort()) && Object.keys(files).every(n => now[n] === files[n]) && !run.folder().dirs._backups,
      'the folder byte for byte as it was: no file written, renamed, added or removed, no backups');
    expect(same(s.report, rd.report), 'the load report is the reader\'s, with nothing added', { page: s.report, reader: rd.report });
  };
  const noPanel = async what => {
    const n = await page.evaluate(() => document.querySelectorAll('.split-runs').length);
    expect(n === 0, what + ': no warning about Issues files');
  };

  // ════ The library as it is ════
  await section('1. One Issues file per title (the invented library as it is): no warning', async () => {
    await start(ORIGINAL);
    await noPanel('the Library page');
    for (const k of ['LEDGER', 'HERALD', 'MODEL']) expect((await runFiles(ID[k])).length === 1, 'the run of ' + ID[k] + ' is in one file');
    await untouched(ORIGINAL, 'opened');
    await shot('1-one-file-per-title');
  });

  // ════ Namings ════
  const A = [[LI, [ID.L1, ID.L2]], [LI.replace(/\.csv$/, '_2.csv'), [ID.L3, ID.L4]]];
  const wantA = [want('The Specimen Ledger', ID.LEDGER, [[LI.replace(/\.csv$/, '_2.csv'), [SL(3), SL(4)]], [LI, [SL(1), SL(2)]]])];
  let textA = '';
  await section('2. …_ISSUES.csv (nos. 1–2) and …_ISSUES_2.csv (nos. 3–4): the A2 batch 1 pair, shown 3, 4, 1, 2', async () => {
    const files = arrange(A);
    await start(files);
    const p = await checkPanel(files, wantA, 'opened');
    textA = p ? p.text : '';
    await untouched(files, 'opened, the warning shown');
    await shot('2-split-ISSUES-and-ISSUES_2');
    const rev = arrange(A, { reverse: true });
    await start(rev);
    const p2 = await panel();
    expect(p2 && p2.text === textA, 'listed by the folder the other way round: the same warning, word for word', p2 && p2.text);
    // A reload in the same browser profile: the work is restored and the folder read again.
    await start(files);
    await page.reload();
    await page.waitForFunction(() => SC.session && SC.session.ui.mode === 'folder' && !SC.session.ui.busy && SC.session.ui.access === 'owner');
    await library();
    const p3 = await panel();
    expect(p3 && p3.text === textA, 'after a reload: the same warning, word for word', p3 && p3.text);
    await untouched(files, 'after the reload');
    await reopen();
    const p4 = await panel();
    expect(p4 && p4.text === textA, 'opened afresh in a new browser profile: the same warning, word for word', p4 && p4.text);
    await untouched(files, 'after the fresh open');
  });
  await section('3. …_ISSUES_1.csv (nos. 1–2) and …_ISSUES_2.csv (nos. 3–4): shown 1, 2, 3, 4', async () => {
    const B = [[LI.replace(/\.csv$/, '_1.csv'), [ID.L1, ID.L2]], [LI.replace(/\.csv$/, '_2.csv'), [ID.L3, ID.L4]]];
    const files = arrange(B);
    await start(files);
    const p = await checkPanel(files, [want('The Specimen Ledger', ID.LEDGER, [[LI.replace(/\.csv$/, '_1.csv'), [SL(1), SL(2)]], [LI.replace(/\.csv$/, '_2.csv'), [SL(3), SL(4)]]])], 'opened');
    await untouched(files, 'opened');
    await start(arrange(B, { reverse: true }));
    const p2 = await panel();
    expect(p && p2 && p2.text === p.text, 'listed by the folder the other way round: the same warning, word for word');
  });
  await section('4. Three files, …_ISSUES_01.csv (no. 1), …_ISSUES_02.csv (nos. 2–3), …_ISSUES_03.csv (no. 4): the naming the warning suggests', async () => {
    const f = s => LI.replace(/\.csv$/, '_' + s + '.csv');
    const C = [[f('01'), [ID.L1]], [f('02'), [ID.L2, ID.L3]], [f('03'), [ID.L4]]];
    const files = arrange(C);
    await start(files);
    const p = await checkPanel(files, [want('The Specimen Ledger', ID.LEDGER, [[f('01'), [SL(1)]], [f('02'), [SL(2), SL(3)]], [f('03'), [SL(4)]]])], 'opened');
    await untouched(files, 'opened');
    await start(arrange(C, { reverse: true }));
    const p2 = await panel();
    expect(p && p2 && p2.text === p.text, 'listed by the folder the other way round: the same warning, word for word');
  });
  await section('5. Names without the TitleID, …_LEDGER-OLD.csv (nos. 1–2) and …_LEDGER-NEW.csv (nos. 3–4): shown 3, 4, 1, 2', async () => {
    const D = [[P + 'LEDGER-OLD.csv', [ID.L1, ID.L2]], [P + 'LEDGER-NEW.csv', [ID.L3, ID.L4]]];
    const files = arrange(D);
    await start(files);
    await checkPanel(files, [want('The Specimen Ledger', ID.LEDGER, [[P + 'LEDGER-NEW.csv', [SL(3), SL(4)]], [P + 'LEDGER-OLD.csv', [SL(1), SL(2)]]])], 'opened');
    await untouched(files, 'opened');
  });
  await section('6. Two titles split, one file shared: …_SHARED_ISSUES.csv holds Herald no. 2 and Ledger no. 4', async () => {
    const S = P + 'SHARED_ISSUES.csv';
    const E = [[S, [ID.H2, ID.L4]]];
    const files = arrange(E);
    await start(files);
    await checkPanel(files, [
      want('The Sample Herald', ID.HERALD, [[HI, [SH(1)]], [S, [SH(2)]]]),
      want('The Specimen Ledger', ID.LEDGER, [[S, [SL(4)]], [LI, [SL(1), SL(2), SL(3)]]])
    ], 'opened');
    const p = await panel();
    expect(p && p.text.indexOf('Model Weekly') === -1 && p.text.indexOf('Trial Quarterly') === -1, 'the titles in one file each are not listed');
    await untouched(files, 'opened');
    await shot('6-two-titles-one-shared-file');
    await start(arrange(E, { reverse: true }));
    const p2 = await panel();
    expect(p && p2 && p2.text === p.text, 'listed by the folder the other way round: the same warning, word for word');
  });

  // ════ No warning ════
  await section('7. One file holding every issue of two titles (shared, but neither run split): no warning', async () => {
    const S = P + 'SHARED_ISSUES.csv';
    const files = arrange([[S, [ID.H1, ID.H2, ID.L1, ID.L2, ID.L3, ID.L4]]]);
    expect(!(HI in files) && !(LI in files), 'the two titles\' own Issues files are not in the folder');
    await start(files);
    await noPanel('the Library page');
    expect(same(await runFiles(ID.LEDGER), [S]) && same(await runFiles(ID.HERALD), [S]), 'both runs are in the one shared file');
    await untouched(files, 'opened');
  });
  await section('8. An emptied Issues file beside a title\'s run (header row only; DF-19): no warning', async () => {
    const EMPTY = LI.replace(/\.csv$/, '_2.csv');
    const st0 = globalThis.SC.emptyState();
    st0.library = Object.freeze({ slug: L.slug, name: '', note: '' });
    st0.files.set(EMPTY, { name: EMPTY, kind: 'issue', extraHeaders: [], hash: '', lastModified: 0, schemaVersion: globalThis.SC.schema.VERSION, setAside: [] });
    const files = Object.assign({}, ORIGINAL, { [EMPTY]: R.writeFile(st0, EMPTY) });
    await start(files);
    expect(await page.evaluate(n => SC.session.store.state.files.has(n), EMPTY), 'the emptied file is loaded as an empty Issues file of the library');
    await noPanel('the Library page (an empty file holds no issue, so the run is in one file)');
    await untouched(files, 'opened');
  });

  // ════ During the session ════
  await section('9. The warning follows the records: a new issue (DF-20), Undo, Redo, Save, a fresh open; the run brought into one file', async () => {
    const files = arrange(A);
    await start(files);
    await go('#/issues/' + ID.LEDGER + '/' + ID.L1); await page.waitForSelector('.issue-form');
    await page.click('.sticky-actions button:has-text("New issue after this")'); await page.waitForSelector('.draft-card');
    await page.fill('#f-shortname', 'Specimen Ledger No. 1, Supplement'); await page.locator('#f-shortname').press('Enter');
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    await library();
    const after = [want('The Specimen Ledger', ID.LEDGER, [[LI.replace(/\.csv$/, '_2.csv'), [SL(3), SL(4)]], [LI, [SL(1), 'Specimen Ledger No. 1, Supplement', SL(2)]]])];
    const p1 = await panel();
    expect(p1 && same(p1.titles, after), 'a new issue recorded after no. 1: the warning counts it, in …_ISSUES.csv (3 issues, No. 1 to No. 2)', p1 && p1.titles);
    await page.click('.topbar button:has-text("Undo")'); await page.waitForTimeout(200);
    const p2 = await panel();
    expect(p2 && p2.text === textA, 'Undo: the warning as it was, word for word');
    await page.click('.topbar button:has-text("Redo")'); await page.waitForTimeout(200);
    expect(same((await panel()).titles, after), 'Redo: the warning with the new issue again');
    await page.evaluate(() => { window.__m = SC.session.ui.message; });
    await page.click('.topbar button:has-text("Save")');
    await page.waitForFunction(() => SC.session.ui.message && SC.session.ui.message !== window.__m && !SC.session.ui.busy);
    const now = run.texts();
    const written = Object.keys(now).filter(n => now[n] !== files[n]).sort();
    expect(same(written, [LI]), 'Save writes …_ISSUES.csv only (the file the new issue went into); nothing is renamed or merged', written);
    const saved = run.texts();
    await reopen();
    const p3 = await panel();
    expect(p3 && same(p3.titles, after), 'opened afresh: the same warning, with the new issue', p3 && p3.titles);
    expect(same(await pageRecs(), readerOf(saved).recs), 'and every record exactly as the app\'s reader reads the saved folder');
    await shot('9-after-a-new-issue-saved-reopened');
    // Delete nos. 3 and 4 (all of …_ISSUES_2.csv): the run is in one file; the warning goes. Undo brings it back.
    for (const iid of [ID.L4, ID.L3]) {
      await go('#/issues/' + ID.LEDGER + '/' + iid); await page.waitForSelector('.issue-form');
      await page.click('.sticky-actions button:has-text("Delete issue")'); await page.waitForTimeout(250);
    }
    await library();
    await noPanel('nos. 3 and 4 deleted, so the run is in …_ISSUES.csv alone');
    await page.click('.topbar button:has-text("Undo")'); await page.waitForTimeout(200);
    const p4 = await panel();
    expect(p4 && same(p4.titles, [want('The Specimen Ledger', ID.LEDGER, [[LI.replace(/\.csv$/, '_2.csv'), [SL(3)]], [LI, [SL(1), 'Specimen Ledger No. 1, Supplement', SL(2)]]])]),
      'one Undo (no. 3 back): the warning again, …_ISSUES_2.csv with 1 issue', p4 && p4.titles);
  });
  await section('10. The same files loaded as files (Load CSV files, not a folder): the same warning, word for word', async () => {
    const files = arrange(A);
    if (run) await run.close();
    run = await H.open(browser, app, {}, { onPage, noOpen: true }); page = run.page;
    await page.setInputFiles('input[type=file]', Object.keys(files).map(n => ({ name: n, mimeType: 'text/csv', buffer: Buffer.from(files[n], 'utf8') })));
    await page.waitForFunction(() => SC.session.ui.mode === 'files' && !SC.session.ui.busy);
    await library();
    const p = await panel();
    expect(p && p.text === textA, 'loaded as files: the same warning as for the folder', p && p.text);
    const s = await state();
    expect(same(await pageRecs(), readerOf(files).recs) && s.dirty.length === 0 && !s.canUndo, 'every record as the reader reads them; nothing marked changed');
  });

  expect(errors.length === 0, 'no page errors', errors.join('; '));
  if (run) await run.close();
  await browser.close();
  console.log(log.join('\n'));
  if (failures) { console.log('FAILED ' + failures + ' of ' + count + ' split-file checks'); process.exit(1); }
  console.log('PASSED ' + count + ' split-file checks');
})();
