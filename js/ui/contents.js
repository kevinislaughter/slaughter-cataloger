/* Slaughter Cataloger 3 — Stage 3: Contents.
   The table of contents of one issue as an editable list, in Sequence order.
   Nesting shows as indentation (Parent ContentID). Typing in the empty row at the
   end adds an item; Enter moves down a row; pasted lines become items. Sequence
   numbers are kept 1..n as items are added, moved and deleted. */
(function (SC) {
  'use strict';
  const { html, useState, useEffect, useRef, useMemo, useStore, navigate, routeHref, plural, cls, fieldState, toggleState, issueLabel, issueDate } = SC.ui;
  const S = SC.schema, R = SC.records, ids = SC.ids, T = SC.toc;
  const CENT = S.entities.content;
  const PARENT = CENT.byKey.get('parentItem').header;
  const COLS = T.COLS;                                   // itemTitle, author, contentType, startPage, endPage, notes
  // Text columns wrap; page numbers are one short line.
  const MULTILINE = { itemTitle: true, author: true, contentType: true, notes: true };
  const COMPLETES = { author: 'authors', contentType: 'types' };

  /* Spreadsheet-style completion: after typing at the end of a cell, the rest of the most used
     matching value is filled in and selected. Typing on replaces it; Backspace removes it. */
  function complete(el, list, inputType) {
    if (!list || !/^insert/.test(inputType || '') || el.selectionStart !== el.value.length) return false;
    const typed = el.value;
    if (!typed.trim()) return false;
    const low = typed.toLowerCase();
    const hit = list.find(x => x.length > typed.length && x.toLowerCase().indexOf(low) === 0);
    if (!hit) return false;
    el.value = hit;
    el.setSelectionRange(typed.length, hit.length);
    return true;
  }
  const TYPES = ['article', 'editorial', 'editorial note', 'letter', 'poem', 'review', 'notice', 'advertisement', 'illustration', 'essay', 'fiction',
    'translation', 'quotation', 'aphorism', 'report', 'obituary', 'announcement', 'section', 'department', 'masthead', 'contents listing', 'bibliography', 'footnote'];

  // Authors and content types already used, most frequent first: this title's, then the library's.
  function suggestions(store, titleID) {
    const count = (m, v) => { v = String(v || '').trim(); if (v) m.set(v, (m.get(v) || 0) + 1); };
    const types = new Map(), lib = new Map(), own = new Map();
    store.state.contents.forEach(c => { count(types, c.contentType); count(lib, c.author); });
    store.contentsOfTitle(titleID).forEach(c => count(own, c.author));
    const top = (m, n) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
    const t = new Set(top(types, 300)); TYPES.forEach(x => t.add(x));
    const a = new Set(top(own, 500)); top(lib, 1500).forEach(x => { if (a.size < 1500) a.add(x); });
    return { types: Array.from(t), authors: Array.from(a) };
  }

  // The focused cell, shared with the toolbar without redrawing the whole list on every focus.
  const focusBus = { cur: null, fns: new Set(), set(v) { this.cur = v; this.fns.forEach(f => f(v)); } };
  function focusCell(rowKey, col, caretAtStart) {
    setTimeout(() => {
      const el = document.querySelector('[data-cell="' + rowKey + ':' + col + '"]');
      if (!el) return;
      el.focus();
      if (el.setSelectionRange && typeof el.value === 'string') { const p = caretAtStart ? 0 : el.value.length; try { el.setSelectionRange(p, p); } catch (e) { /* not a text field */ } }
    }, 0);
  }

  // ── One editable cell ─────────────────────────────────────────────────
  function Cell(p) {
    const str = v => v == null ? '' : String(v);
    // As in the form fields: shows the record's value unless the person is typing, and only typing is committed.
    const [draft, setDraft] = useState(str(p.value));
    const typed = useRef(false);
    // As in the form fields (kit.js, D-K1): a value changed from outside while the cell held typing
    // that left it as it was is shown, and leaving the cell writes nothing back.
    const seen = useRef(str(p.value));
    if (str(p.value) !== seen.current) {
      if (typed.current && draft === seen.current) typed.current = false;
      seen.current = str(p.value);
    }
    const shown = typed.current ? draft : str(p.value);
    const st = p.st || { spec: false, na: false };
    const commit = v => { if (!typed.current) return; typed.current = false; if (v !== str(p.value)) p.onCommit(v); else setDraft(str(p.value)); };
    // Long notes take one line until the cell is in use. Text cells size to their content where the
    // browser can (field-sizing); elsewhere the row count is estimated.
    const [focused, setFocused] = useState(false);
    const clip = p.col === 'notes' && !focused;
    const lines = clip ? 1 : Math.min(8, Math.max(1, Math.ceil(shown.length / 40) + (shown.match(/\n/g) || []).length));
    const props = {
      'data-cell': p.rowKey + ':' + p.col, 'data-sc-field': '', 'data-pending': typed.current && draft !== str(p.value) ? 'true' : undefined,
      'aria-label': p.label, 'aria-describedby': p.describedBy || undefined, value: st.na ? '' : shown, readOnly: st.na, placeholder: st.na ? 'n/a' : (p.placeholder || ''),
      spellcheck: p.col === 'itemTitle' || p.col === 'notes',
      class: cls('cell', clip && 'clip', st.spec && 'is-spec', st.na && 'is-na', p.unaddressed && !st.spec && !st.na && !shown && 'is-unaddressed'),
      title: clip && shown.length > 24 ? shown : undefined,
      onInput: e => { typed.current = true; complete(e.target, p.complete, e.inputType); setDraft(e.target.value); },
      onFocus: () => { setFocused(true); p.onFocusCell(p.rowKey, p.col); },
      onBlur: e => { setFocused(false); commit(e.target.value); },
      onKeyDown: e => p.onKey(e, { rowKey: p.rowKey, col: p.col, el: e.target, commit: () => commit(e.target.value), revert: () => { typed.current = false; setDraft(str(p.value)); } }),
      onPaste: e => p.onPaste(e, p.rowKey, p.col)
    };
    return MULTILINE[p.col] ? html`<textarea rows=${lines} ...${props}></textarea>`
      : html`<input type="text" autocomplete="off" ...${props} />`;
  }

  const pagesOf = c => { const s = c.startPage, e = c.endPage; return s ? (e && e !== s ? s + '–' + e : s) : ''; };

  // ── The list ──────────────────────────────────────────────────────────
  function ContentsEditor({ issueID, issue, title, itemID }) {
    const store = useStore();
    useState(() => { focusBus.cur = null; });            // nothing focused yet in this issue
    // Arriving at an item (from a search result): its row is brought into view, marked, and its
    // title cell focused. Focus alone changes nothing: a cell commits only what is typed in it.
    const arrivedAt = itemID && store.state.contents.has(itemID) && store.state.contents.get(itemID).issueID === issueID ? itemID : '';
    useEffect(() => {
      if (!arrivedAt) return;
      setTimeout(() => {
        const cell = document.querySelector('[data-cell="' + arrivedAt + ':itemTitle"]');
        if (!cell) return;
        cell.focus({ preventScroll: true });
        if (cell.setSelectionRange) { try { cell.setSelectionRange(0, 0); } catch (e) { /* not a text field */ } }
        const row = cell.closest('tr');
        if (row) row.scrollIntoView({ block: 'center' });
      }, 0);
    }, [arrivedAt]);
    const titleID = issue ? issue.titleID : ids.titleIDFromChild(issueID);
    const items = store.contentsOfIssue(issueID);
    const rows = items.map(c => ({ id: c.contentID, parentID: c.parentID }));
    const ds = T.depths(rows);
    const index = new Map(rows.map((r, i) => [r.id, i]));
    const sugg = useMemo(() => suggestions(store, titleID), [titleID, store.state.contents.size]);
    const pending = useRef(new Set());
    const mint = () => { const id = ids.newContentID(titleID, x => store.state.contents.has(x) || pending.current.has(x)); pending.current.add(id); return id; };
    const [endDraft, setEndDraft] = useState(() => ({ id: mint(), depth: 0 }));
    const [insert, setInsert] = useState(null);           // { id, afterId, depth }: an empty row opened below an item
    const [bulk, setBulk] = useState(false);

    // Row keys in display order, for moving up and down.
    const insertAt = insert && index.has(insert.afterId) ? T.insertIndex(rows, index.get(insert.afterId)) : -1;
    const keys = rows.map(r => r.id);
    if (insertAt !== -1) keys.splice(insertAt, 0, insert.id);
    keys.push(endDraft.id);
    const keysRef = useRef(keys); keysRef.current = keys;
    const stateRef = useRef(); stateRef.current = { items, rows, ds, index, insert, insertAt, endDraft };

    // ── changes ──
    function renumber(order) {
      order.forEach((id, k) => {
        const c = store.state.contents.get(id);
        const want = String(k + 1);
        if (c && c.sequence !== want) store.put('content', Object.assign({}, c, { sequence: want }));
      });
    }
    // Insert new items at position pos (0..n) at depth; parsed = [{ values, depth }].
    function insertMany(pos, depth, parsed, label, firstId) {
      const { rows: cur } = stateRef.current;
      const file = store.fileForNew('content', titleID);
      const why = store.blocked(file); if (why) { SC.session.say('error', why); return null; }
      const list = cur.slice();
      const made = [];
      parsed.forEach((p, k) => {
        const id = k === 0 && firstId ? firstId : mint();
        const at = pos + k;
        const parentID = T.parentFor(list, at, depth + (p.depth || 0));
        list.splice(at, 0, { id, parentID });
        made.push({ id, parentID, values: p.values });
      });
      store.batch(label, () => {
        let eo = store.nextEntryOrder(file, 'content');
        made.forEach(m => {
          const parent = m.parentID && store.state.contents.get(m.parentID);
          const madeParent = !parent && m.parentID && made.find(x => x.id === m.parentID);
          const rec = { contentID: m.id, issueID, titleID, issueRef: '', parentID: m.parentID || '', sequence: '', itemTitle: '', author: '', contentType: '',
            parentItem: parent ? parent.itemTitle : madeParent ? (madeParent.values.itemTitle || '') : '', startPage: '', endPage: '', notes: '',
            spec: [], na: m.parentID ? [] : [PARENT], speculative: false, _src: file, entryOrder: eo++ };
          Object.keys(m.values).forEach(k => { rec[k] = String(m.values[k]); });
          rec.sequence = String(list.findIndex(r => r.id === m.id) + 1);
          store.put('content', rec);
        });
        renumber(list.map(r => r.id));
      });
      made.forEach(m => pending.current.delete(m.id));
      return made;
    }
    // A draft row gets its first value: it becomes an item.
    function createFrom(rowKey, col, v) {
      const s = stateRef.current;
      const isEnd = rowKey === s.endDraft.id;
      const pos = isEnd ? s.items.length : s.insertAt;
      const depth = isEnd ? s.endDraft.depth : s.insert.depth;
      insertMany(pos, depth, [{ values: { [col]: v }, depth: 0 }], 'Add item' + (col === 'itemTitle' ? ' ' + v : ''), rowKey);
      if (isEnd) setEndDraft({ id: mint(), depth: s.endDraft.depth }); else setInsert(null);
    }
    function edit(c, col, v) {
      if (typeof v === 'string' && col !== 'notes') v = v.replace(/\s+$/, '');
      store.put('content', Object.assign({}, c, { [col]: v }), 'Edit ' + CENT.byKey.get(col).label.toLowerCase() + (c.itemTitle ? ' (' + c.itemTitle.slice(0, 40) + ')' : ''));
    }
    function setParents(changes, label) {
      store.batch(label, () => Object.keys(changes).forEach(id => {
        const c = store.state.contents.get(id);
        const p = changes[id] && store.state.contents.get(changes[id]);
        const na = (c.na || []).filter(h => h !== PARENT);
        if (!p) na.push(PARENT);
        store.put('content', Object.assign({}, c, { parentID: p ? p.contentID : '', parentKept: '', parentItem: p ? p.itemTitle : '', na: R.orderStates(CENT, na) }));
      }));
    }
    function toggleCell(rowKey, col, which) {
      const c = store.state.contents.get(rowKey);
      const column = CENT.byKey.get(col);
      if (!c || !column.states || (which === 'na' && column.noNA)) return;
      store.put('content', Object.assign({}, c, toggleState(CENT, c, column, which)), (which === 'spec' ? 'Mark ? on ' : 'Mark N/A on ') + column.label.toLowerCase());
    }
    function rowAction(action, rowKey, col) {
      const s = stateRef.current;
      const i = s.index.has(rowKey) ? s.index.get(rowKey) : -1;
      if (i === -1) {                                     // a draft row: only its depth can change
        const prevDepth = s.rows.length ? s.ds[(rowKey === s.endDraft.id ? s.rows.length : s.insertAt) - 1] : undefined;
        const set = (d) => rowKey === s.endDraft.id ? setEndDraft(Object.assign({}, s.endDraft, { depth: d })) : setInsert(Object.assign({}, s.insert, { depth: d }));
        const cur = rowKey === s.endDraft.id ? s.endDraft.depth : s.insert && s.insert.depth;
        if (action === 'indent' && prevDepth !== undefined && cur <= prevDepth) set(cur + 1);
        if (action === 'outdent' && cur > 0) set(cur - 1);
        return;
      }
      const c = s.items[i];
      const name = c.itemTitle ? ' ' + c.itemTitle.slice(0, 40) : '';
      if (action === 'indent' || action === 'outdent') {
        const ch = action === 'indent' ? T.indent(s.rows, i) : T.outdent(s.rows, i);
        if (ch) setParents(ch, (action === 'indent' ? 'Nest' : 'Un-nest') + name);
      } else if (action === 'up' || action === 'down') {
        const order = action === 'up' ? T.moveUp(s.rows, i) : T.moveDown(s.rows, i);
        if (order) store.batch('Move' + name, () => renumber(order));
      } else if (action === 'insert') {
        const id = mint();
        setInsert({ id, afterId: rowKey, depth: s.ds[i] });
        focusCell(id, col || 'itemTitle');
        return;
      } else if (action === 'delete') {
        // The item and its parts (and theirs), wherever they are: not the rows that merely follow it indented.
        const desc = T.descendants(s.rows, i);
        const gone = [c].concat(desc.map(k => s.items[k]));
        const apart = desc.filter(k => k > T.blockEnd(s.rows, i)).length;
        if (gone.length > 1 && !confirm('Delete "' + (c.itemTitle || 'this item') + '" and the ' + plural(desc.length, 'item') + ' nested in it' +
          (apart ? ' (' + (apart === desc.length ? (apart === 1 ? 'it is' : 'all are') : apart + ' of them') + ' further down, after other items)' : '') + '? You can undo this.')) return;
        const goneIds = new Set(gone.map(g => g.contentID));
        const ks = keysRef.current;
        const next = ks.slice(ks.indexOf(c.contentID) + 1).find(k => !goneIds.has(k));
        store.batch('Delete' + name, () => {
          gone.forEach(g => store.remove('content', g.contentID));
          renumber(s.items.filter(x => gone.indexOf(x) === -1).map(x => x.contentID));
        });
        if (next) focusCell(next, col || 'itemTitle');
        return;
      }
      focusCell(rowKey, col || 'itemTitle');
    }
    function moveFocus(rowKey, col, dir) {
      setTimeout(() => {
        const ks = keysRef.current;
        const k = ks[ks.indexOf(rowKey) + dir];
        if (k) focusCell(k, col, dir < 0);
      }, 0);
    }
    function onKey(e, ctx) {
      const { rowKey, col, el } = ctx;
      const mod = e.ctrlKey || e.metaKey;
      if (e.altKey && e.shiftKey && !mod) {
        const map = { ArrowRight: 'indent', ArrowLeft: 'outdent', ArrowUp: 'up', ArrowDown: 'down' };
        if (map[e.key]) { e.preventDefault(); ctx.commit(); rowAction(map[e.key], rowKey, col); return; }
        if (e.code === 'KeyS' || e.code === 'KeyN') { e.preventDefault(); ctx.commit(); setTimeout(() => toggleCell(rowKey, col, e.code === 'KeyS' ? 'spec' : 'na'), 0); return; }
        // Delete, as the toolbar's button does, so that the keyboard need not leave the row (Tab back to the
        // toolbar passes through every cell above, and the toolbar acts on the last cell passed).
        if (e.key === 'Delete') { e.preventDefault(); ctx.commit(); if (stateRef.current.index.has(rowKey)) rowAction('delete', rowKey, col); return; }
      }
      if (mod && e.key === 'Enter') { e.preventDefault(); ctx.commit(); if (stateRef.current.index.has(rowKey)) rowAction('insert', rowKey, 'itemTitle'); return; }
      if (e.key === 'Enter' && !e.altKey && !mod) {
        if (e.shiftKey && (col === 'itemTitle' || col === 'notes')) return;   // a line break in a title or note
        e.preventDefault(); ctx.commit(); moveFocus(rowKey, col, e.shiftKey ? -1 : 1); return;
      }
      if (e.key === 'Escape') {
        ctx.revert();
        const s = stateRef.current;
        if (s.insert && s.insert.id === rowKey) { setInsert(null); focusCell(s.insert.afterId, col); }
        return;
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey && !e.shiftKey && !mod) {
        if (el.tagName === 'TEXTAREA') {
          const atStart = el.selectionStart === 0 && el.selectionEnd === 0, atEnd = el.selectionStart === el.value.length;
          if ((e.key === 'ArrowUp' && !atStart) || (e.key === 'ArrowDown' && !atEnd)) return;
        }
        e.preventDefault(); ctx.commit(); moveFocus(rowKey, col, e.key === 'ArrowDown' ? 1 : -1);
      }
    }
    function onFocusCell(rowKey, col) {
      const s = stateRef.current;
      if (s.insert && rowKey !== s.insert.id) setInsert(null);
      focusBus.set({ rowKey, col });
    }
    function onPaste(e, rowKey, col) {
      const text = ((e.clipboardData || window.clipboardData).getData('text/plain') || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
      if (text.indexOf('\n') === -1 && text.indexOf('\t') === -1) return;           // an ordinary paste
      e.preventDefault();
      const s = stateRef.current;
      const parsed = T.parseLines(text, { startCol: col });
      if (!parsed.length) return;
      const i = s.index.has(rowKey) ? s.index.get(rowKey) : -1;
      if (i !== -1 && parsed.length === 1) {                                        // one row of cells: fill this item
        const c = s.items[i];
        store.put('content', Object.assign({}, c, parsed[0].values), 'Paste into' + (c.itemTitle ? ' ' + c.itemTitle.slice(0, 40) : ' item'));
        return;
      }
      const isEnd = rowKey === s.endDraft.id;
      const pos = i !== -1 ? T.insertIndex(s.rows, i) : isEnd ? s.items.length : s.insertAt;
      const depth = i !== -1 ? s.ds[i] : isEnd ? s.endDraft.depth : s.insert.depth;
      const made = insertMany(pos, depth, parsed, 'Paste ' + plural(parsed.length, 'item'), i === -1 ? rowKey : null);
      if (!made) return;
      if (i === -1) { if (isEnd) setEndDraft({ id: mint(), depth: s.endDraft.depth }); else setInsert(null); }
      SC.session.say('ok', 'Added ' + plural(made.length, 'item') + ' from the pasted lines.');
      focusCell(made[made.length - 1].id, col);
    }

    const api = { rowAction, toggleCell, openBulk: () => setBulk(true) };
    const cellProps = { onKey, onFocusCell, onPaste };
    const nested = ds.filter(d => d > 0).length;

    // Draft rows and item rows share one shape, so when a draft row becomes an item
    // the browser keeps the same fields and the cursor stays where it was.
    function row(key, c, depth, seq, rel) {
      const here = c && key === arrivedAt;
      const noteId = rel ? 'part-note-' + key : undefined;
      const noteText = !rel ? '' : rel.parent ? 'part of no. ' + rel.parent.sequence + (rel.parent.itemTitle ? ', “' + rel.parent.itemTitle + '”' : '') + ', above'
        : (rel.parts.length === 1 ? 'its part no. ' + rel.parts[0] + ' is' : 'its parts nos. ' + rel.parts.join(', ') + ' are') + ' further down';
      return html`<tr key=${key} data-item=${c ? key : undefined} aria-current=${here ? 'true' : undefined}
        class=${cls(!c && 'draft-row', depth && 'nested', rel && rel.parent && 'detached', rel && rel.parts && 'has-detached', c && c.speculative && 'has-spec', here && 'arrived')}>
        <td class="seq dim">${seq}</td>
        ${COLS.map(col => {
          const column = CENT.byKey.get(col);
          const isTitle = col === 'itemTitle';
          const more = col === 'notes' && c && /\n|.{25}/.test(c.notes || '');
          return html`<td class=${cls('c-' + col, more && 'more')} style=${isTitle && depth ? 'padding-left:' + (6 + depth * 22) + 'px' : ''}>
            ${isTitle && depth ? html`<span class="nest-mark" aria-hidden="true">↳</span>` : null}
            <${Cell} rowKey=${key} col=${col} value=${c ? c[col] : ''} st=${c ? fieldState(c, column) : null} unaddressed=${!!c && column.states}
              label=${column.label + (c && c.itemTitle && !isTitle ? ', ' + c.itemTitle.slice(0, 40) : !c ? ', new item' : '')}
              placeholder=${!c && isTitle ? (depth ? 'Nested item' : 'New item') : ''} complete=${COMPLETES[col] && sugg[COMPLETES[col]]}
              describedBy=${isTitle ? noteId : undefined}
              onCommit=${c ? (v => edit(store.state.contents.get(key) || c, col, v)) : (v => { if (String(v).trim()) createFrom(key, col, v); })} ...${cellProps} />
            ${isTitle && rel ? html`<div class=${cls('item-note', rel.parent ? 'part-of' : 'parts-below')} id=${noteId}>${noteText}</div>` : null}</td>`;
        })}
      </tr>`;
    }
    const body = [];
    if (insertAt === 0) body.push(row(insert.id, null, insert.depth, ''));
    // A part whose parent is not the nearest less-indented row above it (D-12) says whose part it
    // is, and its parent says where its parts further down are.
    const det = T.detached(rows);
    const later = new Map();
    det.forEach((p, i) => { if (p !== -1) { if (!later.has(p)) later.set(p, []); later.get(p).push(items[i].sequence); } });
    items.forEach((c, i) => {
      const rel = det[i] !== -1 ? { parent: items[det[i]] } : later.has(i) ? { parts: later.get(i) } : null;
      body.push(row(c.contentID, c, ds[i], c.sequence, rel));
      if (insertAt === i + 1) body.push(row(insert.id, null, insert.depth, ''));
    });
    body.push(row(endDraft.id, null, endDraft.depth, items.length + 1));

    return html`<div>
      ${itemID && !arrivedAt && html`<div class="message warn" role="status"><span>That item is no longer in this issue.</span></div>`}
      <${Toolbar} api=${api} store=${store} />
      ${bulk && html`<${BulkAdd} onCancel=${() => setBulk(false)} onAdd=${(parsed) => {
        const made = insertMany(stateRef.current.items.length, 0, parsed, 'Add ' + plural(parsed.length, 'item'));
        if (!made) return;
        setBulk(false);
        SC.session.say('ok', 'Added ' + plural(made.length, 'item') + '.');
      }} />`}
      <div class="table-wrap"><table class="grid-toc">
        <colgroup><col class="w-seq" /><col class="w-title" /><col class="w-author" /><col class="w-type" /><col class="w-pg" /><col class="w-pg" /><col class="w-notes" /></colgroup>
        <thead><tr><th class="seq">Seq</th><th>Item title</th><th>Author / credit</th><th>Type</th><th>Start</th><th>End</th><th>Notes</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
      <p class="summary small">${plural(items.length, 'item')}${nested ? ', ' + nested + ' nested' : ''}. Type in the last row to add an item; paste several lines to add several.</p>
    </div>`;
  }

  // ── Toolbar for the focused row and cell ──────────────────────────────
  function Toolbar({ api, store }) {
    const [f, setF] = useState(focusBus.cur);
    useEffect(() => { const fn = v => setF(v); focusBus.fns.add(fn); return () => focusBus.fns.delete(fn); }, []);
    const c = f && store.state.contents.get(f.rowKey);
    const column = f && CENT.byKey.get(f.col);
    const st = c && column ? fieldState(c, column) : { spec: false, na: false };
    const keep = e => e.preventDefault();                 // keep the cursor in the cell
    const act = a => () => f && api.rowAction(a, f.rowKey, f.col);
    const b = (label, onClick, title, opts) => html`<button type="button" class=${cls('btn small', opts && opts.on && 'on', opts && opts.cls)} onMouseDown=${keep} onClick=${onClick}
      disabled=${opts && opts.disabled} title=${title} aria-label=${opts && opts.name} aria-pressed=${opts && opts.on !== undefined ? !!opts.on : undefined}>${label}</button>`;
    return html`<div class="grid-tools" role="toolbar" aria-label="Item tools">
      <span class="gt-where">${c ? html`Item ${c.sequence}${column ? html` · <strong>${column.label}</strong>` : ''}` : f ? 'New item' : 'Click a cell'}</span>
      <span class="gt-group">
        ${b('?', () => c && api.toggleCell(c.contentID, f.col, 'spec'), 'Speculative: inferred or uncertain (Alt+Shift+S)', { disabled: !c || !column.states, on: st.spec, cls: 'tog-btn spec' })}
        ${b('N/A', () => c && api.toggleCell(c.contentID, f.col, 'na'), 'Not applicable (Alt+Shift+N)', { disabled: !c || !column.states || column.noNA, on: st.na, cls: 'tog-btn' })}
      </span>
      <span class="gt-group">
        ${b('Nest →', act('indent'), 'Make it part of the item above (Alt+Shift+→)', { disabled: !f })}
        ${b('← Un-nest', act('outdent'), 'Move it out a level (Alt+Shift+←)', { disabled: !f })}
        ${b('↑', act('up'), 'Move up (Alt+Shift+↑)', { disabled: !c, name: 'Move up' })}
        ${b('↓', act('down'), 'Move down (Alt+Shift+↓)', { disabled: !c, name: 'Move down' })}
        ${b('Insert below', act('insert'), 'Open an empty row below (Ctrl+Enter)', { disabled: !c })}
        ${b('Delete', act('delete'), 'Delete this item (Alt+Shift+Delete; undo with Ctrl+Z)', { disabled: !c, cls: 'quiet danger' })}
      </span>
      <span class="gt-group gt-end">${b('Add several items…', () => api.openBulk(), 'Paste or type a whole table of contents')}</span>
    </div>`;
  }

  // ── Add several items at once ─────────────────────────────────────────
  function BulkAdd({ onAdd, onCancel }) {
    const [text, setText] = useState('');
    const [opts, setOpts] = useState({ pages: true, by: false, nest: false });
    const parsed = useMemo(() => T.parseLines(text, opts), [text, opts.pages, opts.by, opts.nest]);
    const opt = (k, label) => html`<label class="check"><input type="checkbox" checked=${opts[k]} onChange=${e => setOpts(Object.assign({}, opts, { [k]: e.target.checked }))} /> ${label}</label>`;
    return html`<div class="card bulk">
      <h2>Add several items</h2>
      <p class="hint">One item per line, in order; they are added after the last item. Columns copied from a spreadsheet (separated by tabs) go to title, author, type, start page, end page and notes.</p>
      <textarea class="bulk-text" rows="8" value=${text} onInput=${e => setText(e.target.value)} placeholder=${'The Village Green ........ 3\nA Plea for Better Roads, by J. Doe ........ 7\nNotes  12'}></textarea>
      <div class="bulk-opts">${opt('pages', 'Page numbers at the end of a line')}${opt('by', 'Split “…, by Author”')}${opt('nest', 'Two leading spaces nest an item')}</div>
      ${parsed.length > 0 && html`<div class="table-wrap bulk-preview"><table class="list">
        <thead><tr><th class="num">#</th><th>Item title</th><th>Author / credit</th><th>Type</th><th class="num">Pages</th><th>Notes</th></tr></thead>
        <tbody>${parsed.slice(0, 60).map((p, k) => html`<tr><td class="num dim">${k + 1}</td>
          <td style=${p.depth ? 'padding-left:' + (10 + p.depth * 20) + 'px' : ''}>${p.depth ? '↳ ' : ''}${p.values.itemTitle || ''}</td><td>${p.values.author || ''}</td><td>${p.values.contentType || ''}</td>
          <td class="num">${pagesOf(p.values)}</td><td>${p.values.notes || ''}</td></tr>`)}</tbody></table>
        ${parsed.length > 60 && html`<p class="hint">…and ${parsed.length - 60} more.</p>`}</div>`}
      <div class="actions">
        <button class="btn primary" disabled=${!parsed.length} onClick=${() => onAdd(parsed)}>${parsed.length ? 'Add ' + plural(parsed.length, 'item') : 'Add items'}</button>
        <button class="btn quiet" onClick=${onCancel}>Cancel</button>
      </div>
    </div>`;
  }

  // ── Choosing an issue ─────────────────────────────────────────────────
  function IssuePicker({ titleID, issues }) {
    const store = useStore();
    // Contents whose issue is not in any Issues file can still be opened.
    const orphans = Array.from(new Set(store.contentsOfTitle(titleID).map(c => c.issueID).filter(id => id && !store.state.issues.has(id))));
    return html`<div class="table-wrap"><table class="list">
      <thead><tr><th class="num">#</th><th>Issue</th><th>Date</th><th class="num">Contents</th></tr></thead>
      <tbody>${issues.map((i, n) => html`<tr key=${i.issueID} class="row-link" onClick=${e => { if (!e.target.closest('a')) navigate({ panel: 'contents', titleID, issueID: i.issueID }); }}>
        <td class="num dim">${n + 1}</td><td><a class="row-main" href=${routeHref({ panel: 'contents', titleID, issueID: i.issueID })}>${issueLabel(i)}</a></td><td>${issueDate(i)}</td>
        <td class="num">${store.contentsOfIssue(i.issueID).length || html`<span class="blank">—</span>`}</td></tr>`)}
        ${orphans.map(id => html`<tr key=${id} class="row-link" onClick=${e => { if (!e.target.closest('a')) navigate({ panel: 'contents', titleID, issueID: id }); }}>
          <td class="num dim"></td><td><a class="row-main" href=${routeHref({ panel: 'contents', titleID, issueID: id })}><code>${id}</code></a> <span class="tag">not in the Issues file</span></td><td></td>
          <td class="num">${store.contentsOfIssue(id).length}</td></tr>`)}</tbody>
    </table>${!issues.length && !orphans.length && html`<p class="empty">No issues recorded for this title yet. Record issues first, in Issues.</p>`}</div>`;
  }

  function ContentsPanel({ route }) {
    const store = useStore();
    const tid = route.titleID;
    if (!tid) return html`<section><h1 class="panel-title">Contents</h1><p class="empty">Choose a title above.</p></section>`;
    const title = store.state.titles.get(tid);
    const issues = store.issuesOfTitle(tid);
    if (!route.issueID || route.issueID === 'new') return html`<section>
      <h1 class="panel-title">Contents of <cite>${title ? title.canonicalTitle : tid}</cite></h1>
      <p class="summary">Choose an issue: a square in the strip, or a row below.</p>
      ${SC.views.RunStrip && html`<${SC.views.RunStrip} titleID=${tid} target="contents" />`}
      <${IssuePicker} titleID=${tid} issues=${issues} /></section>`;
    const issue = store.state.issues.get(route.issueID);
    const items = store.contentsOfIssue(route.issueID);
    if (!issue && !items.length) return html`<section><h1 class="panel-title">Contents</h1><p class="empty">No issue ${route.issueID} in this title.</p></section>`;
    const E = SC.views.IssueEntry;
    const pos = issues.findIndex(i => i.issueID === route.issueID);
    const next = pos !== -1 ? issues[pos + 1] : null;
    return html`<section class="contents">
      <h1 class="vh">Contents of ${issue ? issueLabel(issue) : route.issueID}</h1>
      <div class="card entry-card">
        ${issue ? html`<${E} rec=${issue} title=${title} />` : html`<div class="entry"><p class="entry-main">Issue <code>${route.issueID}</code></p><p class="entry-sub">This issue is not in the Issues file; its contents can still be edited.</p></div>`}
        ${issue && html`<div class="entry-facts"><a href=${routeHref({ panel: 'issues', titleID: tid, issueID: issue.issueID })}>Issue record</a>
          ${issue.pages && html`<span>${issue.pages} pages</span>`}</div>`}
      </div>
      <${ContentsEditor} key=${route.issueID} issueID=${route.issueID} issue=${issue} title=${title} itemID=${route.itemID} />
      ${next && html`<div class="actions next-issue">
        <a class="btn" href=${routeHref({ panel: 'contents', titleID: tid, issueID: next.issueID })}>Next issue: ${issueLabel(next)} →</a>
        <span class="hint">${store.contentsOfIssue(next.issueID).length ? plural(store.contentsOfIssue(next.issueID).length, 'item') + ' recorded' : 'No contents yet'} · <kbd>Alt</kbd>+<kbd>Page Down</kbd></span></div>`}
    </section>`;
  }

  SC.views = Object.assign(SC.views || {}, { ContentsPanel });
})(globalThis.SC = globalThis.SC || {});
