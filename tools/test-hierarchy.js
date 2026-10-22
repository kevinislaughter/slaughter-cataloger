#!/usr/bin/env node
/* Slaughter Cataloger 3 — contents hierarchy (D-12; A3 batch 2): the structural operations of
   js/core/toc.js and the way the outputs name a part's parent.

   usage: node tools/test-hierarchy.js [3.0 library folder]     (SC_LIST_CHECKS=1 lists every check)

   - The invented twin's shape: item 3 has parts 4, 6 and 7, with item 5 (not part of it) between.
     Every operation of the Contents grid is checked on it: which items Delete removes, what Move,
     Nest, Un-nest and Insert below do, and that no part ever comes before its parent.
   - On lists where every part follows its parent directly (every sample issue), the repaired
     functions give exactly what the earlier ones gave (tools/lib/toc-contiguous-reference.js), on
     thousands of random lists and on every issue of the sample library.
   - On random lists with parts anywhere after their parents, every result keeps the rules: Delete
     takes exactly the item and its descendants; Move only reorders and keeps every part after its
     parent; Nest and Un-nest change only the parents they should.
   - Catalog, WordPress and the proofing sheet say whose part a separated item is; RIS and BibTeX
     already did. Nothing changes for an item right under its parent. */
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
globalThis.SC = {};
['csv', 'ids', 'schema', 'numbering', 'records', 'store', 'toc', 'names', 'catalog', 'outputs'].forEach(f => require(path.join(ROOT, 'js', 'core', f + '.js')));
const SCx = globalThis.SC, T = SCx.toc, R = SCx.records, C = SCx.catalog, O = SCx.outputs;
const L = require('./lib/toc-contiguous-reference');
const LIB = process.argv[2] || path.join(ROOT, 'sample-data', '3.0', 'example-library');

const LIST = process.env.SC_LIST_CHECKS === '1';
let count = 0, fails = 0;
const eq = (got, want, what) => {
  count++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log('FAIL ' + what + '\n   got  ' + g + '\n   want ' + w); }
  else if (LIST) console.log('  ok   ' + what);
};
const ok = (cond, what, detail) => {
  count++;
  if (!cond) { fails++; console.log('FAIL ' + what + (detail ? '\n     ' + String(detail).slice(0, 800) : '')); }
  else if (LIST) console.log('  ok   ' + what);
};
const step = s => { if (LIST) console.log('· ' + s); };

// ── Helpers ─────────────────────────────────────────────────────────────
// The rule every result must keep, checked here independently of toc.js: every part after its parent.
function validOrder(rs, order) {
  const byId = new Map(rs.map(r => [r.id, r])), pos = new Map(order.map((id, k) => [id, k]));
  return order.length === rs.length && order.every((id, k) => { const r = byId.get(id); return r && (!r.parentID || !pos.has(r.parentID) || pos.get(r.parentID) < k); });
}
const parentsOf = rs => { const ix = new Map(rs.map((r, i) => [r.id, i])); return rs.map(r => (r.parentID && r.parentID !== r.id && ix.has(r.parentID) ? ix.get(r.parentID) : -1)); };
// The baseline (1b68081) had no blockEnd, descendants or detached: its grid took the run of deeper rows
// after an item as the item's block and as what Delete removed, and labelled a part whose nearest
// less-indented row above was not its parent. These stand in for them there, so this suite can be
// run against the baseline to show what it got wrong. With the repaired toc.js they are not used.
const depthRun = (rs, i) => T.subtreeEnd(T.depths(rs), i);
const blockEnd = T.blockEnd || ((rs, i) => depthRun(rs, i));
const descendants = T.descendants || ((rs, i) => { const out = []; for (let k = i + 1; k <= depthRun(rs, i); k++) out.push(k); return out; });
const detached = T.detached || (rs => { const ds = T.depths(rs), par = parentsOf(rs); return rs.map((r, i) => { if (par[i] === -1) return -1; let j = i - 1; while (j >= 0 && ds[j] >= ds[i]) j--; return j === par[i] ? -1 : par[i]; }); });

