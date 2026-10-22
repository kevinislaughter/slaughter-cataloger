/* Slaughter Cataloger 3 — the store.
   The single copy of the library in memory. Every view reads from it and every
   change goes through it, so there is nothing to keep in sync.
   Records are frozen; a change replaces the record. Each change is recorded
   for undo/redo and marks the CSV files it affects as changed. */
(function (SC) {
  'use strict';
  const R = SC.records, S = SC.schema;

  function emptyState() {
    return { library: { slug: '', name: '', note: '' }, titles: new Map(), issues: new Map(), contents: new Map(), authorities: new Map(), files: new Map() };
  }
  const mapOf = (state, kind) => R.mapOfKind(state, kind);

  function createStore() {
    let state = emptyState();
    let version = 0;
    // Which files differ from what was last saved. Every undo step that touches a file gives it
    // a new revision number (never reused); undo and redo put back the number the file had.
    // A file is changed when its revision is not the one it had when last saved, or when it was
    // marked changed (on load, or restored from the browser) and has not been saved since.
    // So undoing past a save and then making a different edit can never look saved.
    let dirty = new Set();
    let forced = new Set();
    let rev = new Map(), savedRev = new Map();
    let nextRev = 1;
    const listeners = new Set();
    let undoStack = [], redoStack = [];
    let batchOps = null, batchLabel = '', batchFiles = null;
    let idx = { v: -1 };
    let unloaded = new Map();

    // Listeners get (version, event); event.changed lists [kind, id] of records that changed.
    function notify(event) { version++; listeners.forEach(fn => { try { fn(version, event || { type: 'change', changed: [] }); } catch (e) { console.error(e); } }); }
    const revOf = f => rev.get(f) || 0;
    function refresh(files) {
      files.forEach(f => { if (forced.has(f) || revOf(f) !== (savedRev.get(f) || 0)) dirty.add(f); else dirty.delete(f); });
    }
    // Close an undo step: give every file it touched a new revision.
    function stepRevs(files) {
      const revs = new Map();
      files.forEach(f => { const r = nextRev++; revs.set(f, [revOf(f), r]); rev.set(f, r); });
      refresh(files);
      return revs;
    }
    function setRevs(revs, forward) {
      revs.forEach((pair, f) => { const r = pair[forward ? 1 : 0]; if (r) rev.set(f, r); else rev.delete(f); });
      refresh(Array.from(revs.keys()));
    }
    const changedOf = ops => ops.map(op => [op.kind, op.id]);

    function indexes() {
      if (idx.v === version) return idx;
      const issuesByTitle = new Map(), contentsByIssue = new Map(), contentsByTitle = new Map(), childrenOf = new Map();
      state.issues.forEach(i => { if (!issuesByTitle.has(i.titleID)) issuesByTitle.set(i.titleID, []); issuesByTitle.get(i.titleID).push(i); });
      issuesByTitle.forEach(list => list.sort((a, b) => (a._src.localeCompare(b._src)) || ((a.entryOrder || 1e9) - (b.entryOrder || 1e9))));
      state.contents.forEach(c => {
        if (!contentsByIssue.has(c.issueID)) contentsByIssue.set(c.issueID, []);
        contentsByIssue.get(c.issueID).push(c);
        const tid = R.titleOfContent(state, c);
        if (!contentsByTitle.has(tid)) contentsByTitle.set(tid, []);
        contentsByTitle.get(tid).push(c);
        if (c.parentID) { if (!childrenOf.has(c.parentID)) childrenOf.set(c.parentID, []); childrenOf.get(c.parentID).push(c); }
      });
      const seq = c => { const n = parseFloat(c.sequence); return isNaN(n) ? 1e9 : n; };
      contentsByIssue.forEach(list => list.sort((a, b) => (seq(a) - seq(b)) || ((a.entryOrder || 1e9) - (b.entryOrder || 1e9))));
      idx = { v: version, issuesByTitle, contentsByIssue, contentsByTitle, childrenOf };
      return idx;
    }

    // A change to the library reaches the files whose rows carry what changed (the schema's library
    // columns): the slug is on every row, the name on Titles and Issues rows, the note on Titles rows
    // only. Another file with no rows of its own carries none of them. The Titles file is marked even
    // with no rows: the library's values belong there, and Save then refuses it and says why (DF-19).
    // (Before A2's minor round every file was marked changed, and the ones not carrying the change
    // were then marked saved unwritten.)
    const LIB_META = { slug: 'librarySlug', name: 'libraryName', note: 'libraryNote' };
    function libraryFiles(before, after) {
      const files = new Set();
      const s = v => String(v == null ? '' : v);
      const metas = Object.keys(LIB_META).filter(k => s(before && before[k]) !== s(after && after[k])).map(k => LIB_META[k]);
      if (!metas.length) return files;
      const withRows = new Set();
      [state.titles, state.issues, state.contents, state.authorities].forEach(m => m && m.forEach(r => { if (r._src) withRows.add(r._src); }));
      state.files.forEach((f, n) => {
        const ent = S.entities[f.kind];
        if (ent && (f.kind === 'title' || withRows.has(n)) && ent.columns.some(c => metas.indexOf(c.meta) !== -1)) files.add(n);
      });
      return files;
    }
    // Which files does a change touch?
    function touch(kind, before, after) {
      const files = new Set();
      if (kind === 'library') return libraryFiles(before, after);
      [before, after].forEach(r => { if (r && r._src) files.add(r._src); });
      // Looked up in the current state, never in the cached indexes (which can be out of date in
      // the middle of a batch or an undo): a file missed here would show as saved when it is not.
      // Issues files carry inherited title values, Title Code and First Year; only those reach them.
      if (kind === 'title') {
        const tid = (after || before).titleID;
        const reaches = !before || !after || ['titleCode', 'firstYear'].concat(Object.values(S.INHERIT)).some(k => before[k] !== after[k]);
        if (reaches) state.issues.forEach(i => { if (i.titleID === tid) files.add(i._src); });
      }
      // Contents files carry their issue's short name (Issue Reference).
      if (kind === 'issue' && before && after && before.shortname !== after.shortname) {
        state.contents.forEach(c => { if (c.issueID === after.issueID) files.add(c._src); });
      }
      return files;
    }
    // Apply one change; returns the files it touches.
    function apply(op, forward) {
      const rec = forward ? op.after : op.before;
      if (op.kind === 'library') { state.library = rec; return touch('library', op.before, op.after); }
      const m = mapOf(state, op.kind);
      if (rec) m.set(op.id, rec); else m.delete(op.id);
      if (rec && rec._src && !state.files.has(rec._src)) {
        state.files.set(rec._src, { name: rec._src, kind: op.kind, style: SC.csv.DEFAULT_STYLE, extraHeaders: [], hash: '', lastModified: 0, schemaVersion: S.VERSION, isNew: true });
      }
      const files = touch(op.kind, op.before, op.after);
      idx = Object.assign({}, idx, { v: -1 });   // queries rebuild; touch() may reuse the stale maps
      return files;
    }

    function pushStep(step) {
      undoStack.push(step);
      if (undoStack.length > 300) undoStack.shift();
      redoStack = [];
    }
    function record(op) {
      const files = apply(op, true);
      if (batchOps) { batchOps.push(op); files.forEach(f => batchFiles.add(f)); return; }
      pushStep({ label: op.label || '', ops: [op], revs: stepRevs(files) });
      notify({ type: 'change', changed: changedOf([op]) });
    }

    const store = {
      get state() { return state; },
      get version() { return version; },
      get dirty() { return dirty; },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

      load(newState, opts) {
        state = newState || emptyState();
        forced = new Set((opts && opts.dirty) || []);
        dirty = new Set(forced);
        rev = new Map(); savedRev = new Map();
        undoStack = []; redoStack = [];
        notify({ type: 'load', changed: [] });
      },

      put(kind, rec, label) {
        const id = rec[R.idKey(kind)];
        if (!id) throw new Error('Record has no ' + R.idKey(kind));
        const before = mapOf(state, kind).get(id) || null;
        const after = R.freezeRec(Object.assign({}, rec));
        record({ kind, id, before, after, label });
        return after;
      },

      remove(kind, id, label) {
        const before = mapOf(state, kind).get(id);
        if (!before) return;
        record({ kind, id, before, after: null, label });
      },

      setLibrary(lib, label) {
        record({ kind: 'library', before: state.library, after: Object.freeze(Object.assign({}, state.library, lib)), label });
      },

      // Group several changes into one undo step and one redraw.
      batch(label, fn) {
        if (batchOps) return fn();
        batchOps = []; batchLabel = label; batchFiles = new Set();
        try { fn(); } finally {
          const ops = batchOps, files = batchFiles; batchOps = null; batchFiles = null;
          if (ops.length) { pushStep({ label: batchLabel, ops, revs: stepRevs(files) }); notify({ type: 'change', changed: changedOf(ops) }); }
        }
      },

      undo() {
        const step = undoStack.pop(); if (!step) return null;
        step.ops.slice().reverse().forEach(op => apply(op, false));
        setRevs(step.revs, false);
        redoStack.push(step); notify({ type: 'change', changed: changedOf(step.ops) }); return step.label;
      },
      redo() {
        const step = redoStack.pop(); if (!step) return null;
        step.ops.forEach(op => apply(op, true));
        setRevs(step.revs, true);
        undoStack.push(step); notify({ type: 'change', changed: changedOf(step.ops) }); return step.label;
      },
      get canUndo() { return undoStack.length > 0; },
      get canRedo() { return redoStack.length > 0; },
      get undoLabel() { return undoStack.length ? undoStack[undoStack.length - 1].label : ''; },
      get redoLabel() { return redoStack.length ? redoStack[redoStack.length - 1].label : ''; },

      // The files' revisions when a save starts. Pass them to markSaved, so that changes made
      // while the save writes stay changed.
      revisions() { return new Map(rev); },
      // After these files were written: what was written is their revisions at the start.
      markSaved(names, meta, base) {
        names.forEach(n => {
          const r = base ? (base.get(n) || 0) : revOf(n);
          if (r) savedRev.set(n, r); else savedRev.delete(n);
          forced.delete(n);
          const f = state.files.get(n);
          if (f && meta && meta[n]) state.files.set(n, Object.assign({}, f, meta[n], { isNew: false }));
        });
        refresh(names);
        notify({ type: 'saved', changed: [] });
      },
      markDirty(names) { names.forEach(n => { forced.add(n); dirty.add(n); }); notify({ type: 'dirty', changed: [] }); },
      // Change a file's bookkeeping (not its records): missing on disk, rows set aside, hash.
      setFileMeta(name, patch) {
        const f = state.files.get(name); if (!f) return;
        state.files.set(name, Object.assign({}, f, patch));
        notify({ type: 'files', changed: [] });
      },

      issuesOfTitle: tid => indexes().issuesByTitle.get(tid) || [],
      contentsOfIssue: iid => indexes().contentsByIssue.get(iid) || [],
      contentsOfTitle: tid => indexes().contentsByTitle.get(tid) || [],
      childrenOf: cid => indexes().childrenOf.get(cid) || [],

      // Files in the folder (or among the files loaded) that the app did not take in — could not
      // read, another library, Beta 2 — name → why. Nothing new is ever written under those names.
      setUnloaded(map) { unloaded = new Map(map || []); },
      get unloaded() { return unloaded; },
      // Why a new record cannot go into this file ('' when it can).
      // Names compare without regard to case, as they do on Windows and macOS.
      blocked(name) {
        if (!name) return '';
        const lc = name.toLowerCase();
        if (Array.from(state.files.keys()).some(n => n.toLowerCase() === lc)) return '';
        const hit = Array.from(unloaded.keys()).find(n => n.toLowerCase() === lc);
        if (!hit) return '';
        return hit + ' is in the folder but was not loaded (' + (unloaded.get(hit) || 'it could not be read') + '). ' +
          'Anything new here would be saved under that name, so nothing can be added until that file is corrected or moved out of the folder; then reconnect or reopen the folder. See the Library page.';
      },

      // The file a new record should be written to: next to its siblings, else the default name.
      fileForNew(kind, titleID) {
        if (kind === 'title' || kind === 'authority') {
          for (const t of mapOf(state, kind).values()) return t._src;
          for (const f of state.files.values()) if (f.kind === kind) return f.name;
          return R.defaultFileName(kind, state.library.slug);
        }
        const sib = kind === 'issue' ? store.issuesOfTitle(titleID) : store.contentsOfTitle(titleID);
        if (sib.length) return sib[0]._src;
        return R.defaultFileName(kind, state.library.slug, titleID);
      },

      nextEntryOrder(fileName, kind) {
        let max = 0;
        mapOf(state, kind).forEach(r => { if (r._src === fileName && r.entryOrder > max) max = r.entryOrder; });
        return max + 1;
      },

      snapshot() {
        return {
          format: 'sc3-snapshot-1', savedAt: Date.now(), library: state.library,
          titles: Array.from(state.titles.values()), issues: Array.from(state.issues.values()), contents: Array.from(state.contents.values()),
          authorities: Array.from(state.authorities.values()),
          files: Array.from(state.files.values()), dirty: Array.from(dirty)
        };
      }
    };
    return store;
  }

  function stateFromSnapshot(snap) {
    const st = emptyState();
    st.library = Object.freeze(Object.assign({ slug: '', name: '', note: '' }, snap.library));
    (snap.titles || []).forEach(r => st.titles.set(r.titleID, R.freezeRec(Object.assign({}, r))));
    (snap.issues || []).forEach(r => st.issues.set(r.issueID, R.freezeRec(Object.assign({}, r))));
    (snap.contents || []).forEach(r => st.contents.set(r.contentID, R.freezeRec(Object.assign({}, r))));
    (snap.authorities || []).forEach(r => st.authorities.set(r.authorityID, R.freezeRec(Object.assign({}, r))));
    (snap.files || []).forEach(f => st.files.set(f.name, f));
    return st;
  }

  SC.createStore = createStore;
  SC.stateFromSnapshot = stateFromSnapshot;
  SC.emptyState = emptyState;
})(globalThis.SC = globalThis.SC || {});
