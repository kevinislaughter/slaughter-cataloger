/* Slaughter Cataloger 3 — session: opening, restoring, reconnecting, saving.
   Owns the store, the connection to the library folder, and the browser
   working copy. UI code calls these functions; it never touches files itself.

   What this file promises (tools/test-session.js checks each):
   - A file shows as saved only when the folder holds what the app last wrote or read
     (store.js revisions; a download counts only once you confirm it replaced the old file).
   - Every change reaches the browser's working copy as it is made (a journal entry), not
     after a delay; a storage failure is shown on screen, not just logged.
   - Reconnecting reads files added to the folder, reads again files changed there, and keeps
     (and flags) files that have gone or no longer read cleanly, rather than dropping records.
   - A save writes each file on its own: what was written is marked saved, what was not stays
     changed, and the message says which is which.
   - One tab at a time works on the working copy; another tab can take over. */
(function (SC) {
  'use strict';
  const R = SC.records, ST = SC.storage;
  const store = SC.createStore();

  // access: 'checking' → 'owner' (this tab works on the library) | 'elsewhere' (another tab has
  // it) | 'lost' (another tab took over). download: files downloaded and not yet confirmed.
  const ui = { mode: 'none', folderName: '', needsReconnect: false, wrongFolder: '', report: [], needsConversion: [], busy: '', message: null,
    restoredAt: 0, access: 'checking', storageProblem: '', download: null };
  const uiListeners = new Set();
  let messageTimer = null;
  function setUI(patch) {
    Object.assign(ui, patch);
    if ('message' in patch) {           // confirmations clear themselves; problems stay until dismissed
      clearTimeout(messageTimer);
      if (patch.message && patch.message.level === 'ok') messageTimer = setTimeout(() => setUI({ message: null }), 9000);
    }
    uiListeners.forEach(fn => fn());
  }
  let folder = null;
  let owner = false;
  // Every CSV in the folder at the last read, name → hash, loaded or not, so a reconnect can
  // tell a file that is new from one that was there before and not loaded.
  let diskSeen = new Map();

  // ── Working copy in the browser ───────────────────────────────────────
  // Each change is appended to a journal at once; after a few seconds of quiet (or every 200
  // changes) a snapshot of the whole library replaces the journal. Writes run in order.
  // gen: which library state the journal builds on. Opening or reloading a library starts a new
  // one, which needs a snapshot of its own before its journal entries mean anything: until that
  // snapshot is stored (needsSnapshot), the storage notice stays up, and a restore never replays
  // entries onto a snapshot of another state.
  // A journal entry that could not be stored leaves a gap: the notice then stays until a snapshot
  // (which holds everything) is stored, and later entries name the missing numbers (missed), so a
  // restore after a crash says that something could not be brought back.
  let seq = 0, gen = 0, needsSnapshot = false, sinceCompact = 0, compactTimer = null, compactDue = false, pending = 0;
  let missed = [];
  let chain = Promise.resolve();
  function enqueue(fn, isSnapshot, forGen, forSeq) {
    pending++;
    chain = chain.then(fn).then(
      () => {
        if (isSnapshot && forGen === gen) { needsSnapshot = false; missed = missed.filter(x => x > forSeq); if (!missed.length) ST.unstored.clear(); }
        if (ui.storageProblem && !needsSnapshot) setUI({ storageProblem: '' });
      },
      e => {
        if (e && e.name === 'NotOwner') { lostAccess(); return; }
        console.warn('Working copy not stored:', e);
        if (!isSnapshot && forSeq) { missed.push(forSeq); needsSnapshot = true; ST.unstored.add(); }
        setUI({ storageProblem: (e && e.message) || String(e) });
        compactSoon(isSnapshot ? 5000 : 0);         // try again; a snapshot closes a journal gap
      }
    ).then(() => { pending--; });
    return chain;
  }
  function entryFor(ev) {
    const st = store.state;
    return {
      at: Date.now(), type: ev.type, gen,
      records: (ev.changed || []).map(([kind, id]) => kind === 'library' ? ['library', '', st.library] : [kind, id, R.mapOfKind(st, kind).get(id) || null]),
      files: Array.from(st.files.values()), dirty: Array.from(store.dirty), missed: missed.slice()
    };
  }
  store.subscribe((v, ev) => {
    if (ev.type === 'load') { gen = Math.max(Date.now(), gen + 1); needsSnapshot = true; }   // unique across sessions
    if (!owner || ui.mode === 'none') return;
    if (ev.type === 'load') { compactSoon(0); return; }
    const s = ++seq, entry = entryFor(ev);
    enqueue(() => ST.working.append(s, entry), false, gen, s);
    compactSoon(++sinceCompact >= 200 ? 0 : 4000);
  });
  function compactSoon(ms) { clearTimeout(compactTimer); compactDue = true; compactTimer = setTimeout(compact, ms); }
  function compact() {
    clearTimeout(compactTimer);
    compactDue = false;
    if (!owner || ui.mode === 'none') return chain;
    const s = seq;
    const record = { snapshot: store.snapshot(), seq: s, gen, mode: ui.mode, folderName: ui.folderName, folder: folder ? ST.storableFolder(folder) : null,
      report: ui.report, needsConversion: ui.needsConversion, diskSeen: Array.from(diskSeen.entries()), unloaded: Array.from(store.unloaded.entries()) };
    sinceCompact = 0;
    return enqueue(() => ST.working.compact(record, s), true, gen, s);
  }
  // Replay one journal entry onto a state read from a snapshot.
  function applyEntry(st, e) {
    (e.records || []).forEach(([kind, id, rec]) => {
      if (kind === 'library') { st.library = Object.freeze(Object.assign({ slug: '', name: '', note: '' }, rec)); return; }
      const m = R.mapOfKind(st, kind);
      if (rec) m.set(id, R.freezeRec(Object.assign({}, rec))); else m.delete(id);
    });
    if (e.files) st.files = new Map(e.files.map(f => [f.name, f]));
  }

  // ── Starting: one tab at a time ───────────────────────────────────────
  function lostAccess() {
    owner = false;
    clearTimeout(compactTimer);
    setUI({ access: 'lost', busy: '' });
  }
  // Resolves once starting up (restoring and checking the folder) has finished.
  let started = null;
  const whenReady = () => started || Promise.resolve();
  function init() {
    started = (async () => {
      owner = await ST.takeLock(false, lostAccess);
      if (!owner) { setUI({ access: 'elsewhere' }); return; }
      setUI({ access: 'owner' });
      await restore();
    })();
    return started;
  }
  // Work in this tab instead of the other one (which then stops).
  function takeOver() {
    started = (async () => {
      owner = await ST.takeLock(true, lostAccess);
      if (!owner) return;
      setUI({ access: 'owner' });
      await restore();
    })();
    return started;
  }

  async function restore() {
    let data;
    try { data = await ST.working.read(); } catch (e) { setUI({ storageProblem: (e && e.message) || String(e) }); return; }
    const saved = data && data.session;
    const maxSeq = (data && data.journal.length) ? Math.max.apply(null, data.journal.map(j => j.seq)) : 0;
    seq = Math.max(seq, maxSeq);                 // never reuse a number, even of entries left without a snapshot
    if (!saved || !saved.snapshot) {
      // Nothing of the library was ever stored here; if changes failed to store, say so (once).
      const u = ST.unstored.read();
      if (u && u.count) {
        setUI({ message: { level: 'error', text: u.count + ' change(s) made in this browser could not be stored (the red notice said so at the time), and no copy of the library was stored either, so nothing could be restored. Open your library folder again; what you saved there is safe.' } });
        ST.unstored.clear();
      }
      return;
    }
    const st = SC.stateFromSnapshot(saved.snapshot);
    let dirty = saved.snapshot.dirty || [];
    // Replay only the entries made on top of this snapshot's state.
    const g = saved.gen || 0;
    const all = data.journal.slice().sort((a, b) => a.seq - b.seq);
    const after = all.filter(j => j.seq > (saved.seq || 0) && (j.entry.gen == null ? g : j.entry.gen) === g);
    const lost = all.filter(j => j.seq > (saved.seq || 0) && j.entry.gen != null && j.entry.gen !== g);
    after.forEach(j => { applyEntry(st, j.entry); if (j.entry.dirty) dirty = j.entry.dirty; });
    // Changes whose journal entry was never stored: named by later entries, or a number missing
    // between the snapshot and the last entry brought back.
    const present = new Set(all.map(j => j.seq)), gaps = new Set();
    const lastBack = after.length ? after[after.length - 1].seq : (saved.seq || 0);
    for (let x = (saved.seq || 0) + 1; x < lastBack; x++) if (!present.has(x)) gaps.add(x);
    after.forEach(j => (j.entry.missed || []).forEach(x => { if (x > (saved.seq || 0) && !present.has(x)) gaps.add(x); }));
    seq = Math.max(maxSeq, saved.seq || 0);
    diskSeen = new Map(saved.diskSeen || []);
    store.setUnloaded(saved.unloaded || []);
    store.load(st, { dirty });
    // What is shown is the stored snapshot plus its own journal: new entries build on that.
    gen = g; needsSnapshot = false;
    if (saved.mode === 'folder') folder = await ST.rememberedFolder(saved).catch(() => null);
    const reconnect = saved.mode === 'folder' && !!folder && !(await ST.hasPermission(folder, false).catch(() => false));
    const lastChange = after.length ? after[after.length - 1].entry.at : saved.snapshot.savedAt;
    const lostNote = lost.length ? [{ level: 'error', file: '', restore: true, msg: lost.length + ' change(s) made after a library was opened could not be restored, because this browser could not store that library at the time (see the red notice it showed then). The library as last stored is shown.' }] : [];
    // Failures are also counted outside IndexedDB, for when no later entry was stored to name them.
    const unstored = ST.unstored.read();
    const nLost = Math.max(gaps.size, unstored && unstored.count || 0);
    if (nLost) lostNote.push({ level: 'error', file: '', restore: true, msg: nLost + ' change(s) could not be restored, because this browser failed to store them at the time (the red notice said so then). What is shown is everything else; check it before saving.' });
    setUI({ mode: saved.mode, folderName: saved.folderName || '', report: lostNote.concat(saved.report || []), needsConversion: saved.needsConversion || [],
      needsReconnect: reconnect || (saved.mode === 'folder' && !folder), restoredAt: lastChange,
      message: lostNote.length ? { level: 'error', text: lostNote.map(n => n.msg).join(' ') } : ui.message });
    compact();
    if (saved.mode === 'folder' && folder && !reconnect) await syncFromFolder(false);
  }

  // ── Opening ───────────────────────────────────────────────────────────
  // A folder of nothing but Beta 2 files is not opened: it needs converting first.
  function onlyOldFiles(built) {
    const st = built.state;
    if (st.titles.size || st.issues.size || st.contents.size || st.authorities.size || !built.needsConversion.length) return false;
    setUI({ busy: '', message: { level: 'error', text: 'These ' + built.needsConversion.length + ' files are in the Beta 2 format, which this version does not open. They have not been changed. Convert them to 3.0 once (see the Guide), then open the converted files here.' } });
    return true;
  }
  // Changing which library or folder is open waits for a save to finish (a save writes into the
  // folder it started with; switching under it would mix the two).
  function waitForSave() {
    if (!saving) return false;
    setUI({ message: { level: 'warn', text: 'A save is still being written. Wait for it to finish, then try again.' } });
    return true;
  }
  async function openFolder() {
    if (waitForSave()) return;
    if (!owner || !(await confirmDiscard())) return;
    let handle;
    try { handle = await ST.pickFolder(); } catch (e) { if (e && e.name === 'AbortError') return; throw e; }
    setUI({ busy: 'Reading ' + handle.name + '…' });
    try {
      const files = await ST.readFolder(handle);
      const read = files.map(f => R.readFile(f.name, f.text, { lastModified: f.lastModified, encodingError: f.encodingError, allowEmpty: true }));
      const built = R.buildLibrary(read);
      if (onlyOldFiles(built)) return;
      folder = handle;
      diskSeen = new Map(files.map(f => [f.name, R.hashText(f.text)]));
      ST.resetSessionBackups();
      setUI({ mode: 'folder', folderName: handle.name, report: built.report, needsConversion: built.needsConversion, needsReconnect: false, wrongFolder: '', restoredAt: 0, busy: '', download: null,
        message: files.length ? null : { level: 'info', text: 'This folder has no CSV files yet. Start by adding a title.' } });
      store.setUnloaded(unloadedOf(read, built.state.files));
      discardDrafts();
      store.load(built.state, { dirty: built.changed });
    } catch (e) { setUI({ busy: '', message: { level: 'error', text: 'Could not read the folder: ' + e.message } }); }
  }

  async function loadFiles(fileList) {
    if (waitForSave()) return;
    if (!owner || !(await confirmDiscard())) return;
    setUI({ busy: 'Reading files…' });
    try {
      const files = await ST.readFileList(fileList);
      const read = files.map(f => R.readFile(f.name, f.text, { lastModified: f.lastModified, encodingError: f.encodingError, allowEmpty: true }));
      const built = R.buildLibrary(read);
      if (onlyOldFiles(built)) return;
      folder = null;
      diskSeen = new Map();
      setUI({ mode: 'files', folderName: '', report: built.report, needsConversion: built.needsConversion, needsReconnect: false, wrongFolder: '', restoredAt: 0, busy: '', message: null, download: null });
      store.setUnloaded(unloadedOf(read, built.state.files));       // a download under such a name would invite replacing that file
      discardDrafts();
      store.load(built.state, { dirty: built.changed });
    } catch (e) { setUI({ busy: '', message: { level: 'error', text: 'Could not read the files: ' + e.message } }); }
  }

  // Start an empty library (in a folder when the browser allows it).
  async function newLibrary(slug, name, note, useFolder) {
    if (waitForSave()) return false;
    if (!owner || !(await confirmDiscard())) return false;
    let handle = null;
    if (useFolder) {
      try { handle = await ST.pickFolder(); } catch (e) { if (e && e.name === 'AbortError') return false; throw e; }
      const existing = (await ST.readFolder(handle)).filter(f => /^SCAT_/i.test(f.name));
      if (existing.length) { setUI({ message: { level: 'error', text: 'That folder already holds Slaughter Cataloger files. Use Open library folder instead, or pick an empty folder.' } }); return false; }
    }
    folder = handle;
    diskSeen = new Map();
    ST.resetSessionBackups();
    const st = SC.emptyState();
    st.library = Object.freeze({ slug, name, note: note || '' });
    store.setUnloaded([]);
    setUI({ mode: handle ? 'folder' : 'files', folderName: handle ? handle.name : '', report: [], needsReconnect: false, wrongFolder: '', restoredAt: 0, message: null, download: null });
    discardDrafts();
    store.load(st);
    return true;
  }

  // Re-grant access to the remembered folder, then pick up anything changed on disk.
  async function reconnect() {
    if (waitForSave()) return;
    if (!owner) return;
    if (!folder) { setUI({ message: { level: 'error', text: 'The folder is no longer remembered. Use Choose folder to point to it again; your work here is kept.' } }); return; }
    const ok = await ST.hasPermission(folder, true).catch(() => false);
    if (!ok) { setUI({ message: { level: 'error', text: 'Access to ' + ui.folderName + ' was not granted. Your work is still here; you can grant access later.' } }); return; }
    setUI({ needsReconnect: false });
    await syncFromFolder(true);
  }
  // Point the working copy at a folder again (the remembered one is gone, or holds another
  // library). Unlike Open library folder, this keeps your unsaved work.
  async function chooseFolder() {
    if (waitForSave()) return;
    if (!owner) return;
    let handle;
    try { handle = await ST.pickFolder(); } catch (e) { if (e && e.name === 'AbortError') return; throw e; }
    const prev = { folder, folderName: ui.folderName, mode: ui.mode, wrongFolder: ui.wrongFolder, needsReconnect: ui.needsReconnect };
    folder = handle;
    setUI({ folderName: handle.name, mode: 'folder' });
    if (!(await syncFromFolder(true, true))) {
      folder = prev.folder;
      setUI({ folderName: prev.folderName, mode: prev.mode, wrongFolder: prev.wrongFolder, needsReconnect: prev.needsReconnect });
      return;
    }
    ST.resetSessionBackups();
    setUI({ needsReconnect: false, wrongFolder: '' });
    compact();
  }

  // Files read (from the folder, or picked) that did not end up in the library: name → why.
  // Nothing new is written under those names (store.blocked, storage mustNotExist).
  const EMPTY = R.hashText('');
  function unloadedOf(read, files, previous) {
    const why = new Map();
    read = read.filter(r => r.hash !== EMPTY);                 // an empty file holds nothing to protect
    read.forEach(r => { if (!r.ok) why.set(r.name, r.error); });
    (ui.report || []).forEach(n => { if (n.file && !why.has(n.file) && (n.level === 'skip' || n.level === 'error')) why.set(n.file, n.msg); });
    const m = new Map();
    read.forEach(r => { if (!files.has(r.name)) m.set(r.name, why.get(r.name) || (previous && previous.get(r.name)) || 'not loaded'); });
    return m;
  }

  // The libraries named by the CSVs in a folder.
  const librariesIn = results => Array.from(new Set(results.filter(r => r.ok && r.librarySlug).map(r => r.librarySlug)));

  /* Bring the working copy up to date with the folder.
     - Files you have not changed are read again if they changed on disk.
     - Files you have changed keep your version (saving backs up the disk version first); if the
       disk already holds exactly your version (a save interrupted after writing it), it counts as saved.
     - Files new in the folder are read.
     - Files no longer in the folder, or that no longer read cleanly, keep their records here and
       are flagged; a missing file is not written again until it is back or you remove it.
     - A folder holding another library is not read at all. Returns false then (or on an error). */
  async function syncFromFolder(announce, trying) {
    setUI({ busy: 'Checking ' + ui.folderName + ' for changes…' });
    try {
      const disk = await ST.readFolder(folder);
      const st = store.state, dirty = store.dirty;
      const read = disk.map(d => R.readFile(d.name, d.text, { lastModified: d.lastModified, encodingError: d.encodingError, allowEmpty: true }));
      const libs = librariesIn(read);
      if (st.library.slug && libs.length && libs.indexOf(st.library.slug) === -1) {
        const text = 'The folder ' + ui.folderName + ' holds the library ' + libs.join(', ') + ', not ' + st.library.slug + '. Nothing was read from it, and nothing will be saved into it. Your work here is kept; use Choose folder to point to the folder of ' + (st.library.name || st.library.slug) + '.';
        setUI(trying ? { busy: '', message: { level: 'error', text } } : { busy: '', needsReconnect: true, wrongFolder: text, message: { level: 'error', text } });
        return false;
      }
      const notes = [], results = [], alreadySaved = [], unreadable = new Map();
      const diskNames = new Set(disk.map(d => d.name));
      let differs = false;
      read.forEach(r => {
        const name = r.name, f = st.files.get(name);
        if (f && dirty.has(name)) {
          if (f.isNew && !f.hash) {
            // Made here and not saved yet, and now a file of that name is in the folder: written by
            // a save interrupted before it could be marked, an empty file left by a first write that
            // failed (written over next time), or another file altogether.
            if (r.hash === R.hashText(R.writeFile(st, name))) alreadySaved.push({ name, hash: r.hash });
            else if (r.hash !== EMPTY) notes.push({ level: 'warn', file: name, msg: 'A file of this name has appeared in the folder. The new file made here will not be written over it; move or rename the one in the folder, then save.' });
          } else if (f.hash && r.hash !== f.hash) {
            if (r.hash === R.hashText(R.writeFile(st, name))) alreadySaved.push({ name, hash: r.hash });
            else notes.push({ level: 'warn', file: name, msg: 'Changed on disk since it was read. Your unsaved changes are kept; saving backs up the disk version first.' });
          }
          if (f.missing) { notes.push({ level: 'info', file: name, msg: 'Back in the folder.' }); differs = true; }
          results.push(pseudoFile(st, name));
          return;
        }
        if (f && !r.ok) {
          // Read before, unreadable now (edited elsewhere?): keep the records read before.
          results.push(pseudoFile(st, name));
          unreadable.set(name, r.error);
          notes.push({ level: 'warn', file: name, msg: 'No longer reads cleanly: ' + r.error + ' The records read from it before are kept here.' });
          if (f.unreadable !== r.error) differs = true;
          return;
        }
        results.push(r);
        if (f) {
          if (f.missing) { notes.push({ level: 'info', file: name, msg: 'Back in the folder; read again.' }); differs = true; }
          else if (f.unreadable) { notes.push({ level: 'info', file: name, msg: 'Reads cleanly again; read again.' }); differs = true; }
          else if (r.hash !== f.hash) { notes.push({ level: 'info', file: name, msg: 'Changed on disk; read again.' }); differs = true; }
        } else if (diskSeen.get(name) !== r.hash) {
          differs = true;
          if (r.ok) notes.push({ level: 'info', file: name, newFile: true, msg: diskSeen.has(name) ? 'Changed on disk; read again.' : 'New in the folder; read.' });
          else if (r.hash !== EMPTY) notes.push({ level: 'warn', file: name, msg: (diskSeen.has(name) ? 'Changed on disk, and' : 'New in the folder, but') + ' cannot be read: ' + r.error + ' Not loaded.' });
        }
      });
      st.files.forEach((f, name) => {
        if (diskNames.has(name)) return;
        results.push(pseudoFile(st, name));
        if (!f.isNew) {
          notes.push({ level: 'warn', file: name, msg: 'Not in the folder. Its records are kept here, and nothing will be written to that name until the file is back or you remove it from the library (Library page).' });
          if (!f.missing) differs = true;
        }
      });
      diskSeen = new Map(read.map(r => [r.name, r.hash]));

      if (differs || alreadySaved.length) {
        const pinned = new Set(Array.from(st.files.keys()));
        const built = R.buildLibrary(results, { slug: st.library.slug, pinned });
        // Files kept from the working copy keep their bookkeeping (what was last read or written).
        results.filter(r => r.pseudo).forEach(r => {
          const m = Object.assign({}, st.files.get(r.name));
          if (!diskNames.has(r.name) && !m.isNew) m.missing = true; else delete m.missing;
          if (unreadable.has(r.name)) m.unreadable = unreadable.get(r.name); else delete m.unreadable;
          built.state.files.set(r.name, m);
        });
        alreadySaved.forEach(a => { const m = built.state.files.get(a.name); if (m) built.state.files.set(a.name, Object.assign({}, m, { hash: a.hash, isNew: false })); });
        const done = new Set(alreadySaved.map(a => a.name));
        const stillDirty = Array.from(dirty).filter(n => !done.has(n)).concat(built.changed);
        store.load(built.state, { dirty: Array.from(new Set(stillDirty)) });
        // A file that has appeared but was not taken in (a copy of a loaded file, say) is not "read".
        notes.forEach(n => {
          if (!n.newFile || built.state.files.has(n.file)) return;
          const why = built.report.find(x => x.file === n.file && x.level !== 'info');
          n.level = 'warn'; n.msg = 'In the folder, but not loaded: ' + (why ? why.msg : 'see the load report.');
        });
        const keep = ui.report.filter(x => x.restore);                // what restoring could not bring back stays listed
        setUI({ report: keep.concat(notes, built.report.filter(x => x.level !== 'info')), needsConversion: built.needsConversion });
      }
      store.setUnloaded(unloadedOf(read, store.state.files, store.unloaded));
      if (alreadySaved.length) notes.push({ level: 'info', file: '', msg: alreadySaved.map(a => a.name).join(', ') + ' already held your changes (written by an earlier save); marked saved.' });
      setUI({ busy: '', wrongFolder: '',
        message: !announce ? ui.message : { level: notes.some(n => n.level === 'warn') ? 'warn' : 'ok', text: 'Connected to ' + ui.folderName + '.' + (notes.length ? ' ' + notes.map(n => (n.file ? n.file + ': ' : '') + n.msg).join(' ') : ' Nothing had changed there.') } });
      compact();
      return true;
    } catch (e) { setUI({ busy: '', message: { level: 'error', text: 'Could not read ' + ui.folderName + ': ' + e.message } }); return false; }
  }

  // Present the store's records for one file as if freshly read, so a merge can rebuild.
  function pseudoFile(st, name) {
    const f = st.files.get(name);
    const map = R.mapOfKind(st, f.kind);
    const records = [];
    map.forEach(r => { if (r._src === name) records.push(Object.assign({}, r, { spec: r.spec.slice(), na: r.na.slice(), overrides: r.overrides ? r.overrides.slice() : undefined })); });
    return { name, kind: f.kind, ok: true, error: '', warnings: [], records, style: f.style, hash: f.hash, lastModified: Number.MAX_SAFE_INTEGER, pseudo: true,
      setAside: (f.setAside || []).slice(), schemaVersion: SC.schema.VERSION, librarySlug: st.library.slug, libraryName: st.library.name, libraryNote: st.library.note, extraHeaders: f.extraHeaders || [] };
  }

  // Remove a file that is no longer in the folder, and its records, from the library.
  async function forgetFile(name) {
    if (waitForSave()) return;
    const st = store.state, f = st.files.get(name);
    if (!owner || !f || !f.missing) return;
    let n = 0;
    R.mapOfKind(st, f.kind).forEach(r => { if (r._src === name) n++; });
    if (!globalThis.confirm('Remove ' + name + ' from the library? Its ' + n + ' record(s) will be taken out of the working copy here. The file is not in the folder, so nothing on disk changes. This cannot be undone, and it also clears the undo history of every file.')) return;
    const next = SC.emptyState();
    next.library = st.library;
    ['titles', 'issues', 'contents', 'authorities'].forEach(k => st[k].forEach((r, id) => { if (r._src !== name) next[k].set(id, r); }));
    st.files.forEach((m, k) => { if (k !== name) next.files.set(k, m); });
    store.load(next, { dirty: Array.from(store.dirty).filter(x => x !== name) });
    setUI({ report: ui.report.filter(r => r.file !== name), message: { level: 'ok', text: name + ' removed from the library.' } });
  }

  // ── Saving ────────────────────────────────────────────────────────────
  function changedFiles() {
    const st = store.state;
    return Array.from(store.dirty).filter(n => st.files.has(n)).map(name => ({ name, text: R.writeFile(st, name), baseline: st.files.get(name).hash }))
      .filter(f => !(st.files.get(f.name).isNew && SC.csv.parse(f.text).rows.length < 2));   // never write an empty new file
  }
  const list = names => names.join(', ');
  // Rows set aside because their ID repeated a loaded record's, where that record has since been
  // deleted: the next time the folder is read, such a row is taken in as that record.
  const ID_COL = { title: 'TitleID', issue: 'IssueID', content: 'ContentID', authority: 'AuthorityID' };
  function resurfacing(names) {
    const st = store.state, out = [];
    names.forEach(n => {
      const f = st.files.get(n);
      if (!f || !f.setAside) return;
      f.setAside.forEach(a => {
        const id = a.cells && a.cells[ID_COL[f.kind]];
        if (id && /already used/.test(a.reason) && !R.mapOfKind(st, f.kind).has(id)) out.push(n + ' row ' + a.row + ' (' + id + ')');
      });
    });
    return out;
  }

  // Saves run one at a time: a second Save (a click, Ctrl+S) waits for the first to finish, so an
  // older version of a file can never land on top of a newer one.
  let saving = null;
  function save() {
    if (saving) return saving.then(() => save());
    if (ui.busy) {        // reading or checking the folder: what a save would write over is not settled yet
      setUI({ message: { level: 'warn', text: 'Not saved yet: wait until "' + ui.busy + '" has finished, then save.' } });
      return Promise.resolve();
    }
    saving = saveNow().finally(() => { saving = null; });
    return saving;
  }
  async function saveNow() {
    if (ui.mode === 'none' || !owner) return;
    if (!(await ST.working.stillOwner().catch(() => true))) { lostAccess(); return; }
    const st = store.state;
    const base = store.revisions();
    const changed = changedFiles();
    const written = new Set(changed.map(f => f.name));
    // The library's name, note and slug are kept in the rows of its Titles file, so a Titles file
    // with no title is never written (DF-19): its change stays unsaved, and the message says why.
    const titleless = changed.filter(f => st.files.get(f.name).kind === 'title' && !Array.from(st.titles.values()).some(t => t._src === f.name));
    const files = changed.filter(f => titleless.indexOf(f) === -1);
    const emptyNew = Array.from(store.dirty).filter(n => st.files.has(n) && !written.has(n));      // nothing in them: nothing to write
    const missing = files.filter(f => st.files.get(f.name).missing);
    const candidates = files.filter(f => !st.files.get(f.name).missing);
    const same = candidates.filter(f => f.baseline && R.hashText(f.text) === f.baseline);      // already what was last read or written
    const toWrite = candidates.filter(f => same.indexOf(f) === -1);
    const quiet = same.map(f => f.name).concat(emptyNew);
    const missNote = (missing.length ? ' Not saved: ' + list(missing.map(f => f.name)) + ' — not in the folder, so nothing is written to that name (see the Library page).' : '') +
      (titleless.length ? ' Not saved: ' + list(titleless.map(f => f.name)) + ' — it would hold no title, and the library\'s name, note and slug are kept only in its rows. Add a title (or undo the step that removed the last one), then save.' : '');

    if (ui.mode === 'folder') {
      if (ui.wrongFolder) { setUI({ message: { level: 'error', text: ui.wrongFolder } }); return; }
      if (!folder || !(await ST.hasPermission(folder, true).catch(() => false))) { setUI({ needsReconnect: true, message: { level: 'error', text: 'Grant access to ' + ui.folderName + ' to save.' } }); return; }
      setUI({ busy: 'Saving ' + toWrite.length + ' file(s)…' });
      let res;
      // Ownership is checked before each file and just before each write lands, so a tab taken
      // over in the middle of a save writes nothing more.
      const stillOwner = async () => owner && await ST.working.stillOwner();
      try { res = await ST.withSaveLock(() => ST.writeFiles(folder, toWrite.map(f => ({ name: f.name, text: f.text, baseline: f.baseline, mustExist: !st.files.get(f.name).isNew, mustNotExist: !!st.files.get(f.name).isNew })), { stillOwner })); }
      catch (e) { res = { saved: {}, already: [], backups: [], conflicts: [], missing: [], occupied: [], failed: toWrite.map(f => ({ name: f.name, error: e.message })), backupFolder: '', stopped: false, notWritten: [] }; }
      const savedNames = Object.keys(res.saved);
      const meta = {};
      savedNames.forEach(n => { meta[n] = res.saved[n]; });
      store.markSaved(savedNames.concat(quiet), meta, base);
      res.missing.forEach(n => store.setFileMeta(n, { missing: true }));
      const parts = [];
      if (savedNames.length) parts.push('Saved ' + list(savedNames) + '.');
      else if (!toWrite.length && !missing.length && !titleless.length) parts.push('Nothing needed saving.');
      if (res.backups.some(n => savedNames.indexOf(n) !== -1)) parts.push('The versions they replaced are in ' + res.backupFolder + '.');
      res.conflicts.forEach(c => parts.push(c.name + ' had been changed on disk since it was read; that version is kept as ' + c.backup + '.'));
      if (res.failed.length) parts.push('Not saved: ' + res.failed.map(x => x.name + ' (' + x.error + ')').join('; ') + '. Your changes to ' + (res.failed.length === 1 ? 'it are' : 'them are') + ' still here; Save again to retry.');
      if (res.missing.length) parts.push('Not saved: ' + list(res.missing) + ' — no longer in the folder, so it was not made again. Its records are kept here (see the Library page).');
      if (res.occupied.length) parts.push('Not saved: ' + list(res.occupied) + ' — new here, but a file of that name is already in the folder (one this library did not load), so it was not written over. Your changes are still here; move or rename the file in the folder, then save again.');
      const back = savedNames.length ? resurfacing(Array.from(store.state.files.keys())) : [];
      if (back.length) parts.push('Note: ' + list(back) + ' — set aside because the ID repeated a record you have since deleted — will be read as that record the next time the folder is opened.');
      if (res.stopped) {
        lostAccess();
        parts.push('The save stopped because another tab took over the library' + (res.notWritten.length ? '; not written here: ' + list(res.notWritten) : '') + '. That tab has the changes; save there.');
      }
      const level = res.failed.length || res.missing.length || res.occupied.length || missing.length || titleless.length || res.stopped ? 'error' : res.conflicts.length || back.length ? 'warn' : 'ok';
      setUI({ busy: '', message: { level, text: ((res.failed.length || res.stopped ? 'Save did not finish. ' : '') + parts.join(' ') + missNote).trim() } });
    } else {
      // Without folder access a save is a download. It counts as saved only once you confirm the
      // downloaded files replaced the old ones; until then the files stay changed.
      toWrite.forEach(f => ST.download(f.name, f.text));
      if (quiet.length) store.markSaved(quiet, null, base);
      if (!toWrite.length) { setUI({ message: { level: missing.length || titleless.length ? 'error' : 'ok', text: 'Nothing needed downloading.' + missNote } }); return; }
      const meta = {};
      toWrite.forEach(f => { meta[f.name] = { hash: R.hashText(f.text) }; });
      setUI({ download: { at: Date.now(), names: toWrite.map(f => f.name), base, meta }, message: titleless.length ? { level: 'error', text: missNote.trim() } : null });
    }
  }
  // The downloaded files have replaced the old copies: count them as saved, as they were when
  // downloaded (changes made since stay changed).
  function confirmDownload() {
    const d = ui.download;
    if (!d) return;
    store.markSaved(d.names, d.meta, d.base);
    setUI({ download: null, message: { level: 'ok', text: 'Marked as saved: ' + list(d.names) + '.' } });
  }
  function dismissDownload() { setUI({ download: null }); }

  // Before another library replaces this one (or it is closed): one question for everything that
  // would be lost, unsaved files and new issues entered but not recorded (K-D1); none if neither.
  async function confirmDiscard() {
    if (ui.mode === 'none') return true;
    const files = store.dirty.size, drafts = (SC.drafts && SC.drafts.changed()) || [];
    if (!files && !drafts.length) return true;
    return globalThis.confirm(discardQuestion(files, drafts));
  }
  function discardQuestion(files, drafts) {
    const names = drafts.map(d => d.name);
    const and = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
    const draftText = drafts.length === 1 ? 'the new issue being entered for ' + and + ' has not been recorded' : 'the new issues being entered for ' + and + ' have not been recorded';
    if (!drafts.length) return files + ' file(s) have unsaved changes. Continue without saving them?';
    if (!files) return draftText.charAt(0).toUpperCase() + draftText.slice(1) + '. Continue without recording ' + (drafts.length === 1 ? 'it' : 'them') + '?';
    return files + ' file(s) have unsaved changes, and ' + draftText + '. Continue without saving or recording them?';
  }
  // New issues being entered belong to the library open now; when another replaces it, they go.
  const discardDrafts = () => { if (SC.drafts) SC.drafts.discard(); };

  async function closeLibrary() {
    if (waitForSave()) return;
    if (!owner || !(await confirmDiscard())) return;
    folder = null;
    diskSeen = new Map();
    clearTimeout(compactTimer);
    setUI({ mode: 'none', folderName: '', report: [], needsConversion: [], needsReconnect: false, wrongFolder: '', restoredAt: 0, message: null, download: null });
    store.setUnloaded([]);
    discardDrafts();
    store.load(SC.emptyState());
    ST.unstored.clear();
    await enqueue(() => ST.working.clear());
  }

  function dismissMessage() { setUI({ message: null }); }
  // A message from a stage: 'ok' clears itself, 'warn' and 'error' stay until dismissed.
  function say(level, text) { setUI({ message: { level, text } }); }
  function subscribeUI(fn) { uiListeners.add(fn); return () => uiListeners.delete(fn); }

  SC.session = { store, ui, init, whenReady, takeOver, openFolder, loadFiles, newLibrary, reconnect, chooseFolder, save, confirmDownload, dismissDownload, forgetFile,
    closeLibrary, dismissMessage, say, subscribeUI, changedFiles, flush: () => (compactDue ? compact() : chain), pendingWrites: () => pending, compactNow: compact };
})(globalThis.SC = globalThis.SC || {});