// ── The twin's shape ────────────────────────────────────────────────────
// 1, 2, 3 (with parts 4, 6, 7), 5 between them, 8. Ids are the item numbers.
const rows = spec => spec.map(([id, parentID]) => ({ id, parentID: parentID || '' }));
const TW = rows([['1'], ['2'], ['3'], ['4', '3'], ['5'], ['6', '3'], ['7', '3'], ['8']]);
const at = id => TW.findIndex(r => r.id === id);
const names = idx => idx.map(k => TW[k].id);
const apply = (rs, change) => rs.map(r => (change && r.id in change ? { id: r.id, parentID: change[r.id] } : r));
const reorder = (rs, order) => order.map(id => rs.find(r => r.id === id));
const parentOf = (rs, id) => rs.find(r => r.id === id).parentID;

step('the twin\'s shape: item 3 has parts 4, 6 and 7; item 5 is between them');
eq(T.depths(TW), [0, 0, 0, 1, 0, 1, 1, 0], 'depths come from the parent links');
eq(detached(TW).map(p => (p === -1 ? '' : TW[p].id)), ['', '', '', '', '', '3', '3', ''], 'items 6 and 7 are separated from their parent, item 3; item 4 is right under it');
eq(blockEnd(TW, at('3')), at('4'), 'item 3\'s block is 3 and 4: the parts right after it');
eq(blockEnd(TW, at('5')), at('5'), 'item 5\'s block is item 5 alone: 6 and 7 are not its parts, though they follow it indented');
eq(names(descendants(TW, at('3'))), ['4', '6', '7'], 'item 3\'s parts are 4, 6 and 7, wherever they are');
eq(names(descendants(TW, at('5'))), [], 'Delete on item 5 takes item 5 alone');
eq(names(descendants(TW, at('4'))), [], 'Delete on item 4 takes item 4 alone');
eq(T.moveUp(TW, at('5')), ['1', '2', '5', '3', '4', '6', '7', '8'], 'Move up on item 5: it goes above item 3 and its part 4; 6 and 7 stay after their parent');
eq(T.moveDown(TW, at('3')), ['1', '2', '5', '3', '4', '6', '7', '8'], 'Move down on item 3: past item 5, taking 4; its parts 6 and 7 still follow it');
eq(T.moveDown(TW, at('5')), null, 'Move down on item 5: refused (the item after it, 6, is not a sibling but a part of item 3)');
eq(T.moveUp(TW, at('6')), null, 'Move up on item 6: refused (item 5, above it, is not part of item 3)');
eq(T.moveDown(TW, at('6')), ['1', '2', '3', '4', '5', '7', '6', '8'], 'Move down on item 6: it changes places with its sibling 7');
eq(T.moveDown(TW, at('7')), null, 'Move down on item 7: refused (item 8 is not part of item 3)');
eq(T.moveUp(TW, at('4')), null, 'Move up on item 4: refused (its parent is above it)');
eq(T.moveDown(TW, at('4')), null, 'Move down on item 4: refused (item 5 is not part of item 3)');
eq(T.moveUp(TW, at('3')), ['1', '3', '4', '2', '5', '6', '7', '8'], 'Move up on item 3: past item 2, taking 4');
{
  const once = reorder(TW, T.moveDown(TW, at('3')));
  const twice = T.moveDown(once, once.findIndex(r => r.id === '3'));
  eq(twice, ['1', '2', '5', '8', '3', '4', '6', '7'], 'Move down on item 3 twice: after the first move its parts are together, and all of them go along');
  ok(validOrder(TW, twice), 'and every part still comes after item 3');
}
eq(T.indent(TW, at('5')), { 5: '3' }, 'Nest on item 5: it becomes a part of item 3 (its previous sibling, whose block ends right above it)');
eq(T.indent(TW, at('6')), null, 'Nest on item 6: refused (the item above it is not its sibling)');
eq(T.indent(TW, at('7')), { 7: '6' }, 'Nest on item 7: it becomes a part of item 6, its sibling right above it');
eq(T.indent(TW, at('4')), null, 'Nest on item 4: refused (it is the first part of item 3)');
eq(T.outdent(TW, at('6')), { 6: '' }, 'Un-nest on item 6: it alone moves out a level; item 7 stays a part of item 3');
eq(T.outdent(TW, at('7')), { 7: '' }, 'Un-nest on item 7: it alone moves out a level');
eq(T.outdent(TW, at('4')), { 4: '' }, 'Un-nest on item 4: it moves out a level; 6 and 7, beyond item 5, stay parts of item 3');
eq(T.outdent(TW, at('5')), null, 'Un-nest on item 5: refused (already at the top level)');
eq(T.insertIndex(TW, at('5')), at('5') + 1, 'Insert below item 5: the new row goes right after item 5, before 6');
eq(T.insertIndex(TW, at('3')), at('4') + 1, 'Insert below item 3: after its part 4, before item 5');
eq(T.insertIndex(TW, at('6')), at('6') + 1, 'Insert below item 6: right after it');
eq(T.parentFor(TW, at('6') + 1, 1), '3', 'a new row at item 6\'s level, below it, is a part of item 3 (not of item 5, the row above at the top level)');
eq(T.parentFor(TW, at('7') + 1, 1), '3', 'the same below item 7');
eq(T.parentFor(TW, at('5') + 1, 1), '5', 'a row nested right below item 5 is a part of item 5 (the row above it)');
eq(T.parentFor(TW, at('5') + 1, 0), '', 'a row at the top level below item 5 has no parent');
eq(T.parentFor(TW, TW.length, 1), '8', 'a row nested at the end is a part of item 8');
eq(T.parentFor(TW, at('6') + 1, 2), '6', 'a row nested two levels below item 6 is a part of item 6');
ok(['indent', 'outdent'].every(op => TW.every((r, i) => { const ch = T[op](TW, i); return !ch || validOrder(apply(TW, ch), apply(TW, ch).map(x => x.id)); })), 'every Nest and Un-nest on the twin keeps every part after its parent');
ok(['moveUp', 'moveDown'].every(op => TW.every((r, i) => { const o = T[op](TW, i); return !o || validOrder(TW, o); })), 'every Move on the twin keeps every part after its parent');
// What the earlier functions did on this shape (the defects the grid inherited).
eq(L.moveUp(TW, at('5')), ['1', '2', '5', '6', '7', '3', '4', '8'], 'for the record, the earlier Move up on item 5 put 6 and 7 before their parent');
ok(!validOrder(TW, L.moveDown(TW, at('3'))), 'for the record, the earlier Move down on item 3 also put parts before their parent');
eq(L.outdent(TW, at('6')), { 6: '', 7: '6' }, 'for the record, the earlier Un-nest on item 6 made item 7 a part of item 6');
eq(L.parentFor(TW, at('6') + 1, 1), '5', 'for the record, the earlier rule gave a new row below item 6 the parent item 5');

