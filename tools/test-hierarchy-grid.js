#!/usr/bin/env node
/* Slaughter Cataloger 3 — the Contents grid on parts separated from their parent (D-12; A3 batch 2),
   in Chromium, through the app's own toolbar.

   usage: node tools/test-hierarchy-grid.js <app.html> [screenshot-dir]

   An invented library, made here with the app's own writer, lives in a folder held by this test
   (not in the browser), so it survives a reload: every write reaches it before the app is told the
   write is done. Issue 1 has the invented twin's shape: "Correspondence" (no. 3) has the parts
   "A Letter on Roads" (4), "A Letter on Schools" (6) and "A Reply" (7), with "Market Report" (5),
   not part of it, between them. Issue 2 is an ordinary nested list ("Poetry" with three poems, then
   "Reviews" with one), checked to behave as it always has.
   Checked, with the parent of every item and the number of items before and after each step:
   what the grid shows; Delete, Move, Nest, Un-nest and Insert below; Undo and Redo after each;
   saving, the saved files read back, a reload, and a fresh open in a new browser profile. */
'use strict';
const path = require('path'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const ROOT = path.join(__dirname, '..');
const app = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'slaughter-cataloger-3.html'));
const shots = process.argv[3] || '';
if (shots) fs.mkdirSync(shots, { recursive: true });
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store', 'toc'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SCx = globalThis.SC, R = SCx.records;

// ── The invented library ────────────────────────────────────────────────
const SLUG = 'HIERARCHY-TEST', TID = 'SPECLEDX-1875';
const I1 = TID + '-KAAAAA2', I2 = TID + '-KAAAAA3';
const FT = 'SCAT_' + SLUG + '_TITLES.csv', FI = 'SCAT_' + SLUG + '_' + TID + '_ISSUES.csv', FC = 'SCAT_' + SLUG + '_' + TID + '_CONTENTS.csv';
const A = '23456789ABCDEFGHJKMNPQRSTUVWYZ';
// [title, parent title] in printed order
const ISSUE1 = [['Masthead'], ['Town Notes'], ['Correspondence'], ['A Letter on Roads', 'Correspondence'], ['Market Report'],
  ['A Letter on Schools', 'Correspondence'], ['A Reply', 'Correspondence'], ['Notices']];
const ISSUE2 = [['Poetry'], ['First Poem', 'Poetry'], ['Second Poem', 'Poetry'], ['Third Poem', 'Poetry'], ['Reviews'], ['A Review', 'Reviews']];
const ID = {};
function library() {
  const blank = ent => { const r = { spec: [], na: [], speculative: false }; SCx.schema.entities[ent].fields.forEach(c => { r[c.key] = c.type === 'bool' ? false : ''; }); return r; };
  const st = SCx.emptyState();
  st.library = Object.freeze({ slug: SLUG, name: 'Hierarchy Test Library', note: '' });
  [[FT, 'title'], [FI, 'issue'], [FC, 'content']].forEach(([n, k]) => st.files.set(n, { name: n, kind: k, extraHeaders: [], hash: '', lastModified: 0, schemaVersion: '3.0', setAside: [] }));
  st.titles.set(TID, R.freezeRec(Object.assign(blank('title'), { titleID: TID, titleCode: 'SPECLEDX', firstYear: '1875', canonicalTitle: 'The Specimen Ledger', _src: FT, entryOrder: 1 })));
  [[I1, '1'], [I2, '2']].forEach(([iid, n], k) => st.issues.set(iid, R.freezeRec(Object.assign(blank('issue'), { overrides: [], issueID: iid, titleID: TID, shortname: 'Specimen Ledger No. ' + n, number: n, year: '1875', _src: FI, entryOrder: k + 1 }))));
  let eo = 0;
  [[I1, ISSUE1, 'B'], [I2, ISSUE2, 'C']].forEach(([iid, list, tag]) => list.forEach(([t, p], k) => {
    const id = TID + '-CAAAA' + tag + A[k];
    ID[t] = id;
    st.contents.set(id, R.freezeRec(Object.assign(blank('content'), { contentID: id, issueID: iid, titleID: TID, issueRef: 'Specimen Ledger No. ' + (iid === I1 ? 1 : 2), sequence: String(k + 1), itemTitle: t,
      parentID: p ? ID[p] : '', parentItem: p || '', na: p ? [] : ['Parent Item'], startPage: String(k + 1), _src: FC, entryOrder: ++eo })));
  }));
  const files = {};
  [FT, FI, FC].forEach(n => { files[n] = R.writeFile(st, n); });
  const back = R.buildLibrary(Object.keys(files).map(n => R.readFile(n, files[n], {})), {});
  if (back.changed.length || back.report.some(r => r.level !== 'info')) { console.error('the invented library does not read cleanly', back.changed, back.report); process.exit(1); }
  return files;
}
const SEED = library();

