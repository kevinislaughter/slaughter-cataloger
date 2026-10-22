/* Slaughter Cataloger 3 — the table of contents of one issue, as a flat list.
   Items are kept in Sequence order; nesting shows as depth, from Parent ContentID.
   These functions work out what an edit changes; the Contents stage applies the result to
   the store. Pure, testable in Node.

   rows: ordered [{ id, parentID }]  (sequence order, one issue)

   Structure comes from the parent links, never from indentation alone (D-12). A part always
   comes after what it is part of, but not always right after it: item 3's parts can be 4, 6 and
   7, with item 5, which is not part of it, in between. So:
   - an item's block is the item and the run of its own parts right after it (4, for item 3);
   - its parts are all its descendants, wherever they are (4, 6 and 7);
   - a part is detached when the nearest less-indented row above it is not its parent (6 and
     7 are shown indented under 5, which they are not part of; the grid and the outputs say whose
     part they are).
   When every part follows its parent directly (every sample issue), blocks are the runs of
   deeper rows the earlier version used, and every result is the same as before. */
(function (SC) {
  'use strict';

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

  // Depth helpers, kept for callers that have only depths: the run of deeper rows after row i,
  // and the previous row at the same depth with no shallower row between.
  function subtreeEnd(ds, i) {
    let e = i;
    while (e + 1 < ds.length && ds[e + 1] > ds[i]) e++;
    return e;
  }
  function prevSibling(ds, i) {
    for (let j = i - 1; j >= 0; j--) { if (ds[j] < ds[i]) return -1; if (ds[j] === ds[i]) return j; }
    return -1;
  }

  // ── Structure from the parent links ───────────────────────────────────
  // par[i]: the index of row i's parent, or -1 (none, not in this issue, or the row itself).
  function parents(rows) {
    const index = new Map(rows.map((r, i) => [r.id, i]));
    return rows.map(r => (r.parentID && r.parentID !== r.id && index.has(r.parentID) ? index.get(r.parentID) : -1));
  }
  // Is row k a descendant of row i (a part, or a part of a part …)?
  function under(par, k, i) {
    const seen = new Set([k]);
    for (let x = par[k]; x !== -1 && !seen.has(x); x = par[x]) { if (x === i) return true; seen.add(x); }
    return false;
  }
  // Last index of row i's block: i and the run of its descendants right after it.
  function blockEnd(rows, i, par) {
    par = par || parents(rows);
    let e = i;
    while (e + 1 < rows.length && under(par, e + 1, i)) e++;
    return e;
  }
  // Every descendant of row i, wherever it is, in sequence order.
  function descendants(rows, i, par) {
    par = par || parents(rows);
    const out = [];
    for (let k = 0; k < rows.length; k++) if (k !== i && under(par, k, i)) out.push(k);
    return out;
  }
  // For each row, the index of its parent when the row is detached (the nearest less-indented row
  // above it is not its parent), else -1.
  function detached(rows) {
    const par = parents(rows), ds = depths(rows);
    return rows.map((r, i) => {
      if (par[i] === -1) return -1;
      let j = i - 1;
      while (j >= 0 && ds[j] >= ds[i]) j--;
      return j === par[i] ? -1 : par[i];
    });
  }
  // Every part comes after its parent (the rule a new order must keep).
  function validOrder(rows, order) {
    const byId = new Map(rows.map(r => [r.id, r]));
    const at = new Map(order.map((id, k) => [id, k]));
    return order.length === rows.length && order.every((id, k) => {
      const r = byId.get(id);
      return r && (!r.parentID || !at.has(r.parentID) || r.parentID === id || at.get(r.parentID) < k);
    });
  }
  // The sibling whose block ends right above row i (i's previous sibling), or -1.
  function prevSiblingOf(rows, i, par) {
    if (i <= 0) return -1;
    let x = i - 1;
    const seen = new Set();
    while (x !== -1 && par[x] !== par[i] && !seen.has(x)) { seen.add(x); x = par[x]; }
    if (x === -1 || x === i || par[x] !== par[i]) return -1;
    return blockEnd(rows, x, par) === i - 1 ? x : -1;
  }

  // Indent: the row becomes the last part of its previous sibling. Returns { id: newParentID } or null.
  function indent(rows, i) {
    const par = parents(rows);
    const j = prevSiblingOf(rows, i, par);
    if (j === -1) return null;
    return { [rows[i].id]: rows[j].id };
  }
  // Outdent: the row moves up a level, to its parent's parent. If it was directly under its parent
  // (not detached), the siblings that follow it in its parent's block become its parts, so the list
  // still reads in sequence order. A detached row moves alone: no other item changes parent.
  // Returns { id: newParentID } or null.
  function outdent(rows, i) {
    const par = parents(rows);
    const p = par[i];
    if (p === -1) return null;
    const g = par[p];
    const out = { [rows[i].id]: g === -1 ? '' : rows[g].id };
    if (detached(rows)[i] !== -1) return out;
    for (let k = blockEnd(rows, i, par) + 1; k < rows.length && under(par, k, p); k++) if (par[k] === p) out[rows[k].id] = rows[i].id;
    return out;
  }

  // Move a row (with the parts right after it) past its previous / next sibling. Parent links do not
  // change, and no part ever comes before its parent. Returns the new order of ids, or null.
  function moveUp(rows, i) {
    const par = parents(rows);
    const j = prevSiblingOf(rows, i, par);
    if (j === -1) return null;
    const e = blockEnd(rows, i, par);
    const ids = rows.map(r => r.id);
    const order = ids.slice(0, j).concat(ids.slice(i, e + 1), ids.slice(j, i), ids.slice(e + 1));
    return validOrder(rows, order) ? order : null;
  }
  function moveDown(rows, i) {
    const par = parents(rows);
    const e = blockEnd(rows, i, par);
    const k = e + 1;
    if (k >= rows.length || par[k] !== par[i]) return null;
    const e2 = blockEnd(rows, k, par);
    const ids = rows.map(r => r.id);
    const order = ids.slice(0, i).concat(ids.slice(k, e2 + 1), ids.slice(i, e + 1), ids.slice(e2 + 1));
    return validOrder(rows, order) ? order : null;
  }
  // Where a new row "below row i" goes: after i's block (its parts right after it).
  function insertIndex(rows, i) { return blockEnd(rows, i) + 1; }
  // The parent a row at depth d placed at index pos would have: the row above it, or the one of
  // that row's ancestors at depth d - 1 (what the indentation shows), never an unrelated row.
  function parentFor(rows, pos, d) {
    if (d <= 0 || pos <= 0) return '';
    const par = parents(rows.slice(0, pos));
    const chain = [];
    const seen = new Set();
    for (let x = pos - 1; x !== -1 && !seen.has(x); x = par[x]) { seen.add(x); chain.unshift(x); }   // root … row above
    return rows[chain[Math.min(d - 1, chain.length - 1)]].id;
  }

  // ── Pasted tables of contents ─────────────────────────────────────────
  const COLS = ['itemTitle', 'author', 'contentType', 'startPage', 'endPage', 'notes'];
  const isRoman = s => SC.numbering.isRoman(s);
  const PAGE = '(\\d+|[ivxlcdm]+)';
  const RE_LEADERS = new RegExp('^(.*?\\S)\\s*[.·…_]{2,}\\s*' + PAGE + '(?:\\s*[-–]\\s*' + PAGE + ')?\\s*$', 'i');
  const RE_SPACES = /^(.*?\S)\s{2,}(\d+)(?:\s*[-–]\s*(\d+))?\s*$/;
  const RE_PP = new RegExp('^(.*?\\S)\\s*,?\\s+pp?\\.\\s*' + PAGE + '(?:\\s*[-–]\\s*' + PAGE + ')?\\s*$', 'i');
  const RE_BY = /^(.*?\S)[.,;:]?\s+by\s+(\S.*)$/i;
  const RE_BULLET = /^(?:[•◦▪‣·*]|[–—-](?=\s))\s*/;

  function pagesOf(line) {
    for (const re of [RE_LEADERS, RE_PP, RE_SPACES]) {
      const m = re.exec(line);
      if (!m) continue;
      const okPage = p => !p || /^\d+$/.test(p) || (re !== RE_SPACES && isRoman(p));
      if (okPage(m[2]) && okPage(m[3])) return { rest: m[1], start: m[2], end: m[3] || '' };
    }
    return null;
  }

  /* Lines of text -> [{ values, depth }].
     opts: startCol (column the paste begins in; default itemTitle), pages (find page numbers at
     line ends; default on), by (split "Title, by Author"), nest (two leading spaces = one level). */
  function parseLines(text, opts) {
    opts = opts || {};
    const startCol = COLS.indexOf(opts.startCol) === -1 ? 'itemTitle' : opts.startCol;
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
    const out = [];
    const stack = [];
    lines.forEach(line => {
      let depth = 0;
      if (opts.nest) {
        const w = /^[ \t]*/.exec(line)[0].replace(/\t/g, '  ').length;
        while (stack.length && stack[stack.length - 1] >= w) stack.pop();
        depth = stack.length; stack.push(w);
        line = line.replace(/^[ \t]+/, '');
      }
      const values = {};
      if (line.indexOf('\t') !== -1) {
        const cells = line.replace(/\s+$/, '').split('\t').map(c => c.trim());
        const at = COLS.indexOf(startCol);
        if (startCol === 'itemTitle' && cells.length === 2 && /^(\d+|[ivxlcdm]+)(\s*[-–]\s*(\d+|[ivxlcdm]+))?$/i.test(cells[1])) {
          const p = cells[1].split(/\s*[-–]\s*/);
          values.itemTitle = cells[0]; values.startPage = p[0]; if (p[1]) values.endPage = p[1];
        } else cells.forEach((c, k) => { if (at + k < COLS.length) values[COLS[at + k]] = c; });
      } else {
        let v = line.trim().replace(RE_BULLET, '');
        if (startCol === 'itemTitle') {
          const pg = opts.pages === false ? null : pagesOf(v);
          if (pg) { v = pg.rest; values.startPage = pg.start; if (pg.end) values.endPage = pg.end; }
          const by = opts.by ? RE_BY.exec(v) : null;
          if (by) { v = by[1]; values.author = by[2].trim(); }
        }
        values[startCol] = v;
      }
      // Fixed key order makes results easy to compare.
      const ordered = {};
      COLS.forEach(c => { if (c in values) ordered[c] = values[c]; });
      out.push({ values: ordered, depth });
    });
    return out;
  }

  SC.toc = { COLS, depths, subtreeEnd, prevSibling, parents, blockEnd, descendants, detached, validOrder, indent, outdent, moveUp, moveDown, insertIndex, parentFor, parseLines };
})(globalThis.SC = globalThis.SC || {});