// ── Random lists ────────────────────────────────────────────────────────
let seed = 20261015;
const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
// Contiguous: built in sequence, each row placed at a depth between 0 and one below the row above.
function contiguous(n) {
  const out = [], stack = [];
  for (let k = 0; k < n; k++) {
    const d = rnd(stack.length + 1);
    stack.length = d;
    out.push({ id: 'r' + k, parentID: d ? stack[d - 1] : '' });
    stack.push('r' + k);
  }
  return out;
}
// Anywhere: each row's parent is none or any earlier row.
function anywhere(n) {
  const out = [];
  for (let k = 0; k < n; k++) out.push({ id: 'r' + k, parentID: k && rnd(3) ? 'r' + rnd(k) : '' });
  return out;
}

step('lists where every part follows its parent directly: the same results as before');
const N1 = 3000;
const same = { indent: 0, outdent: 0, moveUp: 0, moveDown: 0, insertIndex: 0, parentFor: 0, block: 0, detached: 0 }, firstDiff = {};
let positions = 0;
for (let t = 0; t < N1; t++) {
  const rs = contiguous(1 + rnd(14)), ds = T.depths(rs);
  const check = (k, a, b, where) => { if (JSON.stringify(a) === JSON.stringify(b)) same[k]++; else if (!firstDiff[k]) firstDiff[k] = where + ': ' + JSON.stringify(a) + ' / ' + JSON.stringify(b) + ' in ' + JSON.stringify(rs); };
  rs.forEach((r, i) => {
    positions++;
    ['indent', 'outdent', 'moveUp', 'moveDown', 'insertIndex'].forEach(op => check(op, T[op](rs, i), L[op](rs, i), op + ' ' + i));
    check('block', blockEnd(rs, i), L.subtreeEnd(ds, i), 'block ' + i);
    check('detached', detached(rs)[i], -1, 'detached ' + i);
    // A new row placed below row i, at any depth the grid allows there (up to one below row i).
    for (let d = 0; d <= ds[i] + 1; d++) check('parentFor', T.parentFor(rs, i + 1, d), L.parentFor(rs, i + 1, d), 'parentFor ' + (i + 1) + ' ' + d);
  });
}
Object.keys(same).forEach(k => ok(!firstDiff[k], N1 + ' random lists (' + positions + ' rows): ' + k + ' gives the same as before at every row', firstDiff[k]));
ok(descendants(TW, 0).length === 0 && contiguousDescendantsMatch(), 'on those lists, an item\'s descendants are exactly the run of deeper rows after it (what Delete took before)');
function contiguousDescendantsMatch() {
  for (let t = 0; t < 500; t++) {
    const rs = contiguous(1 + rnd(14)), ds = T.depths(rs);
    for (let i = 0; i < rs.length; i++) {
      const want = []; for (let k = i + 1; k <= L.subtreeEnd(ds, i); k++) want.push(k);
      if (JSON.stringify(descendants(rs, i)) !== JSON.stringify(want)) return false;
    }
  }
  return true;
}

