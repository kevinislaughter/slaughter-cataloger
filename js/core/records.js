/* Slaughter Cataloger 3 — reading CSV files into records, building a library
   from a set of files (with 2.x -> 3.0 migration and validation), and writing
   records back out to CSV.

   Library state shape (shared with store.js):
     { library: {slug, name, note},
       titles: Map<titleID, rec>, issues: Map<issueID, rec>, contents: Map<contentID, rec>,
       authorities: Map<authorityID, rec>,
       files: Map<fileName, {name, kind, style, extraHeaders, hash, lastModified, schemaVersion}> }
   Every record carries _src (the file it lives in) and entryOrder (its order in that file). */
(function (SC) {
  'use strict';
  const S = SC.schema, ids = SC.ids;

  // Yes/No columns. Read: Yes, Y, True, 1, X, ✓ … count as yes; No, N, False, 0, blank … as no.
  // A value written any other way than Yes/No is kept (boolRaw) and written back as it was
  // unless the field was changed, so "TRUE" or "x" in a spreadsheet survives a save.
  const YES = /^(y.*|true|t|1|x|✓|✔|checked|on)$/i, NO = /^(n|no|false|f|0|off|unchecked|-|–|—)?$/i;
  const yes = v => YES.test(String(v || '').trim());
  const plainBool = v => v === 'Yes' || v === 'No';
  const writeBool = (r, key, v) => { const raw = r.boolRaw && r.boolRaw[key]; return raw != null && yes(raw) === !!v ? raw : (v ? 'Yes' : 'No'); };
  // The map that holds records of one kind.
  const mapOfKind = (state, kind) => kind === 'title' ? state.titles : kind === 'issue' ? state.issues : kind === 'authority' ? state.authorities : state.contents;
  const splitList = v => String(v || '').split(';').map(s => s.trim()).filter(Boolean);
  const uniq = arr => Array.from(new Set(arr));

  // A file's fingerprint: how the app tells that a file changed (on disk, or since it was saved).
  // 128 bits from two differently seeded cyrb53-style passes, plus the length, so two different
  // texts sharing a fingerprint is not a practical concern (review 2, R-04; the earlier 32-bit
  // FNV-1a was weaker). Where both texts are at hand, saving compares the texts themselves.
  // Not a security hash.
  function lanes(text, seed) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
  function hashText(text) {
    return 'c2:' + lanes(text, 0) + lanes(text, 0x9e3779b9) + ':' + text.length;
  }

  // Order a list of state names by schema column order; unknown names keep their order at the end.
  function orderStates(ent, names) {
    const known = [], unknown = [];
    uniq(names).forEach(n => (ent.byHeader.has(n) && ent.byHeader.get(n).header === n ? known : unknown).push(n));
    known.sort((a, b) => ent.byHeader.get(a).order - ent.byHeader.get(b).order);
    return known.concat(unknown);
  }

  // ── Reading one file ──────────────────────────────────────────────────
  // A file with its header row and no data rows (DF-19): what the app writes when the last record
  // of a file is deleted. Read as an empty file of its kind only when asked (info.allowEmpty: the
  // app's opening and reconnecting; the tools never ask, so for them it stays "No data rows."), and
  // only when the header row is exactly that of one kind as the app writes it: every 3.0 heading
  // of that kind, in order, then at most extra columns (kept by the app from the file as first
  // read) that are no heading or alias of any kind. buildLibrary then takes it in only under this
  // library's file names (SCAT_<slug>_…). Returns the kind, or ''.
  function emptyKind(headers) {
    if (headers.some(h => !h)) return '';
    const known = new Set();
    Object.keys(S.entities).forEach(k => S.entities[k].columns.forEach(c => { known.add(c.header); (c.aliases || []).forEach(a => known.add(a)); }));
    const hits = Object.keys(S.entities).filter(k => {
      const want = S.entities[k].headers;
      return headers.length >= want.length && want.every((h, i) => headers[i] === h) && headers.slice(want.length).every(h => !known.has(h));
    });
    return hits.length === 1 ? hits[0] : '';
  }

  function readFile(name, text, info) {
    info = info || {};
    const res = { name, kind: null, ok: false, error: '', warnings: [], records: [], style: SC.csv.DEFAULT_STYLE,
      hash: hashText(text), lastModified: info.lastModified || 0, schemaVersion: '', librarySlug: '', libraryName: '', libraryNote: '', extraHeaders: [] };
    // Not UTF-8 (storage.js found out while decoding the bytes): refused, never guessed at.
    if (info.encodingError) { res.error = 'This file ' + info.encodingError + '.'; return res; }
    let parsed;
    try { parsed = SC.csv.parse(text); } catch (e) { res.error = 'Could not be read as CSV: ' + e.message; return res; }
    const rows = parsed.rows;
    res.style = parsed.style;
    if (rows.length < 1) { res.error = 'Empty file.'; return res; }
    const headers = rows[0].map(h => h.trim());
    const col = new Map();
    headers.forEach((h, i) => { if (!col.has(h)) col.set(h, i); });
    if (!col.has('Slaughter Cataloger Tool')) {
      res.error = 'Not a Slaughter Cataloger CSV (no "Slaughter Cataloger Tool" column).';
      return res;
    }
    // Rows with nothing in them carry no data; every other row is either read or kept as it is.
    const blank = r => r.every(v => String(v).trim() === '');
    const body = [];
    for (let k = 1; k < rows.length; k++) if (!blank(rows[k])) body.push({ cells: rows[k], row: k + 1 });
    // Things that would lose values if the file were written back: refuse the file, say why.
    const dupHeader = headers.find((h, i) => h && headers.indexOf(h) !== i);
    if (dupHeader) { res.error = 'Column "' + dupHeader + '" appears twice. Not loaded: rename or remove one of them, then open the folder again.'; return res; }
    for (let i = 0; i < headers.length; i++) {
      if (headers[i]) continue;
      const used = body.find(b => String(b.cells[i] || '').trim() !== '');
      if (used) { res.error = 'Column ' + (i + 1) + ' has no heading but holds values (row ' + used.row + '). Not loaded: give the column a heading, then open the folder again.'; return res; }
    }
    // Every row must have one value per column: a missing comma shifts the values after it into
    // the wrong columns, an extra one splits a value. (Empty values still need their commas.)
    const long = body.find(b => b.cells.slice(headers.length).some(v => String(v).trim() !== ''));
    if (long) { res.error = 'Row ' + long.row + ' has ' + long.cells.length + ' values but the file has ' + headers.length + ' columns (a comma inside an unquoted value?). Not loaded: correct the row, then open the folder again.'; return res; }
    const short = body.find(b => b.cells.length < headers.length);
    if (short) { res.error = 'Row ' + short.row + ' has ' + short.cells.length + ' values but the file has ' + headers.length + ' columns (a value or a comma missing?), so its values may be in the wrong columns. Not loaded: correct the row, then open the folder again.'; return res; }
    const toolOf = r => (r[col.get('Slaughter Cataloger Tool')] || '').trim();
    // The file's kind: the tool most of its rows name.
    const toolCount = new Map();
    body.forEach(b => { const t = toolOf(b.cells); if (S.kindOfTool[t]) toolCount.set(t, (toolCount.get(t) || 0) + 1); });
    const topTool = Array.from(toolCount.entries()).sort((a, b) => b[1] - a[1])[0];
    const tool = topTool ? topTool[0] : (body.length ? toolOf(body[0].cells) : '');
    const kind = S.kindOfTool[tool];
    if (!kind && !body.length && info.allowEmpty) {
      const ek = emptyKind(headers);
      if (!ek) { res.error = 'No data rows. Its header row is not exactly that of a Slaughter Cataloger 3.0 file, so it is not read as an empty one.'; return res; }
      const ent = S.entities[ek];
      Object.assign(res, { kind: ek, ok: true, empty: true, schemaVersion: S.VERSION, extraHeaders: headers.slice(ent.headers.length),
        presentKeys: ent.columns.filter(c => c.key).map(c => c.key), setAside: [], cellsOf: () => ({}) });
      return res;
    }
    if (!kind) { res.error = tool ? 'Unknown tool "' + tool + '".' : 'No data rows.'; return res; }
    res.kind = kind;
    const ent = S.entities[kind];
    // Two columns for one field (e.g. "Authorized Form" and "AuthorizedForm"): one would be lost.
    for (const c of ent.columns) {
      const names = [c.header].concat(c.aliases || []).filter(h => col.has(h));
      if (names.length > 1) { res.error = 'Columns "' + names.join('" and "') + '" are the same field. Not loaded: keep one of them, then open the folder again.'; return res; }
    }

    const get = (r, c) => {
      let i = col.get(c.header);
      if (i === undefined && c.aliases) for (const a of c.aliases) { if (col.has(a)) { i = col.get(a); break; } }
      return i === undefined ? '' : (r[i] === undefined ? '' : r[i]);
    };
    const meta = m => ent.columns.find(c => c.meta === m);
    const metaVal = (r, m) => { const c = meta(m); return c ? get(r, c).trim() : ''; };

    // The app reads 3.0 only. Beta 2 files go through tools/convert-to-3.js once (info.legacy).
    const versions = Array.from(new Set(body.map(b => S.normalizeVersion(metaVal(b.cells, 'schema') || '2.0'))));
    res.schemaVersion = versions.slice().sort().pop();
    const allowed = info.legacy ? [S.VERSION].concat(S.LEGACY_VERSIONS) : [S.VERSION];
    const bad = versions.filter(v => allowed.indexOf(v) === -1);
    if (bad.length) {
      res.needsConversion = !info.legacy && bad.every(v => S.LEGACY_VERSIONS.indexOf(v) !== -1);
      res.error = res.needsConversion ? 'Beta 2 (schema 2.0) file. Convert it to 3.0 before opening it here.' : 'Unsupported schema version ' + bad.join(', ') + '.';
      return res;
    }

    // The file's library: the slug most of its rows name (rows with none belong to it too).
    const slugCount = new Map();
    body.forEach(b => { const sl = metaVal(b.cells, 'librarySlug').toUpperCase(); if (sl) slugCount.set(sl, (slugCount.get(sl) || 0) + 1); });
    res.librarySlug = Array.from(slugCount.entries()).sort((a, b) => b[1] - a[1])[0];
    res.librarySlug = res.librarySlug ? res.librarySlug[0] : '';
    const first = (body.find(b => metaVal(b.cells, 'librarySlug').toUpperCase() === res.librarySlug) || body[0]).cells;
    res.libraryName = metaVal(first, 'libraryName');
    res.libraryNote = metaVal(first, 'libraryNote');

    // A row the app cannot take in is kept exactly as it is, and written back with the file
    // (at its end), so saving never drops it. Its cells are keyed by the column names the file
    // will be written with.
    const canonical = headers.map(h => { const c = ent.columns.find(x => x.header === h || (x.aliases || []).indexOf(h) !== -1); return c ? c.header : h; });
    const cellsOf = r => { const o = {}; canonical.forEach((h, i) => { if (h && r[i] !== undefined && r[i] !== '') o[h] = r[i]; }); return o; };
    res.setAside = [];
    res.cellsOf = cellsOf;
    const keepRow = (r, row, reason) => res.setAside.push({ row, reason, cells: cellsOf(r) });
    const takeIn = body.filter(b => {
      const t = toolOf(b.cells);
      if (t !== tool) { keepRow(b.cells, b.row, 'a "' + (t || 'blank') + '" row in a ' + tool + ' file'); return false; }
      const sl = metaVal(b.cells, 'librarySlug').toUpperCase();
      if (sl && res.librarySlug && sl !== res.librarySlug) { keepRow(b.cells, b.row, 'belongs to library ' + sl + ', not ' + res.librarySlug); return false; }
      return true;
    });

    // Columns this schema does not know are kept, untouched, and written back.
    const known = new Set();
    ent.columns.forEach(c => { known.add(c.header); (c.aliases || []).forEach(a => known.add(a)); });
    // Which fields this file actually has (older files lack some columns).
    res.presentKeys = ent.columns.filter(c => c.key && (col.has(c.header) || (c.aliases || []).some(a => col.has(a)))).map(c => c.key);
    res.extraHeaders = headers.filter(h => h && !known.has(h));

    const oddBool = [];
    const present = c => col.has(c.header) || (c.aliases || []).some(a => col.has(a));
    takeIn.forEach(b => {
      const r = b.cells;
      const rec = { _src: name, _row: b.row, _cells: r };
      ent.columns.forEach(c => {
        if (!c.key) return;
        const v = get(r, c);
        if (c.type === 'bool') {
          rec[c.key] = yes(v);
          if (!plainBool(v) && present(c)) { (rec.boolRaw = rec.boolRaw || {})[c.key] = v; if (!NO.test(String(v).trim()) && !YES.test(String(v).trim())) oddBool.push('row ' + b.row + ' ' + c.header + ' "' + v + '"'); }
        } else rec[c.key] = c.type === 'id' ? v.trim() : v;
      });
      [['speculative', 'speculative'], ['firstYearSpeculative', 'firstYearSpeculative']].forEach(([m, k]) => {
        if (!meta(m) || !present(meta(m))) return;
        const v = get(r, meta(m));
        if (!plainBool(v)) { (rec.boolRaw = rec.boolRaw || {})[k] = v; if (!NO.test(String(v).trim()) && !YES.test(String(v).trim())) oddBool.push('row ' + b.row + ' ' + meta(m).header + ' "' + v + '"'); }
      });
      rec.speculative = yes(metaVal(r, 'speculative'));
      rec.spec = splitList(metaVal(r, 'spec')).map(ent.canonicalState);
      rec.na = splitList(metaVal(r, 'na')).map(ent.canonicalState);
      const eo = parseInt(metaVal(r, 'entryOrder'), 10);
      rec.entryOrder = eo > 0 ? eo : null;
      if (kind === 'title') {
        if (yes(metaVal(r, 'firstYearSpeculative')) && rec.spec.indexOf('First Year of Publication (CE)') === -1) rec.spec.push('First Year of Publication (CE)');
        rec.titleCode = rec.titleCode.trim().toUpperCase();
        rec.firstYear = rec.firstYear.trim().toUpperCase();
        rec.titleID = rec.titleID.toUpperCase() || ids.titleIDOf(rec.titleCode, rec.firstYear);
      }
      if (kind === 'issue') {
        const listed = splitList(metaVal(r, 'overrides'));
        const keyOf = h => { const c = ent.byHeader.get(ent.canonicalState(h)); return c && S.INHERIT[c.key] ? c.key : ''; };
        rec.overrides = listed.map(keyOf).filter(Boolean);
        // Names that are not inheritable fields are not used, but kept and written back.
        const kept = listed.filter(h => !keyOf(h));
        if (kept.length) rec.overridesKept = kept;
        if (!rec.dateType) rec.dateType = /spring|summer|fall|autumn|winter/i.test(rec.months) ? 'Season' : 'Months';
      }
      if (kind === 'content') {
        rec.titleID = metaVal(r, 'titleID');
        rec.issueRef = metaVal(r, 'issueRef');
        rec.parentID = metaVal(r, 'parentID');
      }
      rec.spec = orderStates(ent, rec.spec);
      rec.na = orderStates(ent, rec.na);
      if (res.extraHeaders.length) {
        rec.extra = {};
        res.extraHeaders.forEach(h => { rec.extra[h] = r[col.get(h)] === undefined ? '' : r[col.get(h)]; });
      }
      res.records.push(rec);
    });
    if (oddBool.length) res.warnings.push(oddBool.length + ' Yes/No value(s) written neither way (read as No, and kept as written unless changed): ' + oddBool.slice(0, 5).join('; ') + (oddBool.length > 5 ? '; …' : '') + '.');
    res.ok = true;
    return res;
  }

  // ── Building a library from many files ────────────────────────────────
  // Beta 2 backups were named …_BACKUP_<date-time>.csv (a slug may be BACKUP itself, so a digit must follow).
  const isBackupName = n => /_BACKUP_\d/i.test(n) || /^\./.test(n) || !/\.csv$/i.test(n);

  function buildLibrary(fileResults, opts) {
    opts = opts || {};
    const report = [];
    const note = (level, file, msg) => report.push({ level, file: file || '', msg });
    const lib = { library: { slug: '', name: '', note: '' }, titles: new Map(), issues: new Map(), contents: new Map(), authorities: new Map(), files: new Map() };

    const changedOnLoad = new Set();
    const usable = [];
    fileResults.forEach(f => {
      if (isBackupName(f.name)) return;
      if (!f.ok) { note('skip', f.name, f.error); return; }
      f.warnings.forEach(w => note('warn', f.name, w));
      if (!f.setAside) f.setAside = [];
      usable.push(f);
    });
    // A record that cannot be taken in: its row is kept exactly as read and written back with its file.
    const keep = (f, r, reason) => { f.setAside.push({ row: r._row, reason, cells: f.cellsOf ? f.cellsOf(r._cells || []) : {} }); };

    // Which library is this? The Titles file decides; otherwise the most common slug.
    const titleFiles = usable.filter(f => f.kind === 'title');
    // Newest first — but files already in the working copy (opts.pinned, on a reconnect) come
    // before any file that has just appeared, so a copy dropped into the folder (a sync service's
    // "conflicted copy", say) never quietly replaces what was loaded.
    const pinned = opts.pinned || new Set();
    // An empty file (DF-19, read only when the app asks) never comes before one with rows: an empty
    // Titles or Authorities file can never stand in for the library's own.
    const newestFirst = (a, b) => ((pinned.has(b.name) ? 1 : 0) - (pinned.has(a.name) ? 1 : 0)) || ((a.empty ? 1 : 0) - (b.empty ? 1 : 0)) ||
      (b.lastModified - a.lastModified) || (b.records.length - a.records.length) || a.name.localeCompare(b.name);
    let slug = opts.slug || '';
    if (!slug && titleFiles.length) slug = titleFiles.slice().sort(newestFirst)[0].librarySlug;
    if (!slug) {
      const count = {};
      usable.forEach(f => { if (f.librarySlug) count[f.librarySlug] = (count[f.librarySlug] || 0) + f.records.length; });
      slug = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
    }
    lib.library.slug = slug;
    const inLibrary = usable.filter(f => {
      if (f.librarySlug && slug && f.librarySlug !== slug) { note('skip', f.name, 'Belongs to library ' + f.librarySlug + ', not ' + slug + '. Not loaded.'); return false; }
      // An empty file names no library: it is taken in only under one of this library's names,
      // when files with rows have said which library this is.
      if (f.empty) {
        const prefix = 'SCAT_' + (ids.safeFilePart(slug) || '') + '_';
        if (!slug || f.name.toUpperCase().indexOf(prefix.toUpperCase()) !== 0) {
          note('skip', f.name, 'No data rows, and ' + (slug ? 'its name is not one of this library\'s (' + prefix + '…)' : 'no file with rows says which library it belongs to') + '. Not loaded.');
          return false;
        }
      }
      return true;
    });

    // Several versions of the same data (dated exports, copies): newest wins.
    const accepted = { title: [], issue: [], content: [], authority: [] };
    const keySets = new Map();
    const keysOf = f => {
      if (!keySets.has(f.name)) keySets.set(f.name, new Set(f.records.map(r => f.kind === 'title' ? r.titleID : f.kind === 'authority' ? r.authorityID : r.issueID).filter(Boolean)));
      return keySets.get(f.name);
    };
    ['title', 'issue', 'content', 'authority'].forEach(kind => {
      inLibrary.filter(f => f.kind === kind).sort(newestFirst).forEach(f => {
        // One Titles file and one Authorities file per library: the newest.
        if ((kind === 'title' || kind === 'authority') && accepted[kind].length) {
          const kept = accepted[kind][0].name;
          if (f.empty) { note('skip', f.name, 'No data rows, and ' + kept + ' is the ' + (kind === 'title' ? 'Titles' : 'Authorities') + ' file in use. Not loaded.'); return; }
          if (pinned.has(kept)) note('warn', f.name, 'A second ' + (kind === 'title' ? 'Titles' : 'Authorities') + ' file has appeared in the folder; ' + kept + ' is the one in use. Not loaded.');
          else note('skip', f.name, 'Another ' + (kind === 'title' ? 'Titles' : 'Authorities') + ' file is newer (' + kept + '). Not loaded.');
          return;
        }
        const clash = accepted[kind].find(a => { const k = keysOf(a); for (const x of keysOf(f)) if (k.has(x)) return true; return false; });
        if (clash && pinned.has(clash.name)) { note('warn', f.name, 'Has appeared in the folder with records already loaded from ' + clash.name + ' (a copy?). Not loaded; ' + clash.name + ' is kept.'); return; }
        if (clash) { note('skip', f.name, 'Older copy of data in ' + clash.name + '. Not loaded.'); return; }
        accepted[kind].push(f);
      });
    });

    const titleFile = accepted.title[0];
    if (titleFile) {
      lib.library.name = titleFile.libraryName;
      lib.library.note = titleFile.libraryNote;
    } else {
      const any = accepted.issue[0] || accepted.content[0];
      lib.library.name = any ? any.libraryName : '';
      if (accepted.issue.length || accepted.content.length) note('warn', '', 'No Titles file found. Issues and contents are shown, but titles cannot be edited until a Titles CSV is added.');
    }

    accepted.title.concat(accepted.issue, accepted.content, accepted.authority).forEach(f => {
      lib.files.set(f.name, { name: f.name, kind: f.kind, style: f.style, extraHeaders: f.extraHeaders, hash: f.hash, lastModified: f.lastModified, schemaVersion: f.schemaVersion, setAside: f.setAside });
      if (normalizeEntryOrder(f.records)) note('info', f.name, 'Entry Order numbers were missing or repeated; rows are numbered in the order they appear in the file.');
      if (f.extraHeaders.length) note('info', f.name, 'Extra columns kept as they are: ' + f.extraHeaders.join(', ') + '.');
      if (f.empty) note('info', f.name, 'No rows yet: an empty ' + { title: 'Titles', issue: 'Issues', content: 'Contents', authority: 'Authorities' }[f.kind] + ' file (its last record was deleted). It is kept, and new records can be saved into it.');

    });

    // Titles
    accepted.title.forEach(f => f.records.forEach(r => {
      if (!ids.RE.titleID.test(r.titleID)) note('warn', f.name, 'Row ' + r._row + ': TitleID "' + r.titleID + '" is not in the expected format.');
      if (!r.titleID) { keep(f, r, 'no TitleID (and no Title Code and First Year to make one)'); return; }
      if (lib.titles.has(r.titleID)) { keep(f, r, 'TitleID ' + r.titleID + ' is already used by an earlier row'); return; }
      lib.titles.set(r.titleID, finishTitle(r));
    }));

    // Issues (title-level fields become inherited unless they differ)
    const orphanIssues = {}, oddIDs = {};
    let mintedIssues = 0;
    accepted.issue.forEach(f => f.records.forEach(r => {
      if (!r.issueID && r.titleID && ids.RE.titleID.test(r.titleID)) { r.issueID = ids.newIssueID(r.titleID, x => lib.issues.has(x)); mintedIssues++; changedOnLoad.add(f.name); }
      if (!r.issueID) { keep(f, r, 'no IssueID, and no TitleID to make one from'); return; }
      if (!ids.RE.issueID.test(r.issueID)) (oddIDs[f.name] = oddIDs[f.name] || []).push(r.issueID);
      if (r.titleID && r.issueID.indexOf(r.titleID + '-') !== 0) note('warn', f.name, 'Row ' + r._row + ': IssueID ' + r.issueID + ' does not begin with its TitleID ' + r.titleID + '.');
      if (lib.issues.has(r.issueID)) { keep(f, r, 'IssueID ' + r.issueID + ' is already used by an earlier row'); return; }
      if (!r.titleID) r.titleID = ids.titleIDFromChild(r.issueID);
      const t = lib.titles.get(r.titleID);
      if (!t) orphanIssues[r.titleID] = (orphanIssues[r.titleID] || 0) + 1;
      lib.issues.set(r.issueID, finishIssue(r, t));
    }));
    if (mintedIssues) note('warn', '', mintedIssues + ' issue(s) had no IssueID and were given one; save to keep them.');
    Object.keys(orphanIssues).forEach(tid => note('warn', '', orphanIssues[tid] + ' issue(s) belong to ' + (tid || '(no TitleID)') + ', which is not in the Titles file.'));
    // IDs made outside the app may use another code pattern; they still work and are never rewritten.
    if (opts.legacy) Object.keys(oddIDs).forEach(fn => note('info', fn, oddIDs[fn].length + ' IssueID(s) use a different code pattern from the one the app generates (e.g. ' + oddIDs[fn][0] + '). They are kept exactly as they are.'));

    // Contents: assign ContentIDs, link parents
    const orphanContents = {};
    const existing = id => lib.contents.has(id);
    let minted = 0;
    accepted.content.forEach(f => {
      f.records.forEach(r => {
        if (r.contentID && lib.contents.has(r.contentID)) { keep(f, r, 'ContentID ' + r.contentID + ' is already used by an earlier row'); return; }
        const iss = lib.issues.get(r.issueID);
        if (!r.issueID) note('warn', f.name, 'Row ' + r._row + ': no IssueID.');
        else if (!iss) orphanContents[r.issueID] = (orphanContents[r.issueID] || 0) + 1;
        if (iss && r.titleID && r.titleID !== iss.titleID) note('warn', f.name, 'Row ' + r._row + ': TitleID ' + r.titleID + ' does not match its issue (' + iss.titleID + ').');
        const tid = (iss && iss.titleID) || r.titleID || ids.titleIDFromChild(r.issueID) || 'UNKNOWNX-XXXX';
        if (!r.contentID) { r.contentID = ids.newContentID(tid, existing); minted++; changedOnLoad.add(f.name); }
        lib.contents.set(r.contentID, r);
      });
    });
    if (minted) note(opts.legacy ? 'info' : 'warn', '', minted + ' contents item(s) had no ContentID and were given one' + (opts.legacy ? '.' : '; save to keep them.'));
    const orphanIDs = Object.keys(orphanContents);
    if (orphanIDs.length) {
      const n = orphanIDs.reduce((a, k) => a + orphanContents[k], 0);
      note('warn', '', n + ' contents item(s) belong to ' + orphanIDs.length + ' issue(s) not found in any Issues file: ' + orphanIDs.sort().join(', ') + '.');
    }
    linkParents(lib, note, changedOnLoad);

    // Name headings
    accepted.authority.forEach(f => f.records.forEach(r => {
      if (r.authorityID && lib.authorities.has(r.authorityID)) { keep(f, r, 'AuthorityID ' + r.authorityID + ' is already used by an earlier row'); return; }
      if (!r.authorityID) { r.authorityID = ids.newAuthorityID(x => lib.authorities.has(x)); changedOnLoad.add(f.name); }
      lib.authorities.set(r.authorityID, freezeRec(r));
    }));
    lib.contents.forEach((r, id) => lib.contents.set(id, freezeRec(r)));
    // Rows kept as they are: say which, why, and what to do.
    accepted.title.concat(accepted.issue, accepted.content, accepted.authority).forEach(f => {
      if (!f.setAside.length) return;
      const list = f.setAside.slice(0, 5).map(x => 'row ' + x.row + ' (' + x.reason + ')').join('; ') + (f.setAside.length > 5 ? '; and ' + (f.setAside.length - 5) + ' more' : '');
      note('warn', f.name, f.setAside.length + ' row(s) not loaded and kept unchanged in the file (saving writes them back at the end): ' + list + '. To use such a row, correct it in the file — for a repeated ID, clear the ID cell and the app gives the row a new one — then open the folder again.');
    });
    const setAside = [];
    lib.files.forEach(m => { if (m.setAside && m.setAside.length) setAside.push({ file: m.name, rows: m.setAside.length }); });
    const needsConversion = report.filter(r => r.level === 'skip' && /Convert it to 3\.0/.test(r.msg)).map(r => r.file);

    return { state: lib, report, changed: Array.from(changedOnLoad), needsConversion, setAside };
  }

  // Entry Order is kept when it is a clean 1..n; when numbers are missing or repeated
  // (a row added by hand, say), the order of rows in the file decides.
  function normalizeEntryOrder(records) {
    const seen = new Set();
    const ok = records.every(r => r.entryOrder && !seen.has(r.entryOrder) && seen.add(r.entryOrder));
    if (ok) return false;
    records.slice().sort((a, b) => (a._row || 0) - (b._row || 0)).forEach((r, i) => { r.entryOrder = i + 1; });
    return true;
  }

  function freezeRec(r) {
    delete r._row; delete r._cells;
    ['spec', 'na', 'overrides'].forEach(k => { if (r[k]) Object.freeze(r[k]); });
    if (r.extra) Object.freeze(r.extra);
    if (r.boolRaw) Object.freeze(r.boolRaw);
    if (r.overridesKept) Object.freeze(r.overridesKept);
    return Object.freeze(r);
  }

  function finishTitle(r) { return freezeRec(r); }

  // Decide which title-level fields this issue overrides.
  // Without its title (no Titles file, or the title is not in it) nothing can be compared: the
  // issue keeps every value it has, and Overridden Fields stays exactly as the file has it, so
  // saving the Issues file then changes neither. Once the title is there, the usual rule applies.
  function resolveOverrides(r, title) {
    const ent = S.entities.issue;
    const listed = new Set(r.overrides || []);
    const ov = [];
    Object.keys(S.INHERIT).forEach(k => {
      const header = ent.byKey.get(k).header;
      const own = String(r[k] || '').trim();
      const inherited = title ? String(title[S.INHERIT[k]] || '').trim() : '';
      const isNA = r.na.indexOf(header) !== -1;
      if (listed.has(k) || isNA || (title && own !== '' && own !== inherited)) ov.push(k);
    });
    r.overrides = ov;
    if (title) Object.keys(S.INHERIT).forEach(k => { if (ov.indexOf(k) === -1) r[k] = ''; });
    return r;
  }
  function finishIssue(r, title) { return freezeRec(resolveOverrides(r, title)); }
  // When a title turns up for issues that were read without it (it is added in Library), they are
  // settled exactly as reading the files again would settle them: values that differ from the
  // title's become overrides, values equal to it are inherited. Returns the changed issue records.
  function settleIssues(state, title) {
    const out = [];
    state.issues.forEach(i => {
      if (i.titleID !== title.titleID) return;
      const r = resolveOverrides(Object.assign({}, i, { spec: i.spec.slice(), na: i.na.slice(), overrides: (i.overrides || []).slice() }), title);
      const same = r.overrides.join() === (i.overrides || []).join() && Object.keys(S.INHERIT).every(k => (r[k] || '') === (i[k] || ''));
      if (!same) out.push(r);
    });
    return out;
  }

  // Parent links. A Parent ContentID must name another item of the same issue, and parents
  // must not loop (A in B in A). A link that breaks these rules is not used — the item shows
  // at the top level — but its value is kept (parentKept) and written back unchanged, and the
  // load report names it. Only items with no Parent ContentID are matched by Parent Item text
  // to an item title in the same issue (nearest earlier item when the title repeats).
  function linkParents(lib, note, changedOnLoad) {
    const byIssue = new Map();
    lib.contents.forEach(c => { if (!byIssue.has(c.issueID)) byIssue.set(c.issueID, []); byIssue.get(c.issueID).push(c); });
    let linked = 0, unresolved = 0, renamed = 0;
    const broken = [];
    const seqNum = c => { const n = parseFloat(c.sequence); return isNaN(n) ? Infinity : n; };
    // Items in the order the issue lists them (as the Contents stage and outputs show them).
    const pos = new Map();
    byIssue.forEach(list => list.slice().sort((a, b) => (seqNum(a) - seqNum(b)) || ((a.entryOrder || 1e9) - (b.entryOrder || 1e9))).forEach((c, k) => pos.set(c, k)));
    const breakLink = (c, why) => { c.parentKept = c.parentID; c.parentID = ''; broken.push({ c, why }); };
    lib.contents.forEach(c => {
      if (c.parentID) {
        const p = lib.contents.get(c.parentID);
        if (!p) breakLink(c, 'is not in any contents file');
        else if (p === c) breakLink(c, 'is the item itself');
        else if (p.issueID !== c.issueID) breakLink(c, 'belongs to another issue (' + p.issueID + ')');
        else if (pos.get(p) > pos.get(c)) breakLink(c, 'comes after the item in the issue (a part must follow what it is part of)');
        return;
      }
      if (c.parentKept) return;           // a link already found unusable stays as it is
      const text = String(c.parentItem || '').trim();
      if (!text || /^n\/?a$/i.test(text)) return;
      const sibs = byIssue.get(c.issueID) || [];
      const want = text.toLowerCase();
      const earlier = s => s !== c && pos.get(s) < pos.get(c);
      let cands = sibs.filter(s => earlier(s) && String(s.itemTitle || '').trim().toLowerCase() === want);
      if (!cands.length && /^\d+$/.test(text)) cands = sibs.filter(s => earlier(s) && String(s.sequence).trim() === text);
      if (!cands.length) { unresolved++; return; }
      let pick = cands[0];
      if (cands.length > 1) {
        const before = cands.filter(s => seqNum(s) < seqNum(c)).sort((a, b) => seqNum(b) - seqNum(a));
        pick = before[0] || cands[0];
      }
      c.parentID = pick.contentID;
      // Parent Item names the parent by its title (it may have been given as a sequence number).
      if (pick.itemTitle && c.parentItem !== pick.itemTitle) { c.parentItem = pick.itemTitle; renamed++; }
      if (changedOnLoad) changedOnLoad.add(c._src);
      linked++;
    });
    // Loops: every item on a loop goes to the top level, its link kept.
    const onLoop = [];
    lib.contents.forEach(c => {
      const seen = new Set([c]);
      let x = c;
      while (x.parentID && lib.contents.has(x.parentID)) {
        x = lib.contents.get(x.parentID);
        if (x === c) { onLoop.push(c); break; }
        if (seen.has(x)) break;
        seen.add(x);
      }
    });
    onLoop.forEach(c => breakLink(c, 'makes the items each other\'s parents'));
    if (linked) note('info', '', linked + ' nested contents item(s) linked to their parent item.');
    if (renamed) note('info', '', renamed + ' Parent Item value(s) given as a sequence number or in different capitalization now name the parent item exactly (e.g. "2" becomes the title of item 2). The link is kept in Parent ContentID.');
    if (unresolved) note('info', '', unresolved + ' Parent Item value(s) do not match any item in the same issue; kept as text.');
    const byFile = new Map();
    broken.forEach(b => { if (!byFile.has(b.c._src)) byFile.set(b.c._src, []); byFile.get(b.c._src).push(b); });
    byFile.forEach((list, file) => note('warn', file, list.length + ' item(s) with a Parent ContentID that cannot be used are shown at the top level; the value is kept in the file: ' +
      list.slice(0, 5).map(b => 'row ' + b.c._row + ' (' + b.c.parentKept + ' ' + b.why + ')').join('; ') + (list.length > 5 ? '; and ' + (list.length - 5) + ' more' : '') + '. Nesting the item in the Contents stage replaces it.'));
  }

  // ── Effective values (inheritance) ────────────────────────────────────
  // An issue takes a title-level field from its title only when it does not override it AND has
  // no value of its own for it. Issues read with their title hold no own value for inherited
  // fields (finishIssue clears them), so this is the usual rule; but an issue read while its
  // title was missing keeps its values, and they must never give way to the title's when the
  // title turns up (added in Library, or its file read again) — that would blank them on saving.
  function inherits(issue, title, key) {
    return !!(title && S.INHERIT[key] && (issue.overrides || []).indexOf(key) === -1 && String(issue[key] == null ? '' : issue[key]).trim() === '');
  }
  function effective(issue, title, key) {
    if (!inherits(issue, title, key)) return issue[key] == null ? '' : issue[key];
    const tk = S.INHERIT[key];
    return title[tk] == null ? '' : title[tk];
  }

  // ── File naming ───────────────────────────────────────────────────────
  function defaultFileName(kind, slug, titleID) {
    const s = ids.safeFilePart(slug) || 'LIBRARY';
    if (kind === 'title') return 'SCAT_' + s + '_TITLES.csv';
    if (kind === 'authority') return 'SCAT_' + s + '_AUTHORITIES.csv';
    return 'SCAT_' + s + '_' + ids.safeFilePart(titleID) + (kind === 'issue' ? '_ISSUES.csv' : '_CONTENTS.csv');
  }

  // ── Writing one file ──────────────────────────────────────────────────
  function rowsForFile(state, fileName) {
    const f = state.files.get(fileName);
    const kind = f ? f.kind : null;
    if (!kind) throw new Error('Unknown file ' + fileName);
    const ent = S.entities[kind];
    const map = mapOfKind(state, kind);
    const recs = [];
    map.forEach(r => { if (r._src === fileName) recs.push(r); });
    recs.sort((a, b) => ((a.entryOrder || 1e9) - (b.entryOrder || 1e9)) || String(a[idKey(kind)]).localeCompare(String(b[idKey(kind)])));
    const extra = (f.extraHeaders || []).slice();
    recs.forEach(r => { if (r.extra) Object.keys(r.extra).forEach(h => { if (extra.indexOf(h) === -1) extra.push(h); }); });
    const lib = state.library;
    const out = [ent.headers.concat(extra)];
    const fileOf = (k, tid) => {
      const m = k === 'issue' ? state.issues : state.contents;
      for (const r of m.values()) if ((k === 'issue' ? r.titleID : titleOfContent(state, r)) === tid) return r._src;
      return defaultFileName(k, lib.slug, tid);
    };
    recs.forEach(r => {
      const title = kind === 'issue' ? state.titles.get(r.titleID) : null;
      const issue = kind === 'content' ? state.issues.get(r.issueID) : null;
      const row = ent.columns.map(c => {
        if (c.key) {
          const v = kind === 'issue' ? effective(r, title, c.key) : r[c.key];
          if (c.type === 'bool') return writeBool(r, c.key, v);
          return v == null ? '' : String(v);
        }
        switch (c.meta) {
          case 'tool': return ent.tool;
          case 'schema': return S.VERSION;
          case 'librarySlug': return lib.slug;
          case 'libraryName': return lib.name;
          case 'libraryNote': return lib.note;
          case 'entryOrder': return r.entryOrder == null ? '' : String(r.entryOrder);
          case 'speculative': return writeBool(r, 'speculative', r.speculative);
          case 'spec': return (r.spec || []).join('; ');
          case 'na': return (r.na || []).join('; ');
          case 'firstYearSpeculative': return writeBool(r, 'firstYearSpeculative', (r.spec || []).indexOf('First Year of Publication (CE)') !== -1);
          case 'expectedIssuesFile': return fileOf('issue', r.titleID);
          case 'expectedContentsFile': return fileOf('content', r.titleID);
          case 'titleCode': return title ? title.titleCode : (r.titleID || '').split('-')[0];
          case 'firstYear': return title ? title.firstYear : (r.titleID || '').split('-')[1] || '';
          case 'overrides': return uniq((r.overrides || []).map(k => ent.byKey.get(k).header).concat(r.overridesKept || [])).join('; ');
          case 'titleID': return titleOfContent(state, r);
          case 'issueRef': return issue ? (issue.shortname || r.issueRef || '') : (r.issueRef || '');
          case 'parentID': return r.parentID && state.contents.has(r.parentID) ? r.parentID : (r.parentKept || '');
          default: return '';
        }
      });
      if (kind === 'content' && r.parentID && state.contents.has(r.parentID)) {
        row[ent.columns.findIndex(c => c.key === 'parentItem')] = state.contents.get(r.parentID).itemTitle || r.parentItem || '';
      }
      extra.forEach(h => row.push(r.extra && r.extra[h] != null ? r.extra[h] : ''));
      out.push(row);
    });
    // Rows that were not taken in go back exactly as they were read, after the records.
    (f.setAside || []).forEach(x => {
      Object.keys(x.cells).forEach(h => { if (out[0].indexOf(h) === -1) out[0].push(h); });
    });
    (f.setAside || []).forEach(x => out.push(out[0].map(h => x.cells[h] == null ? '' : x.cells[h])));
    if (f.setAside && f.setAside.length) for (let k = 1; k < out.length; k++) while (out[k].length < out[0].length) out[k].push('');
    return out;
  }

  function titleOfContent(state, c) {
    const iss = state.issues.get(c.issueID);
    return iss ? iss.titleID : (c.titleID || ids.titleIDFromChild(c.issueID));
  }

  function writeFile(state, fileName) {
    const f = state.files.get(fileName);
    return SC.csv.serialize(rowsForFile(state, fileName), f && f.style);
  }

  const idKey = kind => kind === 'title' ? 'titleID' : kind === 'issue' ? 'issueID' : kind === 'authority' ? 'authorityID' : 'contentID';

  SC.records = { mapOfKind, normalizeEntryOrder, readFile, buildLibrary, writeFile, rowsForFile, effective, inherits, settleIssues, defaultFileName, hashText, idKey, titleOfContent, orderStates, freezeRec };
})(globalThis.SC = globalThis.SC || {});