// The folder: { files: {name: {text, lastModified}}, dirs: {name: folder} }, held here. The page
// reads it when it first touches the folder and sends every change back (awaited), so a reload or a
// new browser profile always finds what was last written. (Kept in the page's localStorage instead,
// a write made just before a reload was sometimes not there after it.)
let disk = null;
const folderOf = files => ({ files: Object.fromEntries(Object.keys(files).map(n => [n, { text: files[n], lastModified: 1000 }])), dirs: {} });
function pageFolder() {
  if (window.top !== window) return;
  let tree = null;
  const load = async () => { if (!tree) tree = JSON.parse(await window.__hierLoad()); return tree; };
  const persist = () => window.__hierStore(JSON.stringify(tree));
  const notFound = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
  const fh = (node, name) => ({ kind: 'file', name, getFile: async () => ({ name, lastModified: node.files[name].lastModified, text: async () => node.files[name].text }),
    createWritable: async () => { let b = ''; return { write: async t => { b += t; }, close: async () => { node.files[name] = { text: b, lastModified: Date.now() }; await persist(); }, abort: async () => {} }; } });
  const dh = (get, name) => ({ kind: 'directory', name, queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    values: async function* () { const node = await get(); for (const n of Object.keys(node.files)) yield fh(node, n); for (const d of Object.keys(node.dirs)) yield dh(async () => node.dirs[d], d); },
    getFileHandle: async (n, o) => { const node = await get(); if (!node.files[n]) { if (!(o && o.create)) throw notFound(); node.files[n] = { text: '', lastModified: Date.now() }; await persist(); } return fh(node, n); },
    getDirectoryHandle: async (n, o) => { const node = await get(); if (!node.dirs[n]) { if (!(o && o.create)) throw notFound(); node.dirs[n] = { files: {}, dirs: {} }; await persist(); } return dh(async () => node.dirs[n], n); },
    removeEntry: async n => { const node = await get(); delete node.files[n]; delete node.dirs[n]; await persist(); } });
  window.__SC_TEST_FS__ = { root: dh(load, 'Hierarchy Test Library'), tree: () => tree };
}