step('every issue of the sample library: the same results as before, and no part separated from its parent');
{
  const files = fs.readdirSync(LIB).filter(n => /\.csv$/.test(n)).map(n => R.readFile(n, fs.readFileSync(path.join(LIB, n), 'utf8'), {}));
  const st = R.buildLibrary(files, {}).state;
  const store = SCx.createStore(); store.load(st);
  const issues = new Set(Array.from(st.contents.values()).map(c => c.issueID));
  let n = 0, nested = 0, differ = '', det = 0;
  issues.forEach(iid => {
    const rs = store.contentsOfIssue(iid).map(c => ({ id: c.contentID, parentID: c.parentID }));
    const ds = T.depths(rs);
    nested += ds.filter(d => d > 0).length;
    det += detached(rs).filter(p => p !== -1).length;
    rs.forEach((r, i) => {
      n++;
      ['indent', 'outdent', 'moveUp', 'moveDown', 'insertIndex'].forEach(op => { if (!differ && JSON.stringify(T[op](rs, i)) !== JSON.stringify(L[op](rs, i))) differ = op + ' at ' + r.id; });
      if (!differ && JSON.stringify(descendants(rs, i).map(k => rs[k].id)) !== JSON.stringify(rs.slice(i + 1, L.subtreeEnd(ds, i) + 1).map(x => x.id))) differ = 'descendants at ' + r.id;
      for (let d = 0; d <= ds[i] + 1 && !differ; d++) if (T.parentFor(rs, i + 1, d) !== L.parentFor(rs, i + 1, d)) differ = 'parentFor below ' + r.id;
    });
  });
  ok(issues.size > 100 && nested > 900, 'the sample has ' + issues.size + ' issues with contents and ' + nested + ' nested items');
  ok(det === 0, 'no item of the sample is separated from its parent, so no output of it gains a "part of" label');
  ok(!differ, 'at every one of the sample\'s ' + n + ' items, every operation gives what it gave before', differ);
}

