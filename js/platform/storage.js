/* Slaughter Cataloger 3 — where the data lives.
   1. Your library folder (Chrome / Edge): CSVs are read from it and saved back
      into it. The first time a file is overwritten in a session, the copy on
      disk is backed up to _backups/<date-time>/ first.
   2. The browser's working copy (IndexedDB): every change is written to it as it
      is made (a small journal entry), and now and then the whole library is
      written as one snapshot and the journal emptied. A closed tab or a crash
      loses at most a change made in the instant before it. Not a substitute
      for saving: clearing the browser's site data deletes it.
   3. Fallback (other browsers): load CSVs by picking or dropping files, and
      download the changed files. */
(function (SC) {
  'use strict';

  // ── IndexedDB ─────────────────────────────────────────────────────────
  // kv: 'session' = { snapshot, seq, mode, folderName, folder (handle), report, needsConversion }
  // journal: key = sequence number, value = one change (see session.js)
  const DB_NAME = 'slaughter-cataloger-3', KV = 'kv', JOURNAL = 'journal';
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) { reject(new Error('this browser has no IndexedDB storage')); return; }
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
          if (!d.objectStoreNames.contains(JOURNAL)) d.createObjectStore(JOURNAL);
        };
        req.onsuccess = () => { const d = req.result; d.onversionchange = () => d.close(); resolve(d); };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('the browser storage is held by an older copy of the app in another tab'));
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  }
  // One transaction; resolves once it has committed (durability "strict" where the browser supports it).
  async function tx(stores, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      let t;
      try { t = d.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); } catch (e) { t = d.transaction(stores, mode); }
      let out;
      try { out = fn(t); } catch (e) { reject(e); try { t.abort(); } catch (x) { /* already finished */ } return; }
      t.oncomplete = () => resolve(out && typeof out === 'object' && 'result' in out ? out.result : out);
      t.onerror = () => reject(t.error || new Error('storage error'));
      t.onabort = () => reject(t.error || new Error('storage write was cancelled'));
    });
  }
  const idb = {
    get: key => tx([KV], 'readonly', t => t.objectStore(KV).get(key)).catch(() => undefined),
    set: (key, val) => tx([KV], 'readwrite', t => t.objectStore(KV).put(val, key)),
    del: key => tx([KV], 'readwrite', t => t.objectStore(KV).delete(key)).catch(() => undefined)
  };
  // Every write checks, inside its own transaction, that this tab still owns the working copy
  // (kv.owner = { id, at }). A tab that has been taken over can therefore never write, even if
  // it has not noticed yet: its transaction is cancelled and it is told (error name NotOwner).
  const TAB = Math.random().toString(36).slice(2) + Date.now().toString(36);
  async function fencedTx(stores, fn) {
    let notOwner = false;
    try {
      return await tx(stores.indexOf(KV) === -1 ? [KV].concat(stores) : stores, 'readwrite', t => {
        t.objectStore(KV).get('owner').onsuccess = e => {
          const o = e.target.result;
          if (o && o.id !== TAB) { notOwner = true; t.abort(); return; }
          fn(t);
        };
      });
    } catch (e) {
      if (notOwner) { const x = new Error('another tab has taken over the library'); x.name = 'NotOwner'; throw x; }
      throw e;
    }
  }
  const working = {
    // Append one journal entry.
    append: (seq, entry) => fencedTx([KV, JOURNAL], t => { t.objectStore(JOURNAL).put(entry, seq); }),
    // Write a whole snapshot and drop the journal entries it includes, in one transaction.
    compact: (session, seq) => fencedTx([KV, JOURNAL], t => {
      t.objectStore(KV).put(session, 'session');
      if (seq > 0) t.objectStore(JOURNAL).delete(IDBKeyRange.upperBound(seq));
    }),
    // The snapshot and every journal entry, in order.
    read: () => tx([KV, JOURNAL], 'readonly', t => {
      const out = { session: null, journal: [] };
      t.objectStore(KV).get('session').onsuccess = e => { out.session = e.target.result || null; };
      t.objectStore(JOURNAL).openCursor().onsuccess = e => { const c = e.target.result; if (c) { out.journal.push({ seq: c.key, entry: c.value }); c.continue(); } };
      return { get result() { return out; } };
    }),
    clear: () => fencedTx([KV, JOURNAL], t => { t.objectStore(KV).delete('session'); t.objectStore(KV).delete('folder'); t.objectStore(JOURNAL).clear(); }),
    // Make this tab the owner (on starting, or taking over).
    claim: () => tx([KV], 'readwrite', t => { t.objectStore(KV).put({ id: TAB, at: Date.now() }, 'owner'); }),
    // Folder saves check too (not in the same transaction as the file write, so a takeover in the
    // very instant of a save can still let that one save finish).
    stillOwner: async () => { const o = await idb.get('owner'); return !o || o.id === TAB; }
  };

  // ── One tab at a time ─────────────────────────────────────────────────
  // There is one working copy per browser, so only one tab may change it. With Web Locks the
  // first tab holds a lock until it closes; another tab can take over, and the first then stops.
  // Without Web Locks (an older browser, or a page served over plain http from another machine)
  // a tab says it is here by a note in localStorage every 2 s, and removes it when it closes; a
  // note fresher than 6 s means another tab has the library. Either way the owner record in
  // IndexedDB fences every write (above), so a tab that has been taken over cannot write.
  const LOCK = 'slaughter-cataloger-3-working-copy', LS_KEY = 'slaughter-cataloger-3-owner', FRESH = 6000;
  let onLost = null, beat = null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hasLocks = () => !!(globalThis.navigator && navigator.locks && navigator.locks.request);
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } };
  const lsSet = v => { try { if (v) localStorage.setItem(LS_KEY, JSON.stringify(v)); else localStorage.removeItem(LS_KEY); } catch (e) { /* no localStorage: nothing to coordinate with */ } };
  // Writes in progress when the library is taken over are abandoned at once (abort), so the new
  // tab's save does not wait on them and they cannot land afterwards.
  let lostFlag = false;
  const inflight = new Set();
  function lost() {
    lostFlag = true;
    if (beat) { clearInterval(beat); beat = null; }
    inflight.forEach(stop => stop());
    if (onLost) onLost();
  }
  function requestLock(steal) {
    return new Promise(resolve => {
      navigator.locks.request(LOCK, steal ? { steal: true } : { ifAvailable: true }, lock => {
        if (!lock) { resolve(false); return null; }
        resolve(true);
        return new Promise(() => {});            // held until this tab goes away, or another takes it
      }).catch(e => { if (e && e.name === 'AbortError') lost(); else resolve(false); });
    });
  }
  async function takeLock(steal, onLostAccess) {
    if (onLostAccess) onLost = onLostAccess;
    let got = false;
    if (hasLocks()) {
      // A reload starts the new page before the old one has always let go: ask again for a moment.
      for (let i = 0; i < (steal ? 1 : 10) && !got; i++) {
        got = await requestLock(steal);
        if (!got) await sleep(200);
      }
    } else {
      // A fresh note from another tab: watch it for a little over one beat. A live tab renews it
      // every 2 s; a note that does not change was left by a tab (or browser) that has gone.
      let first = null, alive = false;
      for (let i = 0; i < (steal ? 1 : 15) && !got && !alive; i++) {
        const o = lsGet();
        if (steal || !o || o.id === TAB || Date.now() - (o.at || 0) > FRESH) got = true;
        else if (!first) first = { id: o.id, at: o.at, since: Date.now() };
        else if (o.id !== first.id || o.at !== first.at) alive = true;
        else if (Date.now() - first.since > 2600) got = true;
        if (!got && !alive) await sleep(200);
      }
    }
    if (!got) return false;
    lostFlag = false;
    await working.claim();
    if (!hasLocks()) {
      lsSet({ id: TAB, at: Date.now() });
      beat = setInterval(() => {
        const o = lsGet();
        if (o && o.id !== TAB) { lost(); return; }
        lsSet({ id: TAB, at: Date.now() });
      }, 2000);
      globalThis.addEventListener && globalThis.addEventListener('pagehide', () => { const o = lsGet(); if (o && o.id === TAB) lsSet(null); });
    }
    return true;
  }

  // Saves into the folder hold their own lock (Web Locks). A tab taken over in the instant before
  // a write lands still holds it until that write is done, so the new tab's save waits for it and
  // then sees the file as changed on disk (backing it up) instead of being overwritten after it.
  function withSaveLock(fn) {
    if (!hasLocks()) return fn();
    return navigator.locks.request('slaughter-cataloger-3-save', () => fn());
  }
  // Changes the working copy failed to store, counted outside IndexedDB (which is what failed), so
  // that reopening after a crash can say they were not kept. Cleared once a snapshot is stored.
  const UNSTORED = 'slaughter-cataloger-3-unstored';
  const unstored = {
    add() { try { const o = JSON.parse(localStorage.getItem(UNSTORED) || 'null') || { count: 0, first: Date.now() }; o.count++; o.last = Date.now(); localStorage.setItem(UNSTORED, JSON.stringify(o)); } catch (e) { /* nowhere to note it */ } },
    clear() { try { localStorage.removeItem(UNSTORED); } catch (e) { /* nothing to clear */ } },
    read() { try { return JSON.parse(localStorage.getItem(UNSTORED) || 'null'); } catch (e) { return null; } }
  };

  // ── Folder access ─────────────────────────────────────────────────────
  // __SC_TEST_FS__ is set only by the browser tests (an in-memory folder).
  const testFS = () => globalThis.__SC_TEST_FS__;
  const supportsFolders = !!testFS() || typeof globalThis.showDirectoryPicker === 'function';

  async function pickFolder() {
    if (testFS()) return testFS().root;
    return globalThis.showDirectoryPicker({ id: 'slaughter-cataloger-library', mode: 'readwrite' });
  }
  // The folder handle is kept in the same record as the working copy (session.js), so a
  // working copy is never paired with another library's folder. The test folder cannot be
  // stored; it stands in for itself.
  const storableFolder = handle => (testFS() ? null : handle);
  async function rememberedFolder(session) {
    if (testFS()) return testFS().root;
    if (session && session.folder) return session.folder;
    return idb.get('folder');                   // where earlier builds kept it
  }

  async function hasPermission(handle, ask) {
    if (!handle || !handle.queryPermission) return false;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (!ask) return false;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  // ── Reading files: bytes, strictly UTF-8, the BOM kept ────────────────
  // A file is read as bytes and decoded as UTF-8 with its byte-order mark kept as the first
  // character (csv.js notes it and writes it back), so a save keeps the file's own form. A file
  // that is not valid UTF-8 — a spreadsheet's "CSV" in a Windows code page, say — is not
  // guessed at: decoding it as UTF-8 would turn é into \uFFFD and a save would make that
  // permanent. It gets encodingError instead (records.readFile refuses it, with the reason), and
  // its text is the raw bytes one character each, so its fingerprint still tells when it changes.
  const NOT_UTF8 = 'is not UTF-8 text (it may have been saved by a spreadsheet as "CSV" in a Windows code page rather than as "CSV UTF-8"), so letters such as é would be damaged if it were read. Not loaded; save it again as CSV UTF-8 and reconnect';
  function decode(bytes) {
    try { return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), encodingError: '' }; }
    catch (e) { let raw = ''; for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return { text: raw, encodingError: NOT_UTF8 }; }
  }
  // { text, bytes (null where the file object cannot give them), encodingError, lastModified }
  async function contentOf(file) {
    if (typeof file.arrayBuffer === 'function') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return Object.assign({ bytes, lastModified: file.lastModified }, decode(bytes));
    }
    return { text: await file.text(), bytes: null, encodingError: '', lastModified: file.lastModified };   // test folders
  }
  const sameBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

  async function readFolder(handle) {
    const out = [];
    for await (const entry of handle.values()) {
      if (entry.kind !== 'file' || !/\.csv$/i.test(entry.name)) continue;
      const c = await contentOf(await entry.getFile());
      out.push({ name: entry.name, text: c.text, encodingError: c.encodingError, lastModified: c.lastModified });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  const p2 = n => String(n).padStart(2, '0');
  const stamp = d => d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const when = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  let backupDir = null;            // this session's backup folder: { handle, name, dir, label, log }
  const backedUp = new Set();      // files already backed up this session

  async function readIfExists(dir, name) {
    try { const fh = await dir.getFileHandle(name); return await contentOf(await fh.getFile()); }
    catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
  }
  // ── Backups ───────────────────────────────────────────────────────────
  // A backup, once written, is never written over:
  // - each session's copies go into a folder of their own, _backups/<date-time>-<random>, made only
  //   when no folder of that name exists (otherwise -2, -3… is added);
  // - inside it a name already taken gets -2, -3…, so two copies of one file never share a name;
  // - each copy is read back and compared with what was on disk before the file is replaced; if it
  //   cannot be made or does not match, the file is not replaced;
  // - BACKUPS.txt in the folder lists every copy: when, of which file, and why.
  const randomTag = () => {
    const a = new Uint8Array(4);
    if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (let i = 0; i < 4; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  };
  async function taken(dir, name, asDir) {
    try { if (asDir) await dir.getDirectoryHandle(name); else await dir.getFileHandle(name); return true; }
    catch (e) { if (e && e.name === 'NotFoundError') return false; if (e && e.name === 'TypeMismatchError') return true; throw e; }
  }
  async function freeName(dir, name, asDir) {
    if (!(await taken(dir, name, asDir))) return name;
    const m = /^(.*?)(\.csv)?$/i.exec(name);
    for (let k = 2; k < 10000; k++) { const n = m[1] + '-' + k + (m[2] || ''); if (!(await taken(dir, n, asDir))) return n; }
    throw new Error('no free name for ' + name);
  }
  // The session's backup folder, for this library folder. It is looked for again each time (it may
  // have been deleted, or the library may now be another folder); if it is not there, a new one is
  // made, and files are copied afresh into it before their next replacement.
  async function backupFolderFor(handle) {
    if (backupDir && backupDir.handle === handle) {
      try { const root = await handle.getDirectoryHandle('_backups'); await root.getDirectoryHandle(backupDir.name); return backupDir; }
      catch (e) { if (!e || (e.name !== 'NotFoundError' && e.name !== 'TypeMismatchError')) throw e; }
    }
    backedUp.clear();
    const root = await handle.getDirectoryHandle('_backups', { create: true });
    const name = await freeName(root, stamp(new Date()) + '-' + randomTag(), true);
    backupDir = { handle, name, dir: await root.getDirectoryHandle(name, { create: true }), label: '_backups/' + name, log: [] };
    return backupDir;
  }
  // Keep a copy of `disk` (the file `original` as it is on disk: its bytes where they can be had)
  // and check it byte for byte; returns { path, folder }. A copy that fails or does not check is
  // removed again (its name was free), so a folder never holds a bad copy under a good name.
  async function writeBackup(handle, original, disk, changedOnDisk) {
    const b = await backupFolderFor(handle);
    const wanted = changedOnDisk && backedUp.has(original) ? original.replace(/\.csv$/i, '') + '.changed-on-disk-' + stamp(new Date()) + '.csv' : original;
    const name = await freeName(b.dir, wanted);
    try {
      await writeText(b.dir, name, disk.bytes || disk.text);
      const back = await readIfExists(b.dir, name);
      const same = back && (disk.bytes && back.bytes ? sameBytes(back.bytes, disk.bytes) : back.text === disk.text);
      if (!same) throw new Error('the copy ' + b.label + '/' + name + ' did not read back the same');
    } catch (e) {
      try { if (b.dir.removeEntry) await b.dir.removeEntry(name); } catch (x) { /* leave it; BACKUPS.txt does not list it */ }
      throw e;
    }
    b.log.push(when(new Date()) + '\t' + name + '\t' + original + '\t' + (changedOnDisk ? 'changed on disk since the app read it; replaced by a save' : 'replaced by the first save of it in this session'));
    try {
      await writeText(b.dir, 'BACKUPS.txt', 'Slaughter Cataloger backups: each file here is a copy of a library file exactly as it was on disk before a save replaced it.\n' +
        'To go back to a copy, copy it into the library folder under its original name (the third column).\n\nsaved at\tcopy\toriginal file\twhy\n' + b.log.join('\n') + '\n');
    } catch (e) { if (e && e.name === 'NotOwner') throw e; /* the copy itself is in place and checked */ }
    return { path: b.label + '/' + name, folder: b.label };
  }

  const notOwnerError = () => { const x = new Error('another tab has taken over the library'); x.name = 'NotOwner'; return x; };
  // beforeClose (optional): asked just before the new text is swapped in; if it answers false the
  // write is abandoned and the file on disk is left exactly as it was.
  async function writeText(dir, name, data, beforeClose) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();       // writes to a temporary file; close() swaps it in
    const stop = () => { w.abort().catch(() => {}); };
    inflight.add(stop);                         // backups too: a tab taken over stops all its writing at once
    try {
      if (lostFlag && beforeClose) throw notOwnerError();
      await w.write(data);                      // text (written as UTF-8) or bytes
      if (beforeClose && (lostFlag || !(await beforeClose()))) throw notOwnerError();
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch (x) { /* already closed or failed */ }
      throw lostFlag ? notOwnerError() : e;
    } finally { inflight.delete(stop); }
    return (await fh.getFile()).lastModified;
  }

  /* files: [{name, text, baseline, mustExist, mustNotExist}] — baseline: the hash the app last
     read or wrote; mustExist: the file was read from the folder, so if it has gone it is not
     silently made again; mustNotExist: the file is new to the app, so a file of that name already
     in the folder (one the app did not load) is never overwritten.
     opts.stillOwner (optional, async → boolean): checked before each file and again just before
     each write is swapped in; once it answers false nothing more is written (stopped: true), so a
     tab that has been taken over cannot overwrite what the new tab saves.
     Each file is handled on its own; one failing does not stop the others.
     Returns { saved: {name: {hash, lastModified}}, already: [names that were on disk exactly as
               wanted], backups: [names], backupPaths: {name: path of its copy}, backupFolder,
               conflicts: [{name, backup}],
               missing: [names], occupied: [names], failed: [{name, error}],
               stopped: boolean, notWritten: [names not tried because the tab lost the library] } */
  async function writeFiles(handle, files, opts) {
    opts = opts || {};
    const result = { saved: {}, already: [], backups: [], backupPaths: {}, conflicts: [], missing: [], occupied: [], failed: [], backupFolder: '', stopped: false, notWritten: [] };
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (opts.stillOwner && !(await opts.stillOwner().catch(() => false))) {
        result.stopped = true;
        result.notWritten = files.slice(i).map(x => x.name);
        break;
      }
      let existed = true;
      try {
        const disk = await readIfExists(handle, f.name);
        existed = !!disk;
        const want = SC.records.hashText(f.text);
        if (!disk && f.mustExist) { result.missing.push(f.name); continue; }
        const diskHash = disk ? SC.records.hashText(disk.text) : '';
        // Already there (say, written by a save that was interrupted later): nothing to write.
        if (disk && disk.text === f.text) { result.saved[f.name] = { hash: want, lastModified: disk.lastModified }; result.already.push(f.name); continue; }
        // An empty file holds nothing to lose (say, one left by a first write that failed).
        if (disk && f.mustNotExist && disk.text !== '') { result.occupied.push(f.name); continue; }
        const changedElsewhere = !!(disk && f.baseline && diskHash !== f.baseline);
        if (disk && disk.text !== '' && (!backedUp.has(f.name) || changedElsewhere)) {
          let copy;
          try { copy = await writeBackup(handle, f.name, disk, changedElsewhere); }        // never replace a file without its copy
          catch (e) { if (e && e.name === 'NotOwner') throw e; throw new Error('its backup copy could not be made (' + ((e && e.message) || e) + '), so the file in the folder was not replaced'); }
          backedUp.add(f.name);
          result.backups.push(f.name);
          result.backupPaths[f.name] = copy.path;
          result.backupFolder = copy.folder;
          if (changedElsewhere) result.conflicts.push({ name: f.name, backup: copy.path });
        }
        const lastModified = await writeText(handle, f.name, f.text, opts.stillOwner);
        result.saved[f.name] = { hash: want, lastModified };
      } catch (e) {
        // A first write that did not happen may leave an empty file behind (the file is created
        // before it is written): take it away again, so the folder looks as it did.
        if (!existed) { try { const now = await readIfExists(handle, f.name); if (now && now.text === '' && handle.removeEntry) await handle.removeEntry(f.name); } catch (x) { /* leave it */ } }
        if (e && e.name === 'NotOwner') { result.stopped = true; result.notWritten = files.slice(i).map(x => x.name); break; }
        result.failed.push({ name: f.name, error: (e && e.message) || String(e) });
      }
    }
    return result;
  }

  // ── Fallback: picked/dropped files and downloads ──────────────────────
  async function readFileList(fileList) {
    const out = [];
    for (const file of Array.from(fileList || [])) {
      if (!/\.csv$/i.test(file.name)) continue;
      const c = await contentOf(file);
      out.push({ name: file.name, text: c.text, encodingError: c.encodingError, lastModified: file.lastModified || 0 });
    }
    return out;
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
  }

  function resetSessionBackups() { backupDir = null; backedUp.clear(); }

  SC.storage = { idb, working, takeLock, hasLocks, withSaveLock, unstored, supportsFolders, pickFolder, storableFolder, rememberedFolder, hasPermission, readFolder, writeFiles, readFileList, download, resetSessionBackups };
})(globalThis.SC = globalThis.SC || {});