(async () => {
  const browser = await chromium.launch();
  let page, context;
  const log = [], errors = [], dialogs = [];
  let failures = 0, count = 0, answer = false;
  const step = s => log.push('· ' + s);
  const expect = (cond, what, detail) => { count++; log.push((cond ? '  ok   ' : '  FAIL ') + what + (cond || !detail ? '' : '\n         ' + String(detail).slice(0, 600))); if (!cond) failures++; };
  // A browser context of its own (nothing kept from an earlier one) on a folder holding these files;
  // the app opened and the folder opened in it.
  const start = async files => {
    if (context) await context.close();
    disk = folderOf(files);
    context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await context.exposeFunction('__hierLoad', () => JSON.stringify(disk));
    await context.exposeFunction('__hierStore', t => { disk = JSON.parse(t); });
    page = await context.newPage();
    page.on('pageerror', e => errors.push('page error: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::/.test(m.text())) errors.push('console: ' + m.text()); });
    page.on('dialog', d => { dialogs.push(d.message()); if (answer) d.accept(); else d.dismiss(); });
    await page.addInitScript(pageFolder);
    await page.goto('file://' + app);
    await page.click('text=Open library folder');
    await page.waitForFunction(() => SC.session.ui.mode === 'folder' && !SC.session.ui.busy);
  };
  const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };

  // What the store holds for an issue: [title, parent title, sequence] in order.
  const items = iid => page.evaluate(i => SC.session.store.contentsOfIssue(i).map(c => [c.itemTitle, c.parentID ? (SC.session.store.state.contents.get(c.parentID) || {}).itemTitle || '?' + c.parentID : '', c.sequence]), iid);
  const titles = async iid => (await items(iid)).map(x => x[0]);
  const parentMap = async iid => Object.fromEntries((await items(iid)).map(x => [x[0], x[1]]).sort((a, b) => (a[0] < b[0] ? -1 : 1)));   // by title, so order does not matter
  // Every part comes after its parent, sequences are 1..n, Parent Item is the parent's title.
  const sound = iid => page.evaluate(i => {
    const st = SC.session.store.state, list = SC.session.store.contentsOfIssue(i), pos = new Map(list.map((c, k) => [c.contentID, k]));
    return list.every((c, k) => c.sequence === String(k + 1) && (!c.parentID || (pos.has(c.parentID) && pos.get(c.parentID) < k && st.contents.get(c.parentID).itemTitle === c.parentItem)));
  }, iid);
  const dirty = () => page.evaluate(() => Array.from(SC.session.store.dirty));
  const grid = () => page.$$eval('table.grid-toc tbody tr[data-item]', trs => trs.map(tr => {
    const td = tr.querySelector('td.c-itemTitle'), note = td.querySelector('.item-note'), cell = td.querySelector('.cell');
    return { title: cell.value, detached: tr.classList.contains('detached'), nested: !!td.querySelector('.nest-mark'), note: note ? note.textContent.trim() : '',
      describedBy: cell.getAttribute('aria-describedby') || '', noteId: note ? note.id : '' };
  }));
  const open = async iid => { await page.evaluate(h => { location.hash = h; }, '#/contents/' + TID + '/' + iid); await page.waitForSelector('table.grid-toc tbody tr[data-item]'); await page.waitForTimeout(100); };
  const pick = async t => { await page.click('[data-cell="' + ID[t] + ':itemTitle"]'); await page.waitForTimeout(50); };
  const TOOL = { up: 'Move up', down: 'Move down', nest: 'Make it part', unnest: 'Move it out', insert: 'Open an empty row', del: 'Delete this item' };
  const tool = async (t, which) => { await pick(t); await page.click('.grid-tools button[title^="' + TOOL[which] + '"]'); await page.waitForTimeout(150); };
  // Undo and Redo through the top bar. A button that is off (nothing to undo) is not waited for, so a
  // step that did nothing shows as a failed check, not a stopped run.
  const topButton = async label => { const btn = page.locator('.topbar button:has-text("' + label + '")'); if (await btn.isDisabled()) return; await btn.click(); await page.waitForTimeout(120); };
  const undo = () => topButton('Undo'), redo = () => topButton('Redo');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  try {
    await start(SEED);
    await open(I1);
    const ORIG = await items(I1), ORIG_PARENTS = await parentMap(I1), ORIG2 = await items(I2);
    // Items in the whole library: 14 as made, 16 once two are added and saved.
    let base = ORIG.length + ORIG2.length;
    const total = () => page.evaluate(() => SC.session.store.state.contents.size);
    const back = async (what, iid) => { const now = await items(iid || I1), n = await total();
      expect(same(now, iid === I2 ? ORIG2 : ORIG) && n === base, what + ': every item, parent and number as before; ' + n + ' items in the library', JSON.stringify(now) + ' ' + n); };
    // A step that should be refused changes nothing. If it changed something (a failed check), that
    // is undone after checking, so the checks after it start from the list as made.
    const refused = async (what, unmarked) => {
      const changed = !same(await items(I1), ORIG);
      await back(what);
      if (unmarked) expect((await dirty()).length === 0, 'and nothing is marked changed');
      if (changed) await undo();
    };

    // ── What the grid shows ──
    step('Issue 1 as opened: "Correspondence" (3) has parts 4, 6 and 7; "Market Report" (5) is between');
    expect(same(await titles(I1), ISSUE1.map(x => x[0])) && await sound(I1) && base === 14 && await total() === 14, '8 items, in order, every part after its parent; 14 items in the library');
    let g = await grid();
    expect(same(g.map(r => r.detached), [false, false, false, false, false, true, true, false]), 'only "A Letter on Schools" and "A Reply" are marked as separated from their parent');
    expect(g[5].note === 'part of no. 3, “Correspondence”, above' && g[6].note === 'part of no. 3, “Correspondence”, above', 'each says whose part it is: part of no. 3, “Correspondence”, above', g[5].note);
    expect(g[2].note === 'its parts nos. 6, 7 are further down', 'the parent says where its parts further down are', g[2].note);
    expect(g[3].note === '' && !g[3].detached && g[3].nested && g[4].note === '' && !g[4].nested, '"A Letter on Roads", right under its parent, is indented with no note; "Market Report" is neither');
    expect(g[5].describedBy && g[5].describedBy === g[5].noteId && g[2].describedBy === g[2].noteId, 'the title cell is described by its note, for screen readers');
    await shot('01-issue1-as-opened');
    await open(I2);
    g = await grid();
    expect(g.every(r => !r.detached && !r.note) && g.filter(r => r.nested).length === 4, 'Issue 2 (an ordinary nested list): nothing marked, no notes, four nested items indented');
    await open(I1);

    // ── Delete ──
    step('Delete takes the item and its own parts, wherever they are');
    dialogs.length = 0;
    await tool('Market Report', 'del');
    expect(dialogs.length === 0, 'Delete on "Market Report" (no parts): no question asked');
    expect(same(await titles(I1), ['Masthead', 'Town Notes', 'Correspondence', 'A Letter on Roads', 'A Letter on Schools', 'A Reply', 'Notices']) && await sound(I1), 'only "Market Report" is gone: 7 items, renumbered');
    expect(await total() === 13, '13 items in the library');
    let pm = await parentMap(I1);
    expect(pm['A Letter on Schools'] === 'Correspondence' && pm['A Reply'] === 'Correspondence', '"A Letter on Schools" and "A Reply" are still parts of "Correspondence"');
    expect((await grid()).every(r => !r.detached), 'with "Market Report" gone, the parts are together again and nothing is marked');
    await undo(); await back('Undo');
    expect((await dirty()).length === 0, 'Undo: nothing marked changed');
    await redo();
    expect((await titles(I1)).length === 7 && (await titles(I1)).indexOf('Market Report') === -1, 'Redo: "Market Report" is gone again');
    await undo(); await back('Undo after Redo');
    dialogs.length = 0; answer = false;
    await tool('Correspondence', 'del');
    expect(dialogs[0] === 'Delete "Correspondence" and the 3 items nested in it (2 of them further down, after other items)? You can undo this.', 'Delete on "Correspondence" asks about its 3 parts, 2 of them further down', dialogs[0]);
    await back('the question declined');
    answer = true;
    await tool('Correspondence', 'del');
    answer = false;
    expect(same(await items(I1), [['Masthead', '', '1'], ['Town Notes', '', '2'], ['Market Report', '', '3'], ['Notices', '', '4']]), 'accepted: "Correspondence" and its three parts are gone, "Market Report" and the rest kept, renumbered 1–4');
    expect(await total() === 10, '10 items in the library: 4 gone');
    await undo(); await back('Undo');
    dialogs.length = 0;
    await tool('A Letter on Roads', 'del');
    pm = await parentMap(I1);
    expect(dialogs.length === 0 && (await titles(I1)).length === 7 && pm['A Letter on Schools'] === 'Correspondence' && pm['A Reply'] === 'Correspondence', 'Delete on "A Letter on Roads": it alone goes; the other two parts stay with "Correspondence"');
    expect(await total() === 13, '13 items in the library');
    await undo(); await back('Undo');

    // ── Move ──
    step('Move carries only an item\'s own parts, and never puts a part before its parent');
    await tool('Market Report', 'down');
    await refused('Move down on "Market Report" (the next item is a part of "Correspondence"): refused', true);
    await tool('A Letter on Schools', 'up');
    await refused('Move up on "A Letter on Schools" (the item above is not part of "Correspondence"): refused');
    await tool('Market Report', 'up');
    const raised = ['Masthead', 'Town Notes', 'Market Report', 'Correspondence', 'A Letter on Roads', 'A Letter on Schools', 'A Reply', 'Notices'];
    expect(same(await titles(I1), raised) && same(await parentMap(I1), ORIG_PARENTS) && await sound(I1), 'Move up on "Market Report": it goes above "Correspondence" and its part; every parent unchanged, every part after its parent');
    expect((await grid()).every(r => !r.detached && !r.note), 'the parts are together now, and nothing is marked');
    await undo(); await back('Undo');
    await tool('Correspondence', 'down');
    expect(same(await titles(I1), raised) && same(await parentMap(I1), ORIG_PARENTS) && await sound(I1), 'Move down on "Correspondence": past "Market Report", taking "A Letter on Roads"; the other parts still follow it');
    await shot('02-issue1-correspondence-moved-down');
    await tool('Correspondence', 'down');
    expect(same(await titles(I1), ['Masthead', 'Town Notes', 'Market Report', 'Notices', 'Correspondence', 'A Letter on Roads', 'A Letter on Schools', 'A Reply']) && same(await parentMap(I1), ORIG_PARENTS) && await sound(I1),
      'Move down on "Correspondence" again: all three parts, together now, go with it');
    await undo(); await undo(); await back('Undo twice');
    await redo();
    expect(same(await titles(I1), raised), 'Redo: the first move again');
    await undo(); await back('Undo');
    await tool('A Letter on Schools', 'down');
    pm = await parentMap(I1);
    expect(same(await titles(I1), ['Masthead', 'Town Notes', 'Correspondence', 'A Letter on Roads', 'Market Report', 'A Reply', 'A Letter on Schools', 'Notices']) && pm['A Reply'] === 'Correspondence' && pm['A Letter on Schools'] === 'Correspondence' && await sound(I1),
      'Move down on "A Letter on Schools": it changes places with "A Reply", its sibling; both still parts of "Correspondence"');
    expect((await grid()).filter(r => r.detached).length === 2, 'both still marked as separated from their parent');
    await undo(); await back('Undo');

    // ── Un-nest and Nest ──
    step('Un-nest and Nest change only the item they are used on');
    await tool('A Letter on Schools', 'unnest');
    pm = await parentMap(I1);
    expect(pm['A Letter on Schools'] === '' && pm['A Reply'] === 'Correspondence' && pm['A Letter on Roads'] === 'Correspondence' && await sound(I1), 'Un-nest on "A Letter on Schools": it moves to the top level; "A Reply" stays a part of "Correspondence"');
    g = await grid();
    expect(g[6].title === 'A Reply' && g[6].detached && g[6].note === 'part of no. 3, “Correspondence”, above' && g[2].note === 'its part no. 7 is further down', '"A Reply" is still marked as part of no. 3; "Correspondence" names its one part further down', JSON.stringify([g[2].note, g[6].note]));
    await undo(); await back('Undo');
    await redo();
    pm = await parentMap(I1);
    expect(pm['A Letter on Schools'] === '' && pm['A Reply'] === 'Correspondence' && await sound(I1), 'Redo: the same un-nest again, "A Reply" untouched');
    await undo(); await back('Undo');
    await tool('A Letter on Roads', 'unnest');
    pm = await parentMap(I1);
    expect(pm['A Letter on Roads'] === '' && pm['A Letter on Schools'] === 'Correspondence' && pm['A Reply'] === 'Correspondence' && await sound(I1), 'Un-nest on "A Letter on Roads": it alone moves out; the parts beyond "Market Report" stay with "Correspondence"');
    await undo(); await back('Undo');
    await tool('Market Report', 'nest');
    pm = await parentMap(I1);
    expect(pm['Market Report'] === 'Correspondence' && (await grid()).every(r => !r.detached) && await sound(I1), 'Nest on "Market Report": it becomes a part of "Correspondence", and all four parts are together');
    await undo(); await back('Undo');
    await tool('A Letter on Schools', 'nest');
    await refused('Nest on "A Letter on Schools" (the item above is not its sibling): refused');

    // ── Insert below ──
    step('Insert below puts the new row after the item\'s own parts, with the parent the item has');
    await tool('Market Report', 'insert');
    g = await grid();
    expect(await page.locator('tr.draft-row').count() === 2, 'an empty row opens (beside the one at the end)');
    const draftAfter = await page.$$eval('table.grid-toc tbody tr', trs => { const k = trs.findIndex(t => t.classList.contains('draft-row')); return k > 0 ? trs[k - 1].querySelector('.c-itemTitle .cell').value : ''; });
    expect(draftAfter === 'Market Report', 'right below "Market Report", not after "A Reply"', draftAfter);
    await page.keyboard.type('An Inserted Note'); await page.keyboard.press('Tab'); await page.waitForTimeout(150);
    let it = await items(I1);
    expect(same(it.map(x => x[0]), ['Masthead', 'Town Notes', 'Correspondence', 'A Letter on Roads', 'Market Report', 'An Inserted Note', 'A Letter on Schools', 'A Reply', 'Notices']) && it[5][1] === '' && await sound(I1),
      'typed there, it becomes item 6, at the top level; 9 items');
    expect(await total() === 15, '15 items in the library');
    pm = await parentMap(I1);
    expect(pm['A Letter on Schools'] === 'Correspondence' && pm['A Reply'] === 'Correspondence', 'the parts beyond it are still parts of "Correspondence"');
    await undo(); await back('Undo');
    await tool('A Letter on Schools', 'insert');
    await page.keyboard.type('A Second Reply'); await page.keyboard.press('Tab'); await page.waitForTimeout(150);
    it = await items(I1);
    expect(it[6] && it[6][0] === 'A Second Reply' && it[6][1] === 'Correspondence' && it[6][2] === '7' && await sound(I1), 'Insert below "A Letter on Schools": the new item is a part of "Correspondence" (not of "Market Report", the row above at the top level)', JSON.stringify(it[6]));
    await undo(); await back('Undo');
    await redo();
    it = await items(I1);
    expect(it.length === 9 && it[6][0] === 'A Second Reply' && it[6][1] === 'Correspondence' && await sound(I1) && await total() === 15, 'Redo: the new item back, still a part of "Correspondence"');
    await undo(); await back('Undo');

    // ── Save, read back, reload ──
    step('Save, the saved file read back, and a reload');
    await tool('Market Report', 'insert');
    await page.keyboard.type('An Inserted Note'); await page.keyboard.press('Tab'); await page.waitForTimeout(150);
    await tool('A Letter on Schools', 'insert');
    await page.keyboard.type('A Second Reply'); await page.keyboard.press('Tab'); await page.waitForTimeout(150);
    const WANT = [['Masthead', '', '1'], ['Town Notes', '', '2'], ['Correspondence', '', '3'], ['A Letter on Roads', 'Correspondence', '4'], ['Market Report', '', '5'], ['An Inserted Note', '', '6'],
      ['A Letter on Schools', 'Correspondence', '7'], ['A Second Reply', 'Correspondence', '8'], ['A Reply', 'Correspondence', '9'], ['Notices', '', '10']];
    expect(same(await items(I1), WANT) && await sound(I1) && await total() === 16, 'two items added: 10 items, every parent as it should be; 16 in the library');
    base = 16;
    await page.evaluate(() => { window.__before = SC.session.ui.message; });
    await page.click('.topbar button:has-text("Save")');
    await page.waitForFunction(() => SC.session.ui.message && SC.session.ui.message !== window.__before && !SC.session.ui.busy);
    expect((await dirty()).length === 0, 'saved: nothing marked changed');
    // The saved folder read afresh, as opening it would.
    const saved = await page.evaluate(fl => {
      const b = SC.records.buildLibrary(Object.keys(fl).map(n => SC.records.readFile(n, fl[n].text, {})), {});
      const list = Array.from(b.state.contents.values()).filter(c => c.issueID === 'SPECLEDX-1875-KAAAAA2').sort((x, y) => +x.sequence - +y.sequence);
      return { rows: list.map(c => [c.itemTitle, c.parentID ? b.state.contents.get(c.parentID).itemTitle : '', c.sequence, c.parentItem, c.parentKept || '']), report: b.report.filter(r => r.level !== 'info').map(r => r.msg),
        n: b.state.contents.size, changed: b.changed };
    }, disk.files);
    expect(same(saved.rows.map(r => r.slice(0, 3)), WANT), 'the saved Contents file holds the 10 items with the same parents and numbers', JSON.stringify(saved.rows));
    expect(saved.rows.every(r => r[3] === r[1] && r[4] === ''), 'each Parent Item is its parent\'s title; no link was set aside');
    expect(saved.report.length === 0 && saved.changed.length === 0, 'the saved folder, read afresh, raises no warning and needs no change', JSON.stringify(saved.report));
    expect(saved.n === 16, 'and holds 16 items in all (10 in issue 1, 6 in issue 2)', saved.n);
    await page.reload();
    await page.waitForFunction(() => SC.session && SC.session.ui.mode === 'folder' && !SC.session.ui.busy && SC.session.ui.access === 'owner');
    await open(I1);
    expect(same(await items(I1), WANT) && await sound(I1), 'after a reload: the same 10 items, parents and numbers');
    expect((await dirty()).length === 0, 'and nothing marked changed');
    const rep = await page.evaluate(() => (SC.session.ui.report || []).filter(r => r.level !== 'info').map(r => r.msg));
    expect(rep.length === 0, 'and no load warnings', JSON.stringify(rep));
    g = await grid();
    expect(same(g.filter(r => r.detached).map(r => r.title), ['A Letter on Schools', 'A Second Reply', 'A Reply']) && g[2].note === 'its parts nos. 7, 8, 9 are further down', 'the grid marks the three parts beyond "Market Report" and the inserted note', JSON.stringify(g.map(r => r.note)));
    await shot('03-issue1-after-save-and-reload');
    step('Opened afresh: the saved files in a new browser profile (nothing kept in the browser), the folder opened there');
    const savedFiles = Object.fromEntries(Object.keys(disk.files).map(n => [n, disk.files[n].text]));
    expect(!!disk.dirs._backups && Object.keys(disk.dirs._backups.dirs).length === 1 && Object.values(disk.dirs._backups.dirs)[0].files[FC] && Object.values(disk.dirs._backups.dirs)[0].files[FC].text === SEED[FC],
      'the save backed up the Contents file as it was, byte for byte (_backups/)');
    expect(Object.keys(savedFiles).sort().join() === Object.keys(SEED).sort().join() && savedFiles[FT] === SEED[FT] && savedFiles[FI] === SEED[FI] && savedFiles[FC] !== SEED[FC],
      'the folder holds the same three files; only the Contents file was rewritten');
    await start(savedFiles);
    await open(I1);
    expect(same(await items(I1), WANT) && await sound(I1) && same(await items(I2), ORIG2), 'the same 10 items, parents and numbers in issue 1; issue 2 as it was');
    const rep2 = await page.evaluate(() => (SC.session.ui.report || []).filter(r => r.level !== 'info').map(r => r.msg));
    expect(rep2.length === 0 && (await dirty()).length === 0, 'no load warnings (no parent link set aside), nothing marked changed', JSON.stringify(rep2));
    expect(same((await grid()).map(r => [r.title, r.detached, r.note]), g.map(r => [r.title, r.detached, r.note])), 'the grid shows the same as before the reload');

    // ── An ordinary nested list behaves as before ──
    step('Issue 2, an ordinary nested list: as before');
    await open(I2);
    await tool('Second Poem', 'unnest');
    let p2 = await parentMap(I2);
    expect(p2['Second Poem'] === '' && p2['Third Poem'] === 'Second Poem' && p2['First Poem'] === 'Poetry' && await sound(I2), 'Un-nest on "Second Poem": as before, the poem after it becomes its part, so the list still reads in order');
    await undo(); await back('Undo', I2);
    await tool('Reviews', 'up');
    expect(same(await titles(I2), ['Reviews', 'A Review', 'Poetry', 'First Poem', 'Second Poem', 'Third Poem']) && await sound(I2), 'Move up on "Reviews": it goes above "Poetry" with its review, as before');
    await undo(); await back('Undo', I2);
    dialogs.length = 0; answer = false;
    await tool('Poetry', 'del');
    expect(dialogs[0] === 'Delete "Poetry" and the 3 items nested in it? You can undo this.', 'Delete on "Poetry" asks as before', dialogs[0]);
    await back('declined', I2);
    await tool('Poetry', 'insert');
    const after2 = await page.$$eval('table.grid-toc tbody tr', trs => { const k = trs.findIndex(t => t.classList.contains('draft-row')); return k > 0 ? trs[k - 1].querySelector('.c-itemTitle .cell').value : ''; });
    expect(after2 === 'Third Poem', 'Insert below "Poetry": after its poems, as before', after2);
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    expect(await page.locator('tr.draft-row').count() === 1, 'Escape closes the empty row');
    await back('nothing added', I2);
    await tool('Reviews', 'nest');
    p2 = await parentMap(I2);
    expect(p2['Reviews'] === 'Poetry' && p2['A Review'] === 'Reviews' && await sound(I2), 'Nest on "Reviews": it becomes the last part of "Poetry", its review with it, as before');
    await undo(); await back('Undo', I2);
    expect((await dirty()).length === 0, 'at the end, nothing marked changed');
  } catch (e) {
    failures++; log.push('  FAIL the run stopped: ' + (e && e.stack || e));
  }
  expect(errors.length === 0, 'no page errors', errors.join('; '));
  await browser.close();
  console.log(log.join('\n'));
  if (failures) { console.log('FAILED ' + failures + ' of ' + count + ' contents-hierarchy browser checks'); process.exit(1); }
  console.log('PASSED ' + count + ' contents-hierarchy browser checks');
})();