step('lists with parts anywhere after their parents: every result keeps the rules');
const N2 = 3000;
const bad = {};
const fail = (k, msg) => { if (!bad[k]) bad[k] = msg; };
const brute = (rs, i) => { const out = []; rs.forEach((r, k) => { let x = r.parentID; const seen = new Set(); while (x && !seen.has(x)) { if (x === rs[i].id) { out.push(k); break; } seen.add(x); const p = rs.find(y => y.id === x); x = p ? p.parentID : ''; } }); return out; };
let detachedSeen = 0;
for (let t = 0; t < N2; t++) {
  const rs = anywhere(1 + rnd(12)), ds = T.depths(rs), par = parentsOf(rs);
  detachedSeen += detached(rs).filter(p => p !== -1).length;
  const where = i => ' (row ' + i + ' of ' + JSON.stringify(rs) + ')';
  rs.forEach((r, i) => {
    const desc = descendants(rs, i);
    if (JSON.stringify(desc) !== JSON.stringify(brute(rs, i))) fail('descendants', 'descendants differ' + where(i));
    const e = blockEnd(rs, i);
    for (let k = i + 1; k <= e; k++) if (desc.indexOf(k) === -1) fail('block', 'block holds a row that is not a part' + where(i));
    if (e + 1 < rs.length && desc.indexOf(e + 1) !== -1) fail('block', 'block stops before a part right after it' + where(i));
    ['moveUp', 'moveDown'].forEach(op => {
      const o = T[op](rs, i);
      if (!o) return;
      if (!validOrder(rs, o)) fail('move-order', op + ' puts a part before its parent' + where(i));
      if (o.slice().sort().join() !== rs.map(x => x.id).sort().join()) fail('move-set', op + ' loses or adds a row' + where(i));
      const moved = rs.slice(i, e + 1).map(x => x.id), pos = o.indexOf(rs[i].id);
      if (o.slice(pos, pos + moved.length).join() !== moved.join()) fail('move-block', op + ' splits the moved block' + where(i));
      // The rows it passes are exactly one sibling's block.
      const passed = op === 'moveUp' ? o.slice(pos + moved.length, i + moved.length) : o.slice(i, pos);
      const s = rs.findIndex(x => x.id === passed[0]);
      if (!passed.length || par[s] !== par[i] || rs.slice(s, blockEnd(rs, s) + 1).map(x => x.id).join() !== passed.join()) fail('move-sibling', op + ' passes something other than one sibling\'s block' + where(i));
    });
    const ind = T.indent(rs, i);
    if (ind) {
      const keys = Object.keys(ind), j = rs.findIndex(x => x.id === ind[rs[i].id]);
      if (keys.length !== 1 || keys[0] !== rs[i].id || !(j < i) || par[j] !== par[i] || blockEnd(rs, j) !== i - 1) fail('indent', 'Nest changes something other than the item, or not to the sibling right above' + where(i));
      if (!validOrder(apply(rs, ind), rs.map(x => x.id))) fail('indent', 'Nest leaves a part before its parent' + where(i));
    }
    const out = T.outdent(rs, i);
    if (out) {
      const p = par[i], g = p === -1 ? -1 : par[p];
      if (out[rs[i].id] !== (g === -1 ? '' : rs[g].id)) fail('outdent', 'Un-nest does not move the item to its parent\'s parent' + where(i));
      const others = Object.keys(out).filter(id => id !== rs[i].id).map(id => rs.findIndex(x => x.id === id));
      if (detached(rs)[i] !== -1 && others.length) fail('outdent-detached', 'Un-nest on a separated item changes another item\'s parent' + where(i));
      if (others.some(k => par[k] !== p || k <= i || out[rs[k].id] !== rs[i].id)) fail('outdent-others', 'Un-nest adopts something other than a following sibling' + where(i));
      for (const k of others) for (let m = i + 1; m < k; m++) if (!brute(rs, rs.findIndex(x => x.id === rs[p].id)).includes(m)) fail('outdent-run', 'Un-nest adopts a sibling beyond an unrelated row' + where(i));
      if (!validOrder(apply(rs, out), rs.map(x => x.id))) fail('outdent', 'Un-nest leaves a part before its parent' + where(i));
    }
    if (T.insertIndex(rs, i) !== e + 1) fail('insert', 'Insert below does not go right after the block' + where(i));
    for (let d = 0; d <= ds[i] + 1; d++) {
      const pid = T.parentFor(rs, i + 1, d);
      if (d === 0 ? pid !== '' : !(pid === rs[i].id || brute(rs, rs.findIndex(x => x.id === pid)).includes(i)) || (pid && T.depths(rs)[rs.findIndex(x => x.id === pid)] !== d - 1)) fail('parentFor', 'a new row below row ' + i + ' at depth ' + d + ' gets ' + pid + where(i));
    }
  });
}
ok(detachedSeen > 1000, 'the random lists hold many separated parts (' + detachedSeen + ')');
[['descendants', 'Delete takes exactly the item and all its descendants, wherever they are'],
 ['block', 'an item\'s block is the item and the run of its parts right after it'],
 ['move-order', 'Move never puts a part before its parent'], ['move-set', 'Move only reorders'],
 ['move-block', 'Move keeps the moved block together'], ['move-sibling', 'Move passes exactly one sibling\'s block'],
 ['indent', 'Nest changes only the item, to its sibling right above, and keeps the order valid'],
 ['outdent', 'Un-nest moves the item to its parent\'s parent and keeps the order valid'],
 ['outdent-detached', 'Un-nest on a separated item changes no other item'],
 ['outdent-others', 'Un-nest adopts only following siblings'], ['outdent-run', 'and only those in its parent\'s block, never beyond an unrelated row'],
 ['insert', 'Insert below goes right after the item\'s block'],
 ['parentFor', 'a new row gets the row above, or one of its ancestors, as parent: never an unrelated row']].forEach(([k, what]) => ok(!bad[k], N2 + ' random lists: ' + what, bad[k]));

