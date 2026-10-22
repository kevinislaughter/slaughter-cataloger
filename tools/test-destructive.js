#!/usr/bin/env node
/* Slaughter Cataloger 3 — destructive actions in the browser (Stage A2, data integrity): Delete title,
   Delete issue, Delete heading, and "New issue after this" in the middle of a run.

   usage: node tools/test-destructive.js <app.html> [screenshot-dir]

   The invented library of tools/lib/integrity-library.js, in a folder held by this test
   (tools/lib/held-folder.js). Each workflow starts from a fresh open of that library and checks:
   - the question the app asks, word for word, and that declining it changes nothing;
   - exactly which records the action removes, adds or changes, and that every other record is
     exactly as it was;
   - Undo (one step, back to exactly what was there, nothing marked changed) and Redo;
   - Save: which files are written, every other file byte for byte as it was, the replaced files
     in _backups/ byte for byte;
   - the saved folder read back with the app's own reader: the same records, no warnings;
   - a fresh open of the saved folder in a new browser profile: the same records, no warnings.

   What the app does was established first (A2 batch 1, baseline 97e1cde). Two defects were found
   and checked as KNOWN (printed, not counted as a failure; a KNOWN check that stops reproducing
   fails, so the test is updated with the fix). Both are repaired and their checks are ordinary ones:
   - F-1 (DF-19; A2 repair batch, from 9b9c7ec): a file emptied by deleting its last record is still
     written with its header row only, and the app reads it back as an empty file of its kind, so
     new records can be added to it after a reopen; the library's only title cannot be deleted (the
     page says why), and a Titles file with no title is never written.
   - F-2 (DF-20; A2 repair batch DF-20, from 67acea8): with a title's issues in two Issues files, a
     new issue goes into the file of the issue it follows, right after it (sections 4c–4i: at the
     beginning, where the files meet, in the middle and at the end of such a run; New issue; a draft
     whose issue was undone). Before, it always went into the run's first file. The order between
     the two files (taken from their names) is unchanged and left for a decision; the checks pin it. */
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
const ID = L.ids, N = L.names;
const ORIGINAL = L.files;
const FT = N.titles, FA = N.authorities, LI = N.issues(ID.LEDGER), LC = N.contents(ID.LEDGER), MI = N.issues(ID.MODEL), MC = N.contents(ID.MODEL);

