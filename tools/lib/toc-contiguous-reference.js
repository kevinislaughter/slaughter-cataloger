/* Slaughter Cataloger 3 — test reference only: the structural functions of js/core/toc.js exactly as
   they were at 1b68081, before the D-12 repair (A3 batch 2). They read structure from indentation
   alone, which is right only when every part follows its parent directly. tools/test-hierarchy.js
   uses them to show that on such lists — every sample issue — the repaired functions give exactly
   what these gave. Not loaded by the app. */
'use strict';
module.exports = (function () {
  function depths(rows) {
    const byId = new Map(rows.map(r => [r.id, r]));
    const memo = new Map();
    const depth = r => {
      if (memo.has(r.id)) return memo.get(r.id);
      let d = 0, x = r;
      const seen = new Set([r.id]);
      while (x.parentID && byId.has(x.parentID) && !seen.has(x.parentID)) { seen.add(x.parentID); x = byId.get(x.parentID); d++; }
      memo.set(r.id, d);
      return d;
    };
    return rows.map(depth);
  }
  
  // Last index of row i's subtree.
  function subtreeEnd(ds, i) {
    let e = i;
    while (e + 1 < ds.length && ds[e + 1] > ds[i]) e++;
    return e;
  }
  // The previous row at the same depth with no shallower row in between (i's previous sibling).
  function prevSibling(ds, i) {
    for (let j = i - 1; j >= 0; j--) { if (ds[j] < ds[i]) return -1; if (ds[j] === ds[i]) return j; }
    return -1;
  }
  // The nearest earlier row at depth d (the parent a row at depth d+1 would have).
  function nearestAt(ds, i, d) {
    if (d < 0) return -1;
    for (let j = i - 1; j >= 0; j--) if (ds[j] === d) return j;
    return -1;
  }
  
  // Indent: the row becomes the last child of its previous sibling. Returns { id: newParentID } or null.
  function indent(rows, i) {
    const ds = depths(rows);
    const j = prevSibling(ds, i);
    if (j === -1) return null;
    return { [rows[i].id]: rows[j].id };
  }
  // Outdent: the row moves up a level; siblings that follow it become its children,
  // so the list still reads in sequence order. Returns { id: newParentID } or null.
  function outdent(rows, i) {
    const ds = depths(rows);
    if (!ds[i]) return null;
    const g = nearestAt(ds, i, ds[i] - 2);
    const out = { [rows[i].id]: g === -1 ? '' : rows[g].id };
    for (let k = subtreeEnd(ds, i) + 1; k < rows.length && ds[k] >= ds[i]; k++) if (ds[k] === ds[i]) out[rows[k].id] = rows[i].id;
    return out;
  }
  
  // Move a row (with its nested items) past its previous / next sibling. Returns the new order of ids, or null.
  function moveUp(rows, i) {
    const ds = depths(rows);
    const j = prevSibling(ds, i);
    if (j === -1) return null;
    const e = subtreeEnd(ds, i);
    const ids = rows.map(r => r.id);
    return ids.slice(0, j).concat(ids.slice(i, e + 1), ids.slice(j, i), ids.slice(e + 1));
  }
  function moveDown(rows, i) {
    const ds = depths(rows);
    const e = subtreeEnd(ds, i);
    const k = e + 1;
    if (k >= rows.length || ds[k] !== ds[i]) return null;
    const e2 = subtreeEnd(ds, k);
    const ids = rows.map(r => r.id);
    return ids.slice(0, i).concat(ids.slice(k, e2 + 1), ids.slice(i, e + 1), ids.slice(e2 + 1));
  }
  // Where a new row "below row i" goes: after i's nested items.
  function insertIndex(rows, i) { return subtreeEnd(depths(rows), i) + 1; }
  // The parent a row at depth d placed at index pos would have (by sequence order).
  function parentFor(rows, pos, d) {
    const ds = depths(rows);
    const j = nearestAt(ds.slice(0, pos), pos, d - 1);
    return j === -1 ? '' : rows[j].id;
  }
  return { depths, subtreeEnd, prevSibling, indent, outdent, moveUp, moveDown, insertIndex, parentFor };
})();