// ── Outputs ─────────────────────────────────────────────────────────────
step('outputs: a part separated from its parent says whose part it is');
const blank = ent => { const r = { spec: [], na: [], speculative: false }; SCx.schema.entities[ent].fields.forEach(c => { r[c.key] = c.type === 'bool' ? false : ''; }); return r; };
function twinLibrary(titles) {
  const st = SCx.emptyState();
  st.library = Object.freeze({ slug: 'PROBE-LIB', name: 'Probe Library', note: '' });
  const TID = 'PROBEGAZ-1875', IID = TID + '-K000001';
  const FT = 'SCAT_PROBE-LIB_TITLES.csv', FI = 'SCAT_PROBE-LIB_' + TID + '_ISSUES.csv', FC = 'SCAT_PROBE-LIB_' + TID + '_CONTENTS.csv';
  [[FT, 'title'], [FI, 'issue'], [FC, 'content']].forEach(([n, k]) => st.files.set(n, { name: n, kind: k, extraHeaders: [], hash: '', lastModified: 0, schemaVersion: '3.0', setAside: [] }));
  st.titles.set(TID, R.freezeRec(Object.assign(blank('title'), { titleID: TID, titleCode: 'PROBEGAZ', firstYear: '1875', canonicalTitle: 'The Probe Gazette', _src: FT, entryOrder: 1 })));
  st.issues.set(IID, R.freezeRec(Object.assign(blank('issue'), { overrides: [], issueID: IID, titleID: TID, volume: '4', issue: '1', year: '1875', _src: FI, entryOrder: 1 })));
  TW.forEach((r, k) => {
    const id = TID + '-C00000' + r.id, pid = r.parentID ? TID + '-C00000' + r.parentID : '';
    st.contents.set(id, R.freezeRec(Object.assign(blank('content'), { contentID: id, issueID: IID, titleID: TID, sequence: String(k + 1), itemTitle: titles[k], startPage: String(k + 1),
      parentID: pid, parentItem: pid ? titles[Number(r.parentID) - 1] : '', na: pid ? [] : ['Parent Item'], _src: FC, entryOrder: k + 1 })));
  });
  const store = SCx.createStore(); store.load(st);
  return { store, TID };
}
const TITLES = ['Masthead', 'Town Notes', 'Correspondence', 'A Letter on Roads', 'Market Report', 'A Letter on Schools', 'A Reply', 'Notices'];
{
  const { store, TID } = twinLibrary(TITLES);
  const vm = C.build(store, { titleIDs: [TID], nested: true, date: new Date(Date.UTC(2026, 9, 15)) });
  const cvs = vm.titles[0].issues[0].contents;
  ok(!cvs[3].partOf && cvs[5].partOf && cvs[5].partOf.title === 'Correspondence' && cvs[5].partOf.sequence === '3' && cvs[6].partOf && !cvs[4].partOf, 'the view model marks items 6 and 7 as parts of item 3, and only them');
  const lineOf = (text, title) => text.split('\n').find(l => l.indexOf(title) !== -1) || '';
  const cat = O.catalog(vm, { nested: true, types: true, itemNotes: false, evidence: false, marks: true });
  ok(/A Letter on Schools<span class="ct-note">part of “Correspondence”<\/span>/.test(cat) && /A Reply<span class="ct-note">part of “Correspondence”<\/span>/.test(cat), 'Catalog: items 6 and 7 say "part of “Correspondence”"', lineOf(cat, 'A Letter on Schools'));
  ok(!/A Letter on Roads<span class="ct-note">part of/.test(cat) && (cat.match(/part of/g) || []).length === 2, 'Catalog: item 4, right under its parent, has no such label; nothing else does');
  const wp = O.wordpress(vm, { nested: true, types: true, marks: true });
  ok(/A Letter on Schools<\/span><span style="[^"]*"> \(part of “Correspondence”\)<\/span>/.test(wp) && (wp.match(/part of/g) || []).length === 2, 'WordPress: items 6 and 7 say "(part of “Correspondence”)", and nothing else does');
  const pr = O.proofing(vm, { nested: true, files: {} });
  ok(['A Letter on Schools', 'A Reply'].every(t => lineOf(pr, t).indexOf('<span class="small">part of “Correspondence” (no. 3, above)</span>') !== -1), 'Proofing: items 6 and 7 say "part of “Correspondence” (no. 3, above)"', lineOf(pr, 'A Letter on Schools'));
  ok((pr.match(/part of “Correspondence” \(no\. 3, above\)/g) || []).length === 2 && (pr.match(/in “Correspondence”/g) || []).length === 1, 'Proofing: item 4 keeps "in “Correspondence”"');
  ['ris', 'bibtex'].forEach(k => ok((O[k](vm, { nested: true, headings: true }).match(/Part of: Correspondence/g) || []).length === 3, k.toUpperCase() + ': every part still says "Part of: Correspondence", as before'));
  const top = C.build(store, { titleIDs: [TID], nested: false });
  ok(!/part of/.test(O.catalog(top, { nested: false, types: true, marks: true })) && !/part of/.test(O.wordpress(top, { nested: false, types: true, marks: true })), 'with nested items left out, no label appears');
}
{
  const t = TITLES.slice(); t[2] = ''; t[0] = 'Masthead <b>&</b>';
  const { store, TID } = twinLibrary(t);
  const vm = C.build(store, { titleIDs: [TID], nested: true });
  ok(/part of item 3/.test(O.catalog(vm, { nested: true, types: true, marks: true })) && /part of no\. 3, above/.test(O.proofing(vm, { nested: true, files: {} })), 'a parent with no title is named by its number');
  const t2 = TITLES.slice(); t2[2] = 'Letters <script>x</script> & “Replies”';
  const v2 = C.build(twinLibrary(t2).store, { titleIDs: [TID], nested: true });
  const c2 = O.catalog(v2, { nested: true, types: true, marks: true }), w2 = O.wordpress(v2, { nested: true, types: true, marks: true }), p2 = O.proofing(v2, { nested: true, files: {} });
  ok([c2, w2, p2].every(x => x.indexOf('<script>x') === -1 && x.indexOf('part of “Letters &lt;script&gt;x&lt;/script&gt; &amp; “Replies””') !== -1), 'a parent title with markup is escaped in the label, in all three');
}