const log = [], errors = [];
let failures = 0, count = 0, knownCount = 0;
const step = s => log.push('· ' + s);
const expect = (cond, what, detail) => { count++; log.push((cond ? '  ok   ' : '  FAIL ') + what + (cond || detail === undefined ? '' : '\n         ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700))); if (!cond) failures++; };
// A known defect, left for a decision: reported while it reproduces; a failure once it does not.
const known = (id, reproduces, what, detail) => {
  if (reproduces) { knownCount++; log.push('  KNOWN ' + id + ': ' + what); return; }
  count++; failures++; log.push('  FAIL ' + id + ' no longer reproduces (update this check with the fix): ' + what + (detail === undefined ? '' : '\n         ' + JSON.stringify(detail).slice(0, 500)));
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The data rows of a CSV the app wrote, as { header: value }; and how many lines it has with anything in them.
const rowsOf = text => { const rows = globalThis.SC.csv.parse(text).rows; return rows.slice(1).filter(r => r.some(v => String(v).trim())).map(r => Object.fromEntries(rows[0].map((h, i) => [h, r[i]]))); };
const linesOf = text => globalThis.SC.csv.parse(text).rows.filter(r => r.some(v => String(v).trim())).length;

// ── Records, compared ──────────────────────────────────────────────────
// The page's records as plain data, by kind and ID.
const SNAP = () => {
  const s = SC.session.store.state, o = {};
  ['titles', 'issues', 'contents', 'authorities'].forEach(k => { o[k] = {}; s[k].forEach((r, id) => { o[k][id] = JSON.parse(JSON.stringify(r)); }); });
  return o;
};
// What changed between two snapshots: { kind: { removed: [ids], added: [ids], changed: [ids] } }, kinds with no change left out.
function diff(a, b) {
  const out = {};
  ['titles', 'issues', 'contents', 'authorities'].forEach(k => {
    const ia = Object.keys(a[k]), ib = Object.keys(b[k]);
    const removed = ia.filter(id => !(id in b[k])).sort(), added = ib.filter(id => !(id in a[k])).sort();
    const changed = ia.filter(id => id in b[k] && JSON.stringify(a[k][id]) !== JSON.stringify(b[k][id])).sort();
    if (removed.length || added.length || changed.length) out[k] = { removed, added, changed };
  });
  return out;
}
const want = spec => {
  const out = {};
  Object.keys(spec).forEach(k => { out[k] = { removed: (spec[k].removed || []).slice().sort(), added: (spec[k].added || []).slice().sort(), changed: (spec[k].changed || []).slice().sort() }; });
  return out;
};
// The values a file holds for a record (what reading it back can restore): schema fields, states, order, file.
const NORM = snap => {
  const keys = { titles: 'title', issues: 'issue', contents: 'content', authorities: 'authority' };
  const o = {};
  Object.keys(keys).forEach(k => {
    const ent = SC.schema.entities[keys[k]];
    o[k] = {};
    Object.keys(snap[k]).sort().forEach(id => {
      const r = snap[k][id], v = {};
      ent.fields.forEach(c => { v[c.key] = r[c.key] == null ? '' : r[c.key]; });
      ['titleID', 'issueID', 'contentID', 'authorityID', 'parentID', 'entryOrder', '_src', 'speculative'].forEach(x => { if (r[x] !== undefined) v[x] = r[x]; });
      ['spec', 'na', 'overrides'].forEach(x => { if (r[x]) v[x] = r[x].slice().sort(); });
      o[k][id] = v;
    });
  });
  return o;
};

(async () => {
  const browser = await chromium.launch();
  let run, page, answer = true;
  const dialogs = [];
  const onPage = p => {
    p.on('pageerror', e => errors.push('page error: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::/.test(m.text())) errors.push('console: ' + m.text()); });
    p.on('dialog', d => { dialogs.push(d.message()); if (answer) d.accept(); else d.dismiss(); });
    p.setDefaultTimeout(8000);                       // a missing button fails its section quickly
  };
  // Each workflow runs on its own: one that stops (a button missing, say) is a failure, and the next
  // workflow still runs from a fresh open.
  const section = async (name, fn) => {
    step(name);
    try { await fn(); } catch (e) { failures++; log.push('  FAIL the section stopped: ' + String(e && e.message || e).split('\n')[0]); }
  };
  const start = async files => { if (run) await run.close(); run = await H.open(browser, app, files || ORIGINAL, { onPage }); page = run.page; };
  const reopen = async () => { run = await run.reopen(); page = run.page; };
  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(200); };
  const snap = () => page.evaluate(SNAP);
  const norm = s => page.evaluate(NORM, s);
  const dirty = () => page.evaluate(() => Array.from(SC.session.store.dirty).sort());
  const hash = () => page.evaluate(() => location.hash);
  const message = () => page.evaluate(() => (SC.session.ui.message || {}).text || '');
  const notes = () => page.evaluate(() => (SC.session.ui.report || []).filter(r => r.level !== 'info').map(r => r.level + ' ' + (r.file || '') + ': ' + r.msg));
  const topButton = async label => { const b = page.locator('.topbar button:has-text("' + label + '")'); if (await b.isDisabled()) return false; await b.click(); await page.waitForTimeout(150); return true; };
  const undo = () => topButton('Undo'), redo = () => topButton('Redo');
  const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
  const save = async () => {
    await page.evaluate(() => { window.__m = SC.session.ui.message; });
    await page.click('.topbar button:has-text("Save")');
    await page.waitForFunction(() => SC.session.ui.message && SC.session.ui.message !== window.__m && !SC.session.ui.busy);
    return message();
  };
  // Clicks a danger button with the question declined, then accepted; returns the question.
  const declineThenAccept = async (selector, before) => {
    dialogs.length = 0; answer = false;
    await page.click(selector); await page.waitForTimeout(200);
    answer = true;
    const declined = dialogs.slice();
    expect(declined.length === 1 && same(diff(before, await snap()), {}) && (await dirty()).length === 0, 'the question declined: nothing changes, nothing is marked changed');
    dialogs.length = 0;
    await page.click(selector); await page.waitForTimeout(250);
    return dialogs[0] || '';
  };
  // Undo and Redo of the last step: back to exactly `before` (with the files that were marked changed
  // then, `beforeDirty`, none by default), then forward to exactly `after`.
  const undoRedo = async (before, after, label, beforeDirty) => {
    const got = await page.evaluate(() => SC.session.store.undoLabel);
    expect(label instanceof RegExp ? label.test(got) : got === label, 'it is one undo step: "' + got + '"', got);
    await undo();
    const bd = (beforeDirty || []).slice().sort();
    expect(same(diff(before, await snap()), {}) && same(await dirty(), bd), 'Undo: every record exactly as before, ' + (bd.length ? 'only ' + bd.join(', ') + ' still marked changed (as before)' : 'nothing marked changed'), await dirty());
    await redo();
    expect(same(diff(after, await snap()), {}), 'Redo: the same change again, record for record');
  };
  // Save, and check the files: only `written` rewritten (or made), everything else byte for byte, backups exact.
  const saveAndCheckFiles = async (before, written, what) => {
    const msg = await save();
    expect(/^Saved /.test(msg) && (await dirty()).length === 0, 'Save: "' + msg.slice(0, 160) + '"; nothing left marked changed');
    const now = run.texts();
    const rewritten = Object.keys(now).filter(n => now[n] !== before[n]).sort();
    expect(same(rewritten, written.slice().sort()), 'only ' + (what || written.join(', ')) + ' rewritten; every other file byte for byte as it was', rewritten);
    expect(Object.keys(before).every(n => n in now), 'no file removed from the folder');
    const bdirs = Object.values((run.folder().dirs._backups || { dirs: {} }).dirs);
    const replaced = written.filter(n => n in before);
    expect(replaced.length ? bdirs.some(d => replaced.every(n => d.files[n] && d.files[n].text === before[n])) : true,
      replaced.length ? 'the replaced files are in a _backups/ folder, byte for byte' : 'no file replaced (new files only), so nothing to back up');
    return now;
  };
  // The saved folder read with the app's own reader, as the app reads a folder it opens (an empty
  // file read as one: DF-19), then opened afresh in a new browser profile. `emptied`: files that
  // should now be empty files of the library.
  const readBack = async (expectedSnap, emptied) => {
    emptied = emptied || [];
    const texts = run.texts();
    const back = await page.evaluate(([fl, NORMs]) => {
      const NORM = eval('(' + NORMs + ')');
      const b = SC.records.buildLibrary(Object.keys(fl).map(n => SC.records.readFile(n, fl[n], { allowEmpty: true })), {});
      const s = { titles: {}, issues: {}, contents: {}, authorities: {} };
      ['titles', 'issues', 'contents', 'authorities'].forEach(k => b.state[k].forEach((r, id) => { s[k][id] = JSON.parse(JSON.stringify(r)); }));
      return { norm: NORM(s), notes: b.report.filter(r => r.level !== 'info').map(r => r.level + ' ' + r.file + ': ' + r.msg), info: b.report.filter(r => r.level === 'info').map(r => r.file + ': ' + r.msg),
        changed: b.changed, library: b.state.library, files: Array.from(b.state.files.keys()) };
    }, [texts, NORM.toString()]);
    const expNorm = await norm(expectedSnap);
    expect(same(back.norm, expNorm), 'the saved folder, read with the app\'s reader, holds exactly these records', diff(expNorm, back.norm));
    expect(back.notes.length === 0 && back.changed.length === 0, 'and raises no warning', back.notes);
    if (emptied.length) expect(emptied.every(f => back.files.indexOf(f) !== -1 && back.info.some(x => x.indexOf(f + ': No rows yet: an empty') === 0)),
      'the emptied file' + (emptied.length > 1 ? 's are' : ' is') + ' read as empty files of the library, each noted "No rows yet: an empty … file"', back.info);
    await reopen();
    const reopened = await norm(await snap());
    expect(same(reopened, expNorm), 'opened afresh in a new browser profile: exactly these records', diff(expNorm, reopened));
    const n2 = await notes();
    expect(n2.length === 0 && (await dirty()).length === 0, 'with no load warning, nothing marked changed', n2);
    if (emptied.length) expect(await page.evaluate(fs => fs.every(f => SC.session.store.state.files.has(f) && !SC.session.store.unloaded.has(f)), emptied),
      'and the emptied file' + (emptied.length > 1 ? 's' : '') + ' loaded: nothing is blocked under ' + (emptied.length > 1 ? 'their names' : 'its name'));
    return back;
  };
  // A library begun from the welcome screen, in the (empty) folder held by the test.
  const startNew = async () => { if (run) await run.close(); run = await H.open(browser, app, {}, { onPage, noOpen: true }); page = run.page; };
  const addTitle = async (name, code, year) => {
    await go('#/library/new'); await page.waitForSelector('#f-canonicalTitle');
    await page.fill('#f-canonicalTitle', name); await page.locator('#f-canonicalTitle').press('Tab');
    if (code) { await page.fill('#f-titleCode', code); await page.locator('#f-titleCode').press('Tab'); }
    await page.fill('#f-firstYear', year); await page.locator('#f-firstYear').press('Tab');
    await page.click('button:has-text("Add title")'); await page.waitForTimeout(300);
  };
  const counts = s => [s.titles, s.issues, s.contents, s.authorities].map(m => Object.keys(m).length).join('/');

  // ── A run in two Issues files (DF-20) ──
  // The Ledger with nos. 1–2 in `first` (Entry Order 1, 2) and nos. 3–4 in `second` (Entry Order 1, 2);
  // the folder lists `second` first when `secondFirst` (the order a folder hands files to the app).
  const splitRun = (first, second, secondFirst) => {
    const b = R.buildLibrary(Object.keys(ORIGINAL).map(n => R.readFile(n, ORIGINAL[n], {})), {});
    const st = b.state;
    [first, second].forEach(n => { if (!st.files.has(n)) st.files.set(n, Object.assign({}, st.files.get(LI), { name: n })); });
    [[ID.L1, first, 1], [ID.L2, first, 2], [ID.L3, second, 1], [ID.L4, second, 2]].forEach(([iid, f, eo]) =>
      st.issues.set(iid, R.freezeRec(Object.assign({}, st.issues.get(iid), { _src: f, entryOrder: eo }))));
    const parts = { [first]: R.writeFile(st, first), [second]: R.writeFile(st, second) };
    const rest = Object.fromEntries(Object.keys(ORIGINAL).filter(n => n !== LI).map(n => [n, ORIGINAL[n]]));
    return Object.assign(Object.fromEntries((secondFirst ? [second, first] : [first, second]).map(n => [n, parts[n]])), rest);
  };
  const LI1 = LI.replace(/\.csv$/, '_1.csv'), LI2 = LI.replace(/\.csv$/, '_2.csv');
  const shortFile = f => f.slice(f.lastIndexOf('_ISSUES'));
  // The Ledger's run as the app holds it: "IssueID@file:Entry Order", the new issue as NEW.
  const runIDs = newID => page.evaluate(([t, nid]) => SC.session.store.issuesOfTitle(t).map(i => (i.issueID === nid ? 'NEW' : i.issueID) + '@' + i._src + ':' + i.entryOrder), [ID.LEDGER, newID || '']);
  const runText = r => r.map(x => x.replace(ID.LEDGER + '-', '').replace(/@.*(_ISSUES[^:]*):/, '@$1:')).join(' · ');
  const at = (id, f, eo) => id + '@' + f + ':' + eo;
  // Records a new issue in the Ledger's run, opened from `files`, after `base` ("New issue after this"
  // on that issue; 'new': the New issue draft, which follows the run's last issue), and checks it:
  // the issue it follows; exactly one issue added, in `file` with Entry Order `eo`; only the issues
  // in `moved` changed, in Entry Order only; Entry Order unique in every file; only `file` marked
  // changed; the run (`run`) and the run list; Undo and Redo; a reload before saving (`reload`); Save
  // (only `file` written, its backup); the saved file's rows; the saved folder read back and opened
  // afresh: the same records and run.
  const insertInRun = async o => {
    await start(o.files);
    const s0 = await snap();
    expect((await notes()).length === 0 && same(await runIDs(), o.opened), 'opened with no warning; the run: ' + runText(o.opened), await runIDs());
    if (o.base === 'new') { await go('#/issues/' + ID.LEDGER + '/new'); await page.waitForSelector('.draft-card'); }
    else {
      await go('#/issues/' + ID.LEDGER + '/' + o.base); await page.waitForSelector('.issue-form');
      await page.click('.sticky-actions button:has-text("New issue after this")'); await page.waitForSelector('.draft-card');
    }
    const follows = await page.inputValue('.advance-bar select');
    expect(follows === o.follows, 'the draft follows ' + s0.issues[o.follows].shortname + (o.base === 'new' ? ' (the last issue of the run)' : ''), follows);
    await page.fill('#f-shortname', o.name); await page.locator('#f-shortname').press('Enter');
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    const s1 = await snap(), d = diff(s0, s1), newID = (d.issues || { added: [] }).added[0] || '';
    const moved = Object.keys(o.moved);
    expect(same(d, want({ issues: { added: [newID], changed: moved } })), 'one issue added' + (moved.length ? '; ' + moved.map(i => s0.issues[i].shortname).join(', ') + ' changed' : '; no other record changed') + '; every other record exactly as it was', d);
    expect(moved.every(i => same(Object.keys(s1.issues[i]).filter(k => JSON.stringify(s0.issues[i][k]) !== JSON.stringify(s1.issues[i][k])), ['entryOrder']) && s1.issues[i].entryOrder === o.moved[i] && s1.issues[i]._src === s0.issues[i]._src),
      moved.length ? 'they moved down one in their own file, Entry Order only (' + moved.map(i => s0.issues[i].shortname + ' → ' + o.moved[i]).join(', ') + ')' : 'no issue moved');
    const nu = s1.issues[newID] || {};
    expect(SC.ids.RE.issueID.test(newID) && newID.indexOf(ID.LEDGER + '-K') === 0 && nu._src === o.file && nu.entryOrder === o.eo,
      'the new issue (' + newID + ') goes into ' + shortFile(o.file) + ', the file of the issue it follows, with Entry Order ' + o.eo, nu._src + ':' + nu.entryOrder);
    const perFile = {};
    Object.values(s1.issues).forEach(i => { (perFile[i._src] = perFile[i._src] || []).push(i.entryOrder); });
    expect(Object.values(perFile).every(l => new Set(l).size === l.length), 'Entry Order is unique in every Issues file');
    expect(same(await dirty(), [o.file]), 'only ' + shortFile(o.file) + ' is marked changed', await dirty());
    const r1 = await runIDs(newID);
    expect(same(r1, o.run), 'the run: ' + runText(o.run), runText(r1));
    if (o.then) o.then(r1);
    await go('#/issues/' + ID.LEDGER + '/' + newID); await page.waitForSelector('.run-item');
    const names = await page.$$eval('.run-item .ri-name', els => els.map(e => e.textContent.trim()));
    const k = o.run.findIndex(x => x.indexOf('NEW@') === 0);
    expect(names.length === o.run.length && names.findIndex(n => n.indexOf(o.tag) !== -1) === k, 'the run list shows it at position ' + (k + 1) + ' of ' + o.run.length, names);
    await undoRedo(s0, s1, /^Record issue /);
    if (o.reload) {
      // A reload before saving: the work is restored from the browser and the folder read again.
      await page.reload();
      await page.waitForFunction(() => SC.session && SC.session.ui.mode === 'folder' && !SC.session.ui.busy && SC.session.ui.access === 'owner');
      await page.waitForTimeout(300);
      const s2 = await snap();
      expect(same(diff(s1, s2), {}) && same(await dirty(), [o.file]) && same(await runIDs(newID), o.run),
        'after a reload before saving: the same records and run, ' + shortFile(o.file) + ' still marked changed', { diff: diff(s1, s2), dirty: await dirty() });
    }
    disk = await saveAndCheckFiles(o.files, [o.file], shortFile(o.file));
    const rows = rowsOf(disk[o.file]);
    const inFile = o.run.filter(x => x.indexOf('@' + o.file + ':') !== -1).map(x => x.split('@')[0]);
    expect(same(rows.map(r => r.IssueID === newID ? 'NEW' : r.IssueID), inFile) && same(rows.map(r => r['Entry Order']), inFile.map((x, n) => String(n + 1))),
      shortFile(o.file) + ' as saved: its rows in run order, Entry Order 1 to ' + inFile.length);
    await readBack(s1);
    const r3 = await runIDs(newID);
    expect(same(r3, o.run), 'after the fresh open: the same run, files and Entry Orders', runText(r3));
    if (o.shot) { await go('#/issues/' + ID.LEDGER + '/' + newID); await page.waitForSelector('.run-item'); await shot(o.shot); }
    return newID;
  };

  let S0 = null, disk = null;
  try { await start(); S0 = await snap(); } catch (e) { failures++; log.push('  FAIL the library did not open: ' + String(e && e.message || e).split('\n')[0]); }
  if (S0) {
  // ════ 1. Delete title ════
  await section('1. Delete title: only a title with no issues and no contents can be deleted', async () => {
    await start();
    expect(counts(S0) === '4/7/13/3', 'the invented library: 4 titles, 7 issues, 13 contents items, 3 headings (titles/issues/contents/headings: ' + counts(S0) + ')');
    for (const t of ['LEDGER', 'HERALD', 'MODEL']) {
      await go('#/library/' + ID[t]);
      expect(await page.locator('.sticky-actions button:has-text("Delete title")').count() === 0, ID[t] + ' (it has issues and contents): no Delete title button');
    }
    await go('#/library/' + ID.TRIAL);
    expect(await page.locator('.sticky-actions button:has-text("Delete title")').count() === 1, ID.TRIAL + ' (no issues, no contents): Delete title offered');
    const q1 = await declineThenAccept('.sticky-actions button:has-text("Delete title")', S0);
    expect(q1 === 'Delete the title record "The Trial Quarterly"? You can undo this until you close the app.', 'the question: ' + q1);
    const S1 = await snap();
    expect(same(diff(S0, S1), want({ titles: { removed: [ID.TRIAL] } })), 'exactly one record removed, the title; every other record exactly as it was', diff(S0, S1));
    expect(same(await dirty(), [FT]) && await hash() === '#/library', 'only the Titles file marked changed; the app returns to the Library');
    await undoRedo(S0, S1, 'Delete title The Trial Quarterly');
    disk = await saveAndCheckFiles(ORIGINAL, [FT], 'the Titles file');
    const trows = rowsOf(disk[FT]);
    expect(trows.length === 3 && !trows.some(r => r.TitleID === ID.TRIAL), 'the Titles file holds 3 rows, none of them the deleted title');
    await readBack(S1);

  });
  await section('1b. A title with all its records: its issue deleted (with its contents), then the title', async () => {
    await start();
    await go('#/library/' + ID.MODEL);
    expect(await page.locator('.sticky-actions button:has-text("Delete title")').count() === 0, 'before: no Delete title button for ' + ID.MODEL);
    await go('#/issues/' + ID.MODEL + '/' + ID.M1); await page.waitForSelector('.issue-form');
    dialogs.length = 0;
    await page.click('.sticky-actions button:has-text("Delete issue")'); await page.waitForTimeout(250);
    expect(dialogs[0] === 'Delete Model Weekly No. 1 and its 2 contents items? You can undo this until you close the app.', 'Delete issue asks: ' + dialogs[0]);
    await go('#/library/' + ID.MODEL);
    expect(await page.locator('.sticky-actions button:has-text("Delete title")').count() === 1, 'with its issue gone, Delete title is offered');
    dialogs.length = 0;
    await page.click('.sticky-actions button:has-text("Delete title")'); await page.waitForTimeout(250);
    const S1b = await snap();
    expect(same(diff(S0, S1b), want({ titles: { removed: [ID.MODEL] }, issues: { removed: [ID.M1] }, contents: { removed: [ID.M1a, ID.M1b] } })),
      'exactly 4 records removed (the title, its issue, its 2 contents items); every other record exactly as it was', diff(S0, S1b));
    expect(same(await dirty(), [MC, MI, FT].sort()), 'the Titles file and the title\'s Issues and Contents files marked changed');
    await undo(); await undo();
    expect(same(diff(S0, await snap()), {}) && (await dirty()).length === 0, 'two Undos: everything back, nothing marked changed');
    await redo(); await redo();
    expect(same(diff(S1b, await snap()), {}), 'two Redos: the same 4 records removed again');
    disk = await saveAndCheckFiles(ORIGINAL, [FT, MI, MC], 'the Titles file and the title\'s two files');
    const emptied = [MI, MC].filter(n => linesOf(disk[n]) === 1);
    expect(emptied.length === 2, 'the title\'s Issues and Contents files, emptied, are written with their header row only', emptied);
    expect([MI, MC].every(n => R.readFile(n, disk[n], {}).error === 'No data rows.'), 'the reader without the option (as convert-to-3.js calls it) still refuses them: "No data rows."');
    // A reload in the same browser profile: the work is restored and the folder read again (reconnecting).
    await page.reload();
    await page.waitForFunction(() => SC.session && SC.session.ui.mode === 'folder' && !SC.session.ui.busy && SC.session.ui.access === 'owner');
    await page.waitForTimeout(300);
    const rn = await notes();
    expect(rn.length === 0 && (await dirty()).length === 0 && await page.evaluate(fs => fs.every(f => SC.session.store.state.files.has(f) && !SC.session.store.unloaded.has(f)), [MI, MC]),
      'after a reload (the folder read again, as on reconnecting): no warning ("No longer reads cleanly" before the repair), both files still part of the library', rn);
    await readBack(S1b, [MI, MC]);
    // After the fresh open: the title added again, an issue recorded for it, a contents item for that issue.
    const before1b = run.texts();
    await addTitle('The Model Weekly', 'MODELWKX', '1901');
    expect(await page.evaluate(id => SC.session.store.state.titles.has(id), ID.MODEL), 'the title can be added again');
    const S1c = await snap();
    await go('#/issues/' + ID.MODEL); await page.click('button:has-text("Record the first issue")'); await page.waitForSelector('.draft-card');
    await page.fill('#f-number', '2'); await page.locator('#f-number').press('Tab');
    await page.click('.sticky-actions button:has-text("Record issue")'); await page.waitForTimeout(300);
    const m1b = await message();
    const S1d = await snap(), d1d = diff(S1c, S1d), newIssue = (d1d.issues || { added: [] }).added[0] || '';
    expect(/^Recorded /.test(m1b) && same(d1d, want({ issues: { added: [newIssue] } })), 'an issue can be recorded for it: "' + m1b.slice(0, 70) + '"; one record added, nothing else changed', d1d);
    expect(S1d.issues[newIssue] && S1d.issues[newIssue]._src === MI, 'the new issue goes into the emptied Issues file, ' + MI);
    await undoRedo(S1c, S1d, /^Record issue /, [FT]);
    await go('#/contents/' + ID.MODEL + '/' + newIssue); await page.waitForSelector('table.grid-toc');
    await page.click('tr.draft-row:last-child td.c-itemTitle .cell'); await page.keyboard.type('A New Prospectus'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const S1e = await snap(), d1e = diff(S1d, S1e), newItem = (d1e.contents || { added: [] }).added[0] || '';
    expect(same(d1e, want({ contents: { added: [newItem] } })) && S1e.contents[newItem]._src === MC && S1e.contents[newItem].issueID === newIssue, 'a contents item can be added to it, and goes into the emptied Contents file, ' + MC, d1e);
    disk = await saveAndCheckFiles(before1b, [FT, MI, MC], 'the Titles file and the two once-empty files (their empty versions backed up)');
    expect(rowsOf(disk[MI]).length === 1 && rowsOf(disk[MI])[0].IssueID === newIssue && rowsOf(disk[MC]).length === 1 && rowsOf(disk[MC])[0].ContentID === newItem, 'the Issues file holds the new issue, the Contents file the new item');
    await readBack(S1e);

  });
  // ════ 2. Delete issue ════
  await section('2. Delete issue: the issue and its contents, nothing else', async () => {
    await start();
    await go('#/issues/' + ID.LEDGER + '/' + ID.L2); await page.waitForSelector('.issue-form');
    const q2 = await declineThenAccept('.sticky-actions button:has-text("Delete issue")', S0);
    expect(q2 === 'Delete Specimen Ledger No. 2 and its 4 contents items? You can undo this until you close the app.', 'the question names the issue and its 4 contents items: ' + q2);
    const S2 = await snap();
    expect(same(diff(S0, S2), want({ issues: { removed: [ID.L2] }, contents: { removed: [ID.L2a, ID.L2b, ID.L2c, ID.L2d] } })),
      'exactly 5 records removed: the issue, its section and the section\'s two parts, and its notice; every other record exactly as it was', diff(S0, S2));
    expect(same(await dirty(), [LC, LI].sort()), 'only the title\'s Issues and Contents files marked changed');
    expect(await hash() === '#/issues/' + ID.LEDGER + '/' + ID.L3, 'the app moves on to the next issue in the run (no. 3)', await hash());
    const eo2 = await page.evaluate(t => SC.session.store.issuesOfTitle(t).map(i => i.number + ':' + i.entryOrder), ID.LEDGER);
    expect(same(eo2, ['1:1', '3:3', '4:4']), 'the other issues keep their Entry Order (1, 3, 4: a gap where no. 2 was)', eo2);
    await undoRedo(S0, S2, 'Delete issue Specimen Ledger No. 2');
    await go('#/issues/' + ID.LEDGER + '/' + ID.L4); await page.waitForSelector('.issue-form');
    dialogs.length = 0;
    await page.click('.sticky-actions button:has-text("Delete issue")'); await page.waitForTimeout(250);
    expect(dialogs[0] === 'Delete Specimen Ledger No. 4? You can undo this until you close the app.', 'an issue with no contents: the question names the issue only: ' + dialogs[0]);
    const S2b = await snap();
    expect(same(diff(S2, S2b), want({ issues: { removed: [ID.L4] } })), 'exactly one record removed, the issue', diff(S2, S2b));
    expect(await hash() === '#/issues/' + ID.LEDGER + '/' + ID.L3, 'the last issue deleted: the app moves to the one before it (no. 3)', await hash());
    disk = await saveAndCheckFiles(ORIGINAL, [LI, LC], 'the title\'s Issues and Contents files');
    expect(same(rowsOf(disk[LI]).map(r => r['Whole No.'] + ':' + r['Entry Order']), ['1:1', '3:3']), 'the Issues file: no. 1 and no. 3, with Entry Order 1 and 3');
    expect(rowsOf(disk[LC]).length === 4 && rowsOf(disk[LC]).every(r => [ID.L1, ID.L3].indexOf(r.IssueID) !== -1), 'the Contents file: the 4 items of nos. 1 and 3 only');
    await readBack(S2b);
    expect(same(await page.evaluate(t => SC.session.store.issuesOfTitle(t).map(i => i.number + ':' + i.entryOrder), ID.LEDGER), ['1:1', '3:3']), 'after the fresh open, Entry Order is still 1 and 3: the reader keeps a gap');
    await shot('2-after-delete-issue-reopened');

  });
  // ════ 3. Delete heading ════
  await section('3. Delete heading: the heading only; credits as printed', async () => {
    await start();
    await go('#/names/' + ID.PUBLIC); await page.waitForSelector('.nm-detail');
    const q3 = await declineThenAccept('.nm-detail button:has-text("Delete heading")', S0);
    expect(q3 === 'Delete the heading "Public, John Q."? The credits stay as they are in the contents; you can undo this.', 'the question: ' + q3);
    const S3 = await snap();
    expect(same(diff(S0, S3), want({ authorities: { removed: [ID.PUBLIC] } })), 'exactly one record removed, the heading; every contents item (and its credit) and every other record exactly as it was', diff(S0, S3));
    expect(same(await dirty(), [FA]) && await hash() === '#/names', 'only the Authorities file marked changed; the app returns to Names');
    const ix = await page.evaluate(() => SC.names.index(SC.session.store.state).entries.filter(e => /Public/.test(e.label)).map(e => e.kind + ':' + e.label).sort());
    expect(same(ix, ['name:J. Q. Public', 'name:John Q. Public']), 'Names now lists "J. Q. Public" and "John Q. Public" with no heading', ix);
    expect(S3.authorities[ID.DOE].seeAlso === 'Public, John Q.', 'another heading\'s See Also naming the deleted heading is left as it was (observation O-2)');
    await undoRedo(S0, S3, 'Delete heading Public, John Q.');
    disk = await saveAndCheckFiles(ORIGINAL, [FA], 'the Authorities file');
    expect(rowsOf(disk[FA]).length === 2 && !rowsOf(disk[FA]).some(r => r.AuthorityID === ID.PUBLIC), 'the Authorities file holds the 2 other headings');
    await readBack(S3);

    step('3b. Every heading deleted: the Authorities file is kept, empty, and headings can be made again (DF-19)');
    for (const k of ['ROE', 'DOE']) { await go('#/names/' + ID[k]); await page.waitForSelector('.nm-detail'); await page.click('.nm-detail button:has-text("Delete heading")'); await page.waitForTimeout(200); }
    const S3b = await snap();
    expect(Object.keys(S3b.authorities).length === 0 && same(diff(S3, S3b), want({ authorities: { removed: [ID.ROE, ID.DOE] } })), 'no heading left; nothing else changed');
    disk = await saveAndCheckFiles(run.texts(), [FA], 'the Authorities file');
    expect(linesOf(disk[FA]) === 1, 'the emptied Authorities file is written with its header row only');
    await readBack(S3b, [FA]);
    const before3b = run.texts();
    const key = await page.evaluate(() => SC.names.index(SC.session.store.state).entries.find(e => e.label === 'Richard Roe').id);
    await go('#/names/' + key); await page.waitForSelector('.nm-make');
    await page.click('.nm-make button:has-text("Make heading")'); await page.waitForTimeout(250);
    const S3c = await snap(), d3c = diff(S3b, S3c), newHead = (d3c.authorities || { added: [] }).added[0] || '';
    expect(same(d3c, want({ authorities: { added: [newHead] } })) && S3c.authorities[newHead]._src === FA && S3c.authorities[newHead].name === 'Roe, Richard',
      'a heading can be made ("Roe, Richard"), and goes into the emptied Authorities file; nothing else changed', d3c);
    await undoRedo(S3b, S3c, /^Make heading /);
    disk = await saveAndCheckFiles(before3b, [FA], 'the Authorities file (its empty version backed up)');
    expect(rowsOf(disk[FA]).length === 1 && rowsOf(disk[FA])[0].AuthorityID === newHead, 'the Authorities file holds the new heading');
    await readBack(S3c);

  });
  await section('3c. The library\'s only title cannot be deleted, and the page says why (DF-19)', async () => {
    const oneTitle = await (async () => {
      const b = R.buildLibrary(Object.keys(ORIGINAL).filter(n => n === FT).map(n => R.readFile(n, ORIGINAL[n], {})), {});
      Array.from(b.state.titles.keys()).filter(t => t !== ID.TRIAL).forEach(t => b.state.titles.delete(t));
      return { [FT]: R.writeFile(b.state, FT) };
    })();
    await start(oneTitle);
    const lib0 = await page.evaluate(() => SC.session.store.state.library);
    expect(lib0.slug === L.slug && lib0.name === 'Integrity Test Library' && lib0.note !== '', 'a library of one title, opened: its slug, name and note are read from the Titles file');
    const SA = await snap();
    await go('#/library/' + ID.TRIAL);
    const del = page.locator('.sticky-actions button:has-text("Delete title")');
    expect(await del.count() === 1 && await del.isDisabled(), 'Delete title is shown for the only title, but off');
    const why = await page.locator('#last-title-note').innerText().catch(() => '');
    expect(why === 'This is the library\'s only title, so it cannot be deleted: the library\'s name, note and slug are kept with the titles in the Titles file. Add another title first if this one should go.', 'beside it, why: "' + why + '"');
    expect(await del.getAttribute('aria-describedby') === 'last-title-note', 'the explanation describes the button (aria-describedby)');
    await shot('3c-only-title');
    dialogs.length = 0;
    await del.click({ force: true, timeout: 2000 }).catch(() => {}); await page.waitForTimeout(200);
    expect(dialogs.length === 0 && same(diff(SA, await snap()), {}) && (await dirty()).length === 0, 'clicking it does nothing: no question, no change');
    await addTitle('The Second Specimen', 'SECSPECX', '1900');
    const SB = await snap();
    expect(same(diff(SA, SB), want({ titles: { added: ['SECSPECX-1900'] } })), 'a second title added');
    await go('#/library/' + ID.TRIAL);
    expect(await del.count() === 1 && !(await del.isDisabled()) && await page.locator('#last-title-note').count() === 0, 'with two titles, Delete title is on again, with no explanation');
    dialogs.length = 0;
    await del.click(); await page.waitForTimeout(250);
    const SC2 = await snap();
    expect(dialogs.length === 1 && same(diff(SB, SC2), want({ titles: { removed: [ID.TRIAL] } })), 'the first title can be deleted (asked, then removed)');
    await go('#/library/SECSPECX-1900');
    expect(await del.isDisabled() && await page.locator('#last-title-note').count() === 1, 'now the second is the only title: its Delete title is off, with the explanation');
    disk = await saveAndCheckFiles(oneTitle, [FT], 'the Titles file');
    const r3c = rowsOf(disk[FT]);
    expect(r3c.length === 1 && r3c[0].TitleID === 'SECSPECX-1900' && r3c[0]['Title Library Slug'] === L.slug && r3c[0]['Title Library Name'] === 'Integrity Test Library' && r3c[0]['Title Library Note'] === lib0.note,
      'the Titles file holds the one title, with the library\'s slug, name and note');
    await readBack(SC2);
    const lib1 = await page.evaluate(() => SC.session.store.state.library);
    expect(lib1.slug === lib0.slug && lib1.name === lib0.name && lib1.note === lib0.note, 'opened afresh: the library\'s slug, name and note are as they were');
  });
  await section('3d. A new library\'s only title, undone: a Titles file with no title is never written (DF-19)', async () => {
    await startNew();
    await page.click('button:has-text("Start a new library")');
    await page.fill('#nl-name', 'Undo Test Library'); await page.fill('#nl-note', 'Invented: its only title is undone.');
    await page.click('button:has-text("Choose an empty folder for it")');
    await page.waitForSelector('#f-canonicalTitle');
    const FT2 = 'SCAT_UNDO-TEST-LIBRARY_TITLES.csv';
    await page.fill('#f-canonicalTitle', 'The Only Specimen'); await page.locator('#f-canonicalTitle').press('Tab');
    await page.fill('#f-firstYear', '1910'); await page.locator('#f-firstYear').press('Tab');
    await page.click('button:has-text("Add title")'); await page.waitForTimeout(300);
    const SN = await snap();
    expect(Object.keys(SN.titles).length === 1, 'a new library with one title');
    disk = await saveAndCheckFiles({}, [FT2], 'the new Titles file');
    const t0 = disk[FT2];
    expect(rowsOf(t0).length === 1 && rowsOf(t0)[0]['Title Library Slug'] === 'UNDO-TEST-LIBRARY' && rowsOf(t0)[0]['Title Library Note'] === 'Invented: its only title is undone.', 'saved: the Titles file holds the title, with the library\'s slug, name and note');
    await undo();
    expect(Object.keys((await snap()).titles).length === 0 && same(await dirty(), [FT2]), 'Undo of "Add title": no title left, the Titles file marked changed');
    await page.evaluate(() => { window.__m = SC.session.ui.message; });
    await page.click('.topbar button:has-text("Save")');
    await page.waitForFunction(() => SC.session.ui.message && SC.session.ui.message !== window.__m && !SC.session.ui.busy);
    const m3d = await page.evaluate(() => SC.session.ui.message);
    expect(m3d.level === 'error' && m3d.text === 'Not saved: ' + FT2 + ' — it would hold no title, and the library\'s name, note and slug are kept only in its rows. Add a title (or undo the step that removed the last one), then save.',
      'Save writes no Titles file without a title, and says why: "' + m3d.text.slice(0, 120) + '…"', m3d);
    expect(run.texts()[FT2] === t0 && same(await dirty(), [FT2]), 'the Titles file on disk is as it was, and stays marked changed');
    await redo();
    expect(Object.keys((await snap()).titles).length === 1 && (await dirty()).length === 0, 'Redo: the title is back, and nothing is marked changed (the file holds it already)');
    await readBack(SN);
    const libN = await page.evaluate(() => SC.session.store.state.library);
    expect(libN.slug === 'UNDO-TEST-LIBRARY' && libN.name === 'Undo Test Library' && libN.note === 'Invented: its only title is undone.', 'opened afresh: the library\'s slug, name and note are kept');

  });
  await section('3e. Files mode (Save downloads): a header-only Titles file left by the defect, then a change to the library (DF-19)', async () => {
    if (run) { await run.close(); run = null; }
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
    page = await ctx.newPage(); onPage(page);
    const downloads = [];
    page.on('download', d => downloads.push(d.suggestedFilename()));
    await page.goto('file://' + app); await page.waitForSelector('text=Load CSV files');
    const st0 = globalThis.SC.emptyState();
    st0.library = Object.freeze({ slug: L.slug, name: '', note: '' });
    st0.files.set(FT, { name: FT, kind: 'title', extraHeaders: [], hash: '', lastModified: 0, schemaVersion: globalThis.SC.schema.VERSION, setAside: [] });
    const HI = N.issues(ID.HERALD), HC = N.contents(ID.HERALD);
    const loaded = { [FT]: R.writeFile(st0, FT), [HI]: ORIGINAL[HI], [HC]: ORIGINAL[HC] };
    expect(linesOf(loaded[FT]) === 1, 'the Titles file is its header row only (as the defect left it after the last title was deleted)');
    await page.setInputFiles('input[type=file]', Object.keys(loaded).map(n => ({ name: n, mimeType: 'text/csv', buffer: Buffer.from(loaded[n], 'utf8') })));
    await page.waitForFunction(() => SC.session.ui.mode === 'files' && !SC.session.ui.busy);
    const s0 = await page.evaluate(() => { const st = SC.session.store.state; return { slug: st.library.slug, name: st.library.name, titles: st.titles.size, issues: st.issues.size, contents: st.contents.size, titlesFile: (Array.from(st.files.values()).find(f => f.kind === 'title') || {}).name || '' }; });
    expect(s0.slug === L.slug && s0.titles === 0 && s0.issues === 2 && s0.contents === 3 && s0.titlesFile === FT, 'loaded as files: the empty Titles file is the library\'s Titles file; the slug comes from the other files', s0);
    expect(await page.evaluate(n => (SC.session.ui.report || []).some(r => r.level === 'info' && r.file === n && /^No rows yet: an empty Titles file/.test(r.msg)), FT), 'it is noted "No rows yet: an empty Titles file"');
    await go('#/library');
    await page.click('button:has-text("Library details")');
    await page.fill('#f-name', 'Integrity Test Library, Renamed'); await page.locator('#f-name').press('Enter'); await page.waitForTimeout(200);
    expect(same(await dirty(), [FT, HI].sort()), 'renaming the library marks the Titles file, empty as it is, and the Issues file changed, not the Contents file (its rows do not carry the name)', await dirty());
    await page.click('.topbar button:has-text("Download changed files")');
    await page.waitForFunction(() => SC.session.ui.download && !SC.session.ui.busy);
    await page.waitForTimeout(500);
    const m3e = await page.evaluate(() => SC.session.ui.message);
    expect(same(downloads, [HI]), 'Download changed files downloads the Issues file (its rows carry the library\'s name), not the Titles file', downloads);
    expect(m3e && m3e.level === 'error' && m3e.text === 'Not saved: ' + FT + ' — it would hold no title, and the library\'s name, note and slug are kept only in its rows. Add a title (or undo the step that removed the last one), then save.',
      'and says why the Titles file is not among them', m3e);
    expect(await page.locator('.download-banner').innerText().then(t => t.indexOf(HI) !== -1 && t.indexOf(HC) === -1 && t.indexOf(FT) === -1), 'the download banner names the downloaded file only');
    await page.click('button:has-text("I\'ve replaced the files")'); await page.waitForTimeout(200);
    expect(same(await dirty(), [FT]), 'confirmed: the downloaded file counts as saved; the Titles file stays changed', await dirty());
    await ctx.close(); page = null;
  });
  // ════ 4. New issue after this, in the middle of the run ════
  await section('4. New issue after this, in the middle of the run: the later issues move down one', async () => {
    await start();
    await go('#/issues/' + ID.LEDGER + '/' + ID.L2); await page.waitForSelector('.issue-form');
    await page.click('.sticky-actions button:has-text("New issue after this")'); await page.waitForSelector('.draft-card');
    expect(await page.inputValue('#f-number') === '3', 'the draft follows no. 2 (its number moves on to 3)');
    await page.fill('#f-number', ''); await page.locator('#f-number').press('Tab');
    await page.fill('#f-shortname', 'Specimen Ledger No. 2, Supplement'); await page.locator('#f-shortname').press('Enter');
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    const S4 = await snap();
    const d4 = diff(S0, S4), newID = (d4.issues || { added: [] }).added[0] || '';
    expect(same(d4, want({ issues: { added: [newID], changed: [ID.L3, ID.L4] } })), 'one issue added; nos. 3 and 4 changed; every other record exactly as it was', d4);
    const only = (a, b) => Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    expect([ID.L3, ID.L4].every(i => same(only(S0.issues[i], S4.issues[i]), ['entryOrder'])), 'nos. 3 and 4 differ in Entry Order only');
    expect(SC.ids.RE.issueID.test(newID) && newID.indexOf(ID.LEDGER + '-K') === 0 && S4.issues[newID]._src === LI, 'the new issue has a new IssueID of the title (' + newID + ') and goes into the title\'s Issues file');
    const eo4 = await page.evaluate(t => SC.session.store.issuesOfTitle(t).map(i => (i.shortname || i.number) + ':' + i.entryOrder), ID.LEDGER);
    expect(same(eo4, ['Specimen Ledger No. 1:1', 'Specimen Ledger No. 2:2', 'Specimen Ledger No. 2, Supplement:3', 'Specimen Ledger No. 3:4', 'Specimen Ledger No. 4:5']),
      'Entry Order: no. 1 → 1, no. 2 → 2, the new issue → 3, no. 3 → 4, no. 4 → 5', eo4);
    expect(same(await dirty(), [LI]), 'only the title\'s Issues file marked changed (the Contents file is not touched)');
    await go('#/issues/' + ID.LEDGER + '/' + newID); await page.waitForSelector('.run-item');
    const runNames = await page.$$eval('.run-item .ri-name', els => els.map(e => e.textContent.trim()));
    expect(runNames.length === 5 && /Supplement/.test(runNames[2]), 'the run list shows it third, after no. 2', runNames);
    await undoRedo(S0, S4, 'Record issue Specimen Ledger No. 2, Supplement');
    disk = await saveAndCheckFiles(ORIGINAL, [LI], 'the title\'s Issues file');
    const irows = rowsOf(disk[LI]);
    expect(same(irows.map(r => r['Entry Order']), ['1', '2', '3', '4', '5']) && same(irows.map(r => r.IssueID), [ID.L1, ID.L2, newID, ID.L3, ID.L4]), 'the Issues file: five rows in run order, Entry Order 1 to 5');
    await readBack(S4);
    const eo4b = await page.evaluate(t => SC.session.store.issuesOfTitle(t).map(i => i.issueID + ':' + i.entryOrder), ID.LEDGER);
    expect(same(eo4b, [ID.L1 + ':1', ID.L2 + ':2', newID + ':3', ID.L3 + ':4', ID.L4 + ':5']), 'after the fresh open, the run and its Entry Order are the same');
    await shot('4-after-insert-reopened');

  });
  await section('4b. New issue after the last issue: added at the end, nothing else changes', async () => {
    await start();
    await go('#/issues/' + ID.LEDGER + '/' + ID.L4); await page.waitForSelector('.issue-form');
    await page.click('.sticky-actions button:has-text("New issue after this")'); await page.waitForSelector('.draft-card');
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    const S4b = await snap(), d4b = diff(S0, S4b), new4b = (d4b.issues || { added: [] }).added[0] || '';
    expect(same(d4b, want({ issues: { added: [new4b] } })) && S4b.issues[new4b].entryOrder === 5 && S4b.issues[new4b].number === '5', 'one issue added (no. 5, Entry Order 5); no other record changed', d4b);
    await saveAndCheckFiles(ORIGINAL, [LI], 'the title\'s Issues file');
    await readBack(S4b);

  });
  // ════ 4c–4i. A title's run in two Issues files (DF-20) ════
  // The run is shown file by file, Entry Order within each file; which file comes first is taken from
  // the files' names (store.indexes), not from the order the folder lists them. That order between
  // files is unchanged by the DF-20 repair (left for a decision); what the repair changes is where a
  // new issue goes: into the file of the issue it follows, right after it.
  await section('4c. A run in two Issues files, …_ISSUES.csv (nos. 1–2) and …_ISSUES_2.csv (nos. 3–4): New issue after no. 1 (DF-20; formerly KNOWN F-2)', async () => {
    const opened = [at(ID.L3, LI2, 1), at(ID.L4, LI2, 2), at(ID.L1, LI, 1), at(ID.L2, LI, 2)];
    await start(splitRun(LI, LI2, true));
    expect(same(await runIDs(), opened), 'listed by the folder the other way round, the run is the same (' + runText(opened) + '): its order does not depend on the order the folder lists the files', runText(await runIDs()));
    await insertInRun({ files: splitRun(LI, LI2, false), opened, base: ID.L1, follows: ID.L1, name: 'Specimen Ledger No. 1, Supplement', tag: 'Supplement', file: LI, eo: 2, moved: { [ID.L2]: 3 },
      run: [at(ID.L3, LI2, 1), at(ID.L4, LI2, 2), at(ID.L1, LI, 1), at('NEW', LI, 2), at(ID.L2, LI, 3)], reload: true, shot: '4c-split-after-no1-reopened',
      then: r => {
        const a = r.findIndex(x => x.indexOf('NEW@') === 0), b = r.findIndex(x => x.indexOf(ID.L1 + '@') === 0);
        expect(b !== -1 && a === b + 1, 'F-2 (DF-20): recorded "after no. 1", the new issue is next to no. 1 in the run (before the repair it went to the end of …_ISSUES_2.csv, after no. 4)', runText(r));
      } });
  });
  const B = splitRun(LI1, LI2, false);
  const openedB = [at(ID.L1, LI1, 1), at(ID.L2, LI1, 2), at(ID.L3, LI2, 1), at(ID.L4, LI2, 2)];
  await section('4d. A run in two Issues files, …_ISSUES_1.csv (nos. 1–2) and …_ISSUES_2.csv (nos. 3–4), at the beginning: after no. 1', async () => {
    await start(splitRun(LI1, LI2, true));
    expect(same(await runIDs(), openedB), 'listed by the folder the other way round, the run is the same (' + runText(openedB) + ')', runText(await runIDs()));
    await insertInRun({ files: B, opened: openedB, base: ID.L1, follows: ID.L1, name: 'Specimen Ledger No. 1, Supplement', tag: 'Supplement', file: LI1, eo: 2, moved: { [ID.L2]: 3 },
      run: [at(ID.L1, LI1, 1), at('NEW', LI1, 2), at(ID.L2, LI1, 3), at(ID.L3, LI2, 1), at(ID.L4, LI2, 2)], reload: true });
  });
  await section('4e. The same run, in the middle where the files meet: after no. 2 (the last issue of the first file)', async () => {
    await insertInRun({ files: B, opened: openedB, base: ID.L2, follows: ID.L2, name: 'Specimen Ledger No. 2, Supplement', tag: 'Supplement', file: LI1, eo: 3, moved: {},
      run: [at(ID.L1, LI1, 1), at(ID.L2, LI1, 2), at('NEW', LI1, 3), at(ID.L3, LI2, 1), at(ID.L4, LI2, 2)], reload: false });
  });
  await section('4f. The same run, in the middle of the second file: after no. 3', async () => {
    await insertInRun({ files: B, opened: openedB, base: ID.L3, follows: ID.L3, name: 'Specimen Ledger No. 3, Supplement', tag: 'Supplement', file: LI2, eo: 2, moved: { [ID.L4]: 3 },
      run: [at(ID.L1, LI1, 1), at(ID.L2, LI1, 2), at(ID.L3, LI2, 1), at('NEW', LI2, 2), at(ID.L4, LI2, 3)], reload: true, shot: '4f-split-after-no3-reopened' });
  });
  await section('4g. The same run, at the end: after no. 4', async () => {
    await insertInRun({ files: B, opened: openedB, base: ID.L4, follows: ID.L4, name: 'Specimen Ledger Extra Number', tag: 'Extra', file: LI2, eo: 3, moved: {},
      run: [at(ID.L1, LI1, 1), at(ID.L2, LI1, 2), at(ID.L3, LI2, 1), at(ID.L4, LI2, 2), at('NEW', LI2, 3)], reload: false });
  });
  await section('4h. The same run, at the end: New issue (the draft follows the last issue of the run)', async () => {
    await insertInRun({ files: B, opened: openedB, base: 'new', follows: ID.L4, name: 'Specimen Ledger Extra Number', tag: 'Extra', file: LI2, eo: 3, moved: {},
      run: [at(ID.L1, LI1, 1), at(ID.L2, LI1, 2), at(ID.L3, LI2, 1), at(ID.L4, LI2, 2), at('NEW', LI2, 3)], reload: true });
  });
  await section('4i. The same run: a draft whose issue was undone before Record goes at the end of the run', async () => {
    await start(B);
    const s0 = await snap();
    await go('#/issues/' + ID.LEDGER + '/' + ID.L4); await page.waitForSelector('.issue-form');
    await page.click('.sticky-actions button:has-text("New issue after this")'); await page.waitForSelector('.draft-card');
    await page.fill('#f-shortname', 'Specimen Ledger Extra Number'); await page.locator('#f-shortname').press('Enter');
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    const first = (diff(s0, await snap()).issues || { added: [] }).added[0] || '';
    expect(await page.inputValue('.advance-bar select') === first, 'after Record, the next draft follows the issue just recorded');
    await undo();
    expect(same(diff(s0, await snap()), {}) && (await dirty()).length === 0, 'Undo: the recorded issue is gone, nothing marked changed; the draft that followed it is still open');
    await page.fill('#f-shortname', 'Specimen Ledger Another Number'); await page.locator('#f-shortname').press('Enter');
    await page.click('.sticky-actions button:has-text("Record issue")');
    await page.waitForFunction(() => /Recorded/.test((document.querySelector('.message') || {}).textContent || ''));
    const s1 = await snap(), d = diff(s0, s1), newID = (d.issues || { added: [] }).added[0] || '';
    expect(same(d, want({ issues: { added: [newID] } })) && s1.issues[newID]._src === LI2 && s1.issues[newID].entryOrder === 3,
      'Record: one issue added, at the end of the run: in …_ISSUES_2.csv, the file of the run\'s last issue, with Entry Order 3 (before the repair, at the end of …_ISSUES_1.csv, between nos. 2 and 3)', s1.issues[newID] && s1.issues[newID]._src + ':' + s1.issues[newID].entryOrder);
    expect(same(await runIDs(newID), [at(ID.L1, LI1, 1), at(ID.L2, LI1, 2), at(ID.L3, LI2, 1), at(ID.L4, LI2, 2), at('NEW', LI2, 3)]) && same(await dirty(), [LI2]), 'the run ends with it; only …_ISSUES_2.csv marked changed');
    await saveAndCheckFiles(B, [LI2], '…_ISSUES_2.csv');
    await readBack(s1);
  });
  }
  expect(errors.length === 0, 'no page errors', errors.join('; '));
  if (run) await run.close();
  await browser.close();
  console.log(log.join('\n'));
  const tail = knownCount ? ' (' + knownCount + ' KNOWN defect check' + (knownCount > 1 ? 's' : '') + ' reported, not counted)' : '';
  if (failures) { console.log('FAILED ' + failures + ' of ' + count + ' destructive-action browser checks' + tail); process.exit(1); }
  console.log('PASSED ' + count + ' destructive-action browser checks' + tail);
})();