// ── The sample's outputs ────────────────────────────────────────────────
step('the sample library: no output gains a label');
{
  const files = fs.readdirSync(LIB).filter(n => /\.csv$/.test(n)).map(n => R.readFile(n, fs.readFileSync(path.join(LIB, n), 'utf8'), {}));
  const st = R.buildLibrary(files, {}).state;
  const store = SCx.createStore(); store.load(st);
  const vm = C.build(store, { titleIDs: Array.from(st.titles.keys()), nested: true, date: new Date(Date.UTC(2026, 9, 15)) });
  const all = vm.titles.reduce((a, t) => a.concat(...t.issues.map(i => i.contents)), []);
  ok(all.length > 2000 && all.every(cv => !cv.partOf), 'no contents item of the sample is marked as separated from its parent (' + all.length + ' items)');
  const outs = [O.catalog(vm, { nested: true, types: true, itemNotes: true, evidence: true, marks: true }), O.wordpress(vm, { nested: true, types: true, marks: true }), O.proofing(vm, { nested: true, files: {} })];
  ok(outs.every(x => !/part of [“i]|part of no\./.test(x)), 'Catalog, WordPress and proofing of the whole sample hold no "part of" label');
}

if (fails) { console.log('FAILED ' + fails + ' of ' + count + ' hierarchy checks'); process.exit(1); }
console.log('PASSED ' + count + ' hierarchy checks');
