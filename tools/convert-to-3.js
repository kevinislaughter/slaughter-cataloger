#!/usr/bin/env node
/* One-time conversion of Slaughter Cataloger Beta 2 (schema 2.0) CSVs to 3.0.

   usage: node tools/convert-to-3.js <input folder or files...> --out <output folder>

   - Reads every SCAT CSV under the inputs (skipping folders that start with _ or .).
   - Groups files by Title Library Slug; each library is converted into <out>/<SLUG>/.
   - Merges duplicate and dated copies record by record: the newest file's version of a
     record wins; records found only in older copies are kept; every difference is reported.
   - Writes one Titles file per library and one Issues and one Contents file per title,
     named SCAT_<SLUG>_TITLES.csv, SCAT_<SLUG>_<TITLEID>_ISSUES.csv, SCAT_<SLUG>_<TITLEID>_CONTENTS.csv.
   - Assigns ContentIDs, links nested contents, records which issue fields differ from the title.
   - Verifies by reading the output back with the app's own (3.0-only) reader.
   - Name authority lists from Beta 2 (AUTHORITY_<TitleID>.csv: AuthorizedForm, Type, Count,
     VariantForms, Roles, Honorifics, Notes, Status) become the library's SCAT_<SLUG>_AUTHORITIES.csv.
   - Writes CONVERSION-REPORT.md next to the files. Input files are never modified.

   Safety (A3 batch 1):
   - --out must be a folder that does not exist yet, outside every input folder (and outside the
     folder of every input file), compared after resolving links. The converted libraries are
     written into a temporary folder beside it, read back and checked there, and only then renamed
     to --out. If anything fails, nothing appears at --out.
   - Every CSV is read strictly as UTF-8 (a byte-order mark is kept, as the app keeps it). A file that
     is not UTF-8, or a Slaughter Cataloger CSV that cannot be read as it stands (a quote never
     closed, a column twice, a row with too many or too few values, an unknown schema version),
     stops the conversion: nothing is written, and each such file is named.
   - Everything under the inputs that is not converted (other files, folders whose names start with
     _ or ., CSVs that are not Slaughter Cataloger files, authority lists of no library) is listed,
     on screen and in each CONVERSION-REPORT.md. It stays where it is.

   Exit status: 0 = converted; 1 = refused or not verified (nothing written); 2 = usage or unreadable input. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
['js/core/csv.js', 'js/core/ids.js', 'js/core/schema.js', 'js/core/records.js', 'js/core/store.js', 'js/core/names.js'].forEach(f => require(path.join(ROOT, f)));
const SC = globalThis.SC, R = SC.records, S = SC.schema;
const so = require('./lib/safe-output');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
if (outIdx === -1 || !args[outIdx + 1]) { console.error('usage: convert-to-3.js <inputs...> --out <folder>'); process.exit(2); }
const OUT = path.resolve(args[outIdx + 1]);
const inputs = args.filter((a, i) => i !== outIdx && i !== outIdx + 1);
if (!inputs.length) { console.error('usage: convert-to-3.js <inputs...> --out <folder>'); process.exit(2); }
const inputStat = p => { try { return fs.statSync(p); } catch (e) { console.error('NOT WRITTEN: ' + p + ' cannot be read (' + e.code + ').'); process.exit(2); } };
const roots = inputs.map(p => path.resolve(p)).map(p => inputStat(p).isDirectory() ? p : path.dirname(p));
try { so.checkOutput(OUT, roots); } catch (e) { if (e instanceof so.SafeOutputError) { console.error('NOT WRITTEN: ' + e.message); process.exit(1); } throw e; }
const displayPath = p => { const r = roots.find(x => p.startsWith(x + path.sep)); return (r ? path.relative(r, p) : path.basename(p)) + (p.endsWith(path.sep) ? '/' : ''); };

// ── Gather files ────────────────────────────────────────────────────────
// Everything under the inputs that is not converted is listed; nothing is passed over in silence.
const notConverted = [];        // { path, why }
const notUtf8 = [];             // paths
function walk(p, acc, top) {
  const st = top ? fs.statSync(p) : fs.lstatSync(p);
  if (st.isSymbolicLink()) notConverted.push({ path: p, why: 'a symbolic link (not followed)' });
  else if (st.isDirectory()) {
    fs.readdirSync(p).sort().forEach(n => {
      const q = path.join(p, n);
      if (!/^[_.]/.test(n)) walk(q, acc, false);
      else { const isDir = fs.lstatSync(q).isDirectory(); notConverted.push({ path: q + (isDir ? path.sep : ''), why: (isDir ? 'a folder' : 'a file') + ' whose name starts with "' + n[0] + '" (not read)' }); }
    });
  } else if (st.isFile() && /\.csv$/i.test(p)) {
    const t = so.readText(p);
    if (t.encodingError) notUtf8.push(p);
    else acc.push({ path: p, name: path.basename(p), lastModified: st.mtimeMs, text: t.text });
  } else notConverted.push({ path: p, why: st.isFile() ? 'not a CSV file' : 'not a regular file' });
  return acc;
}
const found = inputs.reduce((acc, p) => walk(path.resolve(p), acc, true), []);
if (notUtf8.length) {
  console.error('NOT WRITTEN: ' + notUtf8.length + ' file(s) ' + so.NOT_UTF8 + ':');
  notUtf8.forEach(p => console.error('  ' + displayPath(p)));
  process.exit(1);
}
// Beta 2 name authority lists have their own columns and no tool column.
const malformed = [];           // { path, error }: Slaughter Cataloger CSVs that cannot be read as they stand
const headersOf = f => { try { return (SC.csv.parse(f.text).rows[0] || []).map(x => x.trim()); } catch (e) { malformed.push({ path: f.path, error: 'Could not be read as CSV: ' + e.message }); return null; } };
const isAuthorityList = f => { const h = f.headers; return !!h && h.indexOf('AuthorizedForm') !== -1 && h.indexOf('VariantForms') !== -1; };
found.forEach(f => { f.headers = headersOf(f); });
const readable = found.filter(f => f.headers);
const authorityLists = readable.filter(isAuthorityList);
const results = readable.filter(f => !isAuthorityList(f)).map(f => Object.assign(R.readFile(f.name, f.text, { lastModified: f.lastModified, legacy: true }), { path: f.path, text: f.text }));
// A CSV that is not a Slaughter Cataloger file (or holds no data) is listed and left where it is; a
// Slaughter Cataloger file that cannot be read as it stands stops the conversion.
const FOREIGN = /^(Not a Slaughter Cataloger CSV|Empty file\.|No data rows\.|Unknown tool )/;
results.filter(r => !r.ok && !FOREIGN.test(r.error)).forEach(r => malformed.push({ path: r.path, error: r.error }));
if (malformed.length) {
  console.error('NOT WRITTEN: ' + malformed.length + ' Slaughter Cataloger CSV file(s) cannot be read as they stand, so converting without them would lose their records:');
  malformed.forEach(m => console.error('  ' + displayPath(m.path) + ' — ' + m.error));
  process.exit(1);
}
const notSC = results.filter(r => !r.ok);
notSC.forEach(r => notConverted.push({ path: r.path, why: r.error }));
// Settle each input file's own order first (clean Entry Order, else row order).
const reordered = new Set();
results.filter(r => r.ok).forEach(r => { if (R.normalizeEntryOrder(r.records)) reordered.add(r.name); });
const byLib = new Map();
results.filter(r => r.ok).forEach(r => {
  const slug = r.librarySlug || '(no slug)';
  if (!byLib.has(slug)) byLib.set(slug, []);
  byLib.get(slug).push(r);
});

// Which library an authority list belongs to: the one holding the TitleID in its file name.
const authoritiesByLib = new Map(), authorityLeftOut = [];
authorityLists.forEach(f => {
  const m = /([A-Z0-9]{8}-(?:\d{4}|\d{3}X|\d{2}XX|XXXX))/.exec(f.name.toUpperCase());
  const tid = m ? m[1] : '';
  let slug = '';
  if (tid) byLib.forEach((files, sl) => { if (!slug && files.some(r => r.records.some(x => x.titleID === tid || String(x.issueID || '').indexOf(tid + '-') === 0))) slug = sl; });
  if (!slug && byLib.size === 1) slug = Array.from(byLib.keys())[0];
  if (!slug) { authorityLeftOut.push(f.name + ' — no library holds ' + (tid || 'the title it names')); notConverted.push({ path: f.path, why: 'a Beta 2 authority list: no library holds ' + (tid || 'the title it names') }); return; }
  if (!authoritiesByLib.has(slug)) authoritiesByLib.set(slug, []);
  authoritiesByLib.get(slug).push(Object.assign({}, f, { titleID: tid }));
});
// Rows of Beta 2 authority lists as 3.0 heading records, merged by heading.
const NAME_TYPE = { person: 'Person', corporate: 'Corporate body', 'corporate body': 'Corporate body', organization: 'Corporate body', organisation: 'Corporate body', pseudonym: 'Pseudonym', unknown: 'Unknown' };
const NAME_STATUS = { confirmed: 'Confirmed', needsreview: 'Needs review', 'needs review': 'Needs review' };
function authorityRecords(lists, note) {
  const out = new Map();
  lists.forEach(f => {
    const rows = SC.csv.parse(f.text).rows;
    const h = rows[0].map(x => x.trim());
    const get = (r, c) => { const i = h.indexOf(c); return i === -1 ? '' : String(r[i] == null ? '' : r[i]).trim(); };
    rows.slice(1).filter(r => r.some(x => String(x).trim())).forEach(r => {
      const name = get(r, 'AuthorizedForm');
      if (!name) return;
      const k = SC.names.nameKey(name);
      const rec = { name, nameType: NAME_TYPE[get(r, 'Type').toLowerCase()] || get(r, 'Type') || 'Unknown', variants: SC.names.joinForms(SC.names.splitForms(get(r, 'VariantForms'))),
        roles: get(r, 'Roles'), honorifics: get(r, 'Honorifics'), notes: get(r, 'Notes'), status: NAME_STATUS[get(r, 'Status').toLowerCase()] || get(r, 'Status') || 'Needs review' };
      if (!out.has(k)) { out.set(k, rec); return; }
      const a = out.get(k);
      note.merged++;
      a.variants = SC.names.joinForms(SC.names.splitForms(a.variants).concat(SC.names.splitForms(rec.variants)));
      ['roles', 'honorifics', 'notes'].forEach(x => { if (rec[x] && a[x].indexOf(rec[x]) === -1) a[x] = a[x] ? a[x] + '; ' + rec[x] : rec[x]; });
      if (a.status === 'Confirmed' && rec.status !== 'Confirmed') a.status = rec.status;
    });
  });
  return Array.from(out.values());
}

const ent = S.entities;
const dataKeys = kind => ent[kind].fields.map(c => c.key);
// Compare two copies of a record on the columns both files have.
const shared = (fa, fb) => (fa.presentKeys || []).filter(k => (fb.presentKeys || []).indexOf(k) !== -1);
const val = (r, k) => String(r[k] == null ? '' : r[k]);
const fieldDiffs = (kind, a, fa, b, fb) => ent[kind].fields.filter(c => shared(fa, fb).indexOf(c.key) !== -1 && val(a, c.key) !== val(b, c.key)).map(c => c.header)
  .concat(JSON.stringify(a.spec) !== JSON.stringify(b.spec) ? ['Speculative Fields'] : [], JSON.stringify(a.na) !== JSON.stringify(b.na) ? ['N/A Fields'] : []);
// What differs between two copies of one issue's contents, matched by sequence number.
const CONTENT_FIELDS = [['itemTitle', 'Item Title'], ['author', 'Author / Credit'], ['contentType', 'Content Type'], ['parentItem', 'Parent Item'],
  ['startPage', 'Start Page'], ['endPage', 'End Page'], ['notes', 'Notes']];
function contentDiffs(usedRows, otherRows) {
  const bySeq = rows => { const m = new Map(); rows.forEach(r => m.set(String(r.sequence).trim(), r)); return m; };
  const a = bySeq(usedRows), b = bySeq(otherRows), out = [];
  a.forEach((r, k) => {
    const o = b.get(k);
    if (!o) { out.push('items only in the newer copy'); return; }
    CONTENT_FIELDS.forEach(([key, label]) => { if (String(r[key] || '') !== String(o[key] || '')) out.push(label); });
    if (r.spec.join(';') !== o.spec.join(';')) out.push('Speculative Fields');
    if (r.na.join(';') !== o.na.join(';')) out.push('N/A Fields');
  });
  b.forEach((r, k) => { if (!a.has(k)) out.push('items only in the older copy'); });
  return out;
}
const contentSig = c => [c.sequence, c.itemTitle, c.author, c.contentType, c.parentItem, c.startPage, c.endPage, c.notes, c.spec.join(';'), c.na.join(';')].join('|');
const when = ms => ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '—';

let exitCode = 0;
const summary = [];
const outFiles = new Map();     // path inside --out → text: written only once everything has been verified
const notConvertedLines = () => notConverted.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map(x => '`' + displayPath(x.path) + '` — ' + x.why);

byLib.forEach((files, slug) => {
  const rep = [];                 // markdown lines
  const conflicts = [];
  const fileStats = new Map(files.map(f => [f.name + '|' + f.path, { f, used: 0, same: 0, differs: 0, extra: 0 }]));
  const statOf = f => fileStats.get(f.name + '|' + f.path);
  const newestFirst = files.slice().sort((a, b) => (b.lastModified - a.lastModified) || (b.records.length - a.records.length) || a.name.localeCompare(b.name));
  const rank = new Map(newestFirst.map((f, i) => [f, i]));

  // ── Merge copies ──
  // Titles and issues: files (per title, for issues) that share record IDs are copies of one
  // list. The newest copy is authoritative; records only in older copies are set aside in
  // _left-out/ with their original rows. Copies that share no IDs are separate lists and all used.
  // Contents: merged an issue at a time (2.0 rows have no IDs); the newest file holding an
  // issue's contents is used for that issue.
  const taken = { title: new Map(), issue: new Map() };
  const leftOut = [];          // {kind, id, f, row, newer}
  const fromOlder = [];        // contents issues taken from a file older than another contents file of the same title
  ['title', 'issue'].forEach(kind => {
    const idk = R.idKey(kind);
    const groups = [];
    newestFirst.filter(f => f.kind === kind).forEach(f => {
      const byT = new Map();
      f.records.forEach(r => {
        if (!r[idk]) return;
        const t = kind === 'title' ? '*' : (r.titleID || SC.ids.titleIDFromChild(r.issueID));
        if (!byT.has(t)) byT.set(t, []);
        byT.get(t).push(r);
      });
      byT.forEach((recs, t) => groups.push({ f, t, recs, ids: new Set(recs.map(r => r[idk])) }));
    });
    const accepted = [];
    groups.forEach(g => {
      const copyOf = accepted.find(a => a.t === g.t && Array.from(g.ids).some(x => a.ids.has(x)));
      g.recs.forEach(r => {
        const id = r[idk], prev = taken[kind].get(id);
        if (prev) {
          const d = fieldDiffs(kind, prev.r, prev.f, r, g.f);
          if (!d.length) statOf(g.f).same++;
          else { statOf(g.f).differs++; conflicts.push({ kind, id, used: prev.f, other: g.f, fields: d }); }
        } else if (copyOf) {
          leftOut.push({ kind, id, f: g.f, row: r._row, newer: copyOf.f, r });
        } else { taken[kind].set(id, { r, f: g.f }); statOf(g.f).used++; }
      });
      if (!copyOf) accepted.push(g);
    });
  });
  const contentsByIssue = new Map();
  const contentFilesOfTitle = new Map();
  newestFirst.filter(f => f.kind === 'content').forEach(f => {
    const groups = new Map();
    f.records.forEach(r => { const k = r.issueID || '(no IssueID)'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    groups.forEach((rows, iid) => {
      const tid = rows[0].titleID || SC.ids.titleIDFromChild(iid);
      if (!contentFilesOfTitle.has(tid)) contentFilesOfTitle.set(tid, new Set());
      const prev = contentsByIssue.get(iid);
      if (!prev) {
        contentsByIssue.set(iid, { rows, f }); statOf(f).used += rows.length;
        const newer = Array.from(contentFilesOfTitle.get(tid)).find(g => g !== f);
        if (newer) fromOlder.push({ id: iid, f, newer });
      } else {
        const a = prev.rows.map(contentSig).sort().join('\n'), b = rows.map(contentSig).sort().join('\n');
        if (a === b) statOf(f).same += rows.length;
        else { statOf(f).differs += rows.length; conflicts.push({ kind: 'contents of issue', id: iid, used: prev.f, other: f, fields: contentDiffs(prev.rows, rows) }); }
      }
      contentFilesOfTitle.get(tid).add(f);
    });
  });

  // ── Library identity ──
  const titlesFile = newestFirst.find(f => f.kind === 'title');
  const libName = titlesFile ? titlesFile.libraryName : (newestFirst[0].libraryName || '');
  const libNote = titlesFile ? titlesFile.libraryNote : '';

  // ── Target files and order ──
  const fname = (kind, tid) => R.defaultFileName(kind, slug, tid);
  const issueTitle = new Map();
  taken.issue.forEach(({ r }, id) => { if (!r.titleID) r.titleID = SC.ids.titleIDFromChild(id); issueTitle.set(id, r.titleID); });
  const titleRecs = Array.from(taken.title.values()).sort((a, b) => (rank.get(a.f) - rank.get(b.f)) || ((a.r.entryOrder || 1e9) - (b.r.entryOrder || 1e9)))
    .map(({ r }, i) => Object.assign({}, r, { _src: fname('title'), entryOrder: i + 1, _row: i + 2 }));
  const issuesByTitle = new Map();
  taken.issue.forEach(v => { const t = v.r.titleID; if (!issuesByTitle.has(t)) issuesByTitle.set(t, []); issuesByTitle.get(t).push(v); });
  const issueRecs = [], issuePos = new Map();
  issuesByTitle.forEach((list, tid) => {
    list.sort((a, b) => (rank.get(a.f) - rank.get(b.f)) || ((a.r.entryOrder || 1e9) - (b.r.entryOrder || 1e9)))
      .forEach((v, i) => { issuePos.set(v.r.issueID, i); issueRecs.push(Object.assign({}, v.r, { _src: fname('issue', tid), entryOrder: i + 1, _row: i + 2 })); });
  });
  const contentsByTitle = new Map();
  contentsByIssue.forEach(({ rows }, iid) => rows.forEach(r => {
    const tid = issueTitle.get(r.issueID) || r.titleID || SC.ids.titleIDFromChild(r.issueID) || 'UNKNOWNX-XXXX';
    if (!contentsByTitle.has(tid)) contentsByTitle.set(tid, []);
    contentsByTitle.get(tid).push(r);
  }));
  const contentRecs = [];
  contentsByTitle.forEach((list, tid) => {
    list.sort((a, b) => ((issuePos.has(a.issueID) ? issuePos.get(a.issueID) : 1e9) - (issuePos.has(b.issueID) ? issuePos.get(b.issueID) : 1e9))
      || String(a.issueID).localeCompare(String(b.issueID)) || ((a.entryOrder || 1e9) - (b.entryOrder || 1e9)))
      .forEach((r, i) => contentRecs.push(Object.assign({}, r, { _src: fname('content', tid), entryOrder: i + 1, _row: i + 2 })));
  });

  // ── Build with the app's own migration rules ──
  const pseudo = new Map();
  const add = (kind, r) => {
    if (!pseudo.has(r._src)) pseudo.set(r._src, { name: r._src, kind, ok: true, error: '', warnings: [], records: [], style: SC.csv.DEFAULT_STYLE, hash: '', lastModified: 1,
      schemaVersion: '2.0', librarySlug: slug, libraryName: libName, libraryNote: libNote, extraHeaders: [] });
    const p = pseudo.get(r._src);
    p.records.push(Object.assign({}, r, { spec: r.spec.slice(), na: r.na.slice(), overrides: r.overrides ? r.overrides.slice() : r.overrides }));
    if (r.extra) Object.keys(r.extra).forEach(h => { if (p.extraHeaders.indexOf(h) === -1) p.extraHeaders.push(h); });
  };
  titleRecs.forEach(r => add('title', r)); issueRecs.forEach(r => add('issue', r)); contentRecs.forEach(r => add('content', r));
  const authNote = { merged: 0 };
  const authLists = authoritiesByLib.get(slug) || [];
  const authRecs = authorityRecords(authLists, authNote);
  const usedAuthIDs = new Set();
  authRecs.forEach((a, i) => {
    const id = SC.ids.newAuthorityID(x => usedAuthIDs.has(x)); usedAuthIDs.add(id);
    const rec = { authorityID: id, spec: [], na: [], speculative: false, _src: fname('authority'), entryOrder: i + 1, _row: i + 2 };
    ent.authority.fields.forEach(c => { rec[c.key] = ''; });
    add('authority', Object.assign(rec, a));
  });
  const built = R.buildLibrary(Array.from(pseudo.values()), { slug, legacy: true });
  const st = built.state;

  // ── Write ──
  const dir = path.join(OUT, slug);
  const written = {};
  st.files.forEach((f, name) => { written[name] = R.writeFile(st, name); outFiles.set(slug + '/' + name, written[name]); });

  // ── Set-aside rows, verbatim from their source files ──
  if (leftOut.length) {
    const loNames = new Set();
    const bySrc = new Map();
    leftOut.forEach(x => { if (!bySrc.has(x.f)) bySrc.set(x.f, []); bySrc.get(x.f).push(x.row); });
    bySrc.forEach((rowNums, f) => {
      const parsed = SC.csv.parse(f.text);
      const keep = new Set(rowNums);
      const body = parsed.rows.slice(1).filter(r => !(r.length === 1 && r[0].trim() === ''));   // same row numbering as readFile
      const rows = [parsed.rows[0]].concat(body.filter((r, i) => keep.has(i + 2)));
      // Two inputs of the same name (in different folders) each keep their own copy.
      let n = f.name, k = 1;
      while (loNames.has(n.toLowerCase())) n = f.name.replace(/(\.csv)?$/i, '-' + (++k) + '$1');
      loNames.add(n.toLowerCase());
      outFiles.set(slug + '/_left-out/' + n, SC.csv.serialize(rows, parsed.style));
    });
  }

  // ── Verify with the strict 3.0 reader ──
  const back = Object.keys(written).map(n => R.readFile(n, written[n], { lastModified: 1 }));
  const strictErrors = back.filter(b => !b.ok).map(b => b.name + ': ' + b.error);
  const rebuilt = R.buildLibrary(back, { slug });
  const canon = state => JSON.stringify(['title', 'issue', 'content', 'authority'].map(kind => {
    const m = R.mapOfKind(state, kind);
    // Compared field by field: key order does not matter.
    return Array.from(m.values()).map(r => { const o = {}; Object.keys(r).filter(k => k !== '_row').sort().forEach(k => { o[k] = r[k]; }); return o; })
      .sort((a, b) => String(a[R.idKey(kind)]).localeCompare(String(b[R.idKey(kind)])));
  }));
  const identical = !strictErrors.length && canon(st) === canon(rebuilt.state);
  const mismatches = [];
  if (!identical) {
    [['title', 'titles'], ['issue', 'issues'], ['content', 'contents'], ['authority', 'authorities']].forEach(([kind, k]) => {
      st[k].forEach((a, id) => {
        const b = rebuilt.state[k].get(id);
        if (!b) { mismatches.push(kind + ' ' + id + ': missing after re-read'); return; }
        const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).filter(x => x !== '_row');
        const diff = keys.filter(x => JSON.stringify(a[x]) !== JSON.stringify(b[x]));
        if (diff.length) mismatches.push(kind + ' ' + id + ': ' + diff.map(x => x + ' ' + JSON.stringify(a[x]) + ' → ' + JSON.stringify(b[x])).join('; '));
      });
    });
  }
  let stable = true;
  rebuilt.state.files.forEach((f, n) => { if (R.writeFile(rebuilt.state, n) !== written[n]) stable = false; });
  const countsOk = st.titles.size === taken.title.size && st.issues.size === taken.issue.size && st.authorities.size === authRecs.length &&
    st.contents.size === Array.from(contentsByIssue.values()).reduce((a, v) => a + v.rows.length, 0);
  const verified = identical && stable && countsOk && !rebuilt.changed.length;
  if (!verified) exitCode = 1;

  // ── Inherited / overridden fields per title ──
  const ovByTitle = new Map();
  st.issues.forEach(i => {
    if (!ovByTitle.has(i.titleID)) ovByTitle.set(i.titleID, { n: 0, f: {} });
    const o = ovByTitle.get(i.titleID); o.n++;
    i.overrides.forEach(k => { o.f[k] = (o.f[k] || 0) + 1; });
  });

  // ── Field-state names renamed to canonical headers ──
  const renamed = {}, unknownNames = {};
  files.forEach(f => {
    const rows = SC.csv.parse(f.text).rows, h = rows[0];
    ['Speculative Fields', 'N/A Fields'].forEach(col => {
      const ci = h.indexOf(col); if (ci === -1) return;
      rows.slice(1).forEach(r => String(r[ci] || '').split(';').map(x => x.trim()).filter(Boolean).forEach(name => {
        const c = ent[f.kind].canonicalState(name);
        if (c !== name) renamed[name + ' → ' + c] = (renamed[name + ' → ' + c] || 0) + 1;
        else if (!ent[f.kind].byHeader.has(name)) unknownNames[name] = (unknownNames[name] || 0) + 1;
      }));
    });
  });

  // ── Report ──
  const titleName = tid => (st.titles.get(tid) || {}).canonicalTitle || tid;
  rep.push('# Conversion to Slaughter Cataloger 3.0 — ' + slug);
  rep.push('');
  const d0 = new Date(), p2 = n => String(n).padStart(2, '0');   // local date (run with TZ set to the cataloguer's zone)
  rep.push('Library: **' + (libName || slug) + '**. Converted ' + d0.getFullYear() + '-' + p2(d0.getMonth() + 1) + '-' + p2(d0.getDate()) + '. Input files were not changed.');
  rep.push('');
  rep.push('**Result:** ' + st.titles.size + ' titles, ' + st.issues.size + ' issues, ' + st.contents.size + ' contents items' + (st.authorities.size ? ', ' + st.authorities.size + ' name headings' : '') + ', in ' + st.files.size + ' files.');
  rep.push('**Verification:** ' + (verified ? 'passed — the converted files read back through the 3.0 app unchanged, and saving them again produces identical files.' :
    'FAILED — ' + [!identical && 'records differ on re-read', !stable && 'second save differs', !countsOk && 'record counts differ', rebuilt.changed.length && 'files change on load', ...strictErrors].filter(Boolean).join('; ')));
  rep.push('');
  rep.push('## Input files');
  rep.push('');
  rep.push('| File | Kind | Rows | Modified | Used | Same as newer copy | Differs from newer copy |');
  rep.push('|---|---|---:|---|---:|---:|---:|');
  newestFirst.forEach(f => { const s = statOf(f); rep.push('| `' + displayPath(f.path) + '` | ' + f.kind + ' | ' + f.records.length + ' | ' + when(f.lastModified) + ' | ' + s.used + ' | ' + s.same + ' | ' + s.differs + ' |'); });
  rep.push('');
  rep.push('Where the same record appears in more than one file, the copy from the most recently modified file is used.');
  const tied = conflicts.concat(leftOut.map(x => ({ used: x.newer, other: x.f }))).filter(c => c.used.lastModified === c.other.lastModified);
  if (tied.length) rep.push('**Check:** ' + Array.from(new Set(tied.map(c => '`' + c.used.name + '` and `' + c.other.name + '`'))).join('; ') + ' have the same modification time, so the copy with more rows was treated as newer.');
  const details = [];
  if (conflicts.length) {
    rep.push('');
    rep.push('## Copies that differ');
    rep.push('');
    rep.push('Where two files hold different versions of the same records, the newer file was used. Check these if an older file might hold corrections the newer one lacks; the full list is under Details at the end.');
    const pairs = new Map();
    conflicts.forEach(c => { const k = c.kind + '|' + c.used.name + '|' + c.other.name; if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(c); });
    pairs.forEach(list => {
      const c0 = list[0], counts = {};
      list.forEach(c => c.fields.forEach(f => { counts[f] = (counts[f] || 0) + 1; }));
      const what = Object.keys(counts).sort((x, y) => counts[y] - counts[x]).map(f => f + ' (' + counts[f] + ')').join(', ');
      const n = list.length, noun = c0.kind === 'contents of issue' ? (n === 1 ? "issue's contents" : "issues' contents") : c0.kind + (n === 1 ? '' : 's');
      rep.push('');
      rep.push('- `' + c0.other.name + '` (' + when(c0.other.lastModified) + ') against the newer `' + c0.used.name + '` (' + when(c0.used.lastModified) + '): ' + n + ' ' + noun + ' differ. Differences' + (c0.kind === 'contents of issue' ? ', counted per item' : '') + ': ' + what + '.');
      list.forEach(c => details.push('- ' + c.kind + ' `' + c.id + '`' + (c.kind !== 'title' ? ' (' + titleName(issueTitle.get(c.id) || SC.ids.titleIDFromChild(c.id)) + ')' : '') + ': `' + c.other.name + '` differs from `' + c.used.name + '` in ' + Array.from(new Set(c.fields)).join(', ')));
    });
  }
  if (leftOut.length) {
    rep.push('');
    rep.push('## Set aside: records only in older copies (' + leftOut.length + ')');
    rep.push('');
    rep.push('These were missing from the newest copy of their list, so most likely deleted or renamed on purpose. They are not in the converted library; their original rows are in `_left-out/` if any should come back.');
    rep.push('');
    leftOut.slice(0, 300).forEach(x => rep.push('- ' + x.kind + ' `' + x.id + '`' + (x.kind === 'title' && x.r.canonicalTitle ? ' (' + x.r.canonicalTitle + ')' : '') + ': in `' + x.f.name + '`, not in the newer `' + x.newer.name + '`'));
    if (leftOut.length > 300) rep.push('- … and ' + (leftOut.length - 300) + ' more');
  }
  if (fromOlder.length) {
    rep.push('');
    rep.push('## Contents taken from an older file (' + fromOlder.length + ' issues)');
    rep.push('');
    rep.push('The newest Contents file for these titles has nothing for these issues, so the older file\'s contents were used.');
    rep.push('');
    fromOlder.slice(0, 200).forEach(x => rep.push('- issue `' + x.id + '` from `' + x.f.name + '` (newer: `' + x.newer.name + '`)'));
  }
  rep.push('');
  rep.push('## What changed in the data');
  rep.push('');
  const ri = built.report.filter(r => r.level !== 'skip');
  files.filter(f => reordered.has(f.name)).forEach(f => rep.push('- `' + f.name + '`: Entry Order numbers were missing or repeated, so its rows keep the order they appear in the file.'));
  ri.forEach(r => rep.push('- ' + (r.file ? '`' + r.file + '`: ' : '') + r.msg));
  if (Object.keys(renamed).length) {
    rep.push('- Field names in Speculative / N/A lists changed to the column names:');
    Object.keys(renamed).forEach(k => rep.push('  - ' + k + ' (' + renamed[k] + ')'));
  }
  if (Object.keys(unknownNames).length) {
    rep.push('- Names in Speculative / N/A lists that match no column, kept as written:');
    Object.keys(unknownNames).forEach(k => rep.push('  - "' + k + '" (' + unknownNames[k] + ')'));
  }
  rep.push('- Issues inherit title-level fields unless they differ. Fields each title\'s issues set for themselves (count of issues):');
  ovByTitle.forEach((o, tid) => {
    const keys = Object.keys(o.f);
    rep.push('  - ' + titleName(tid) + ' (' + o.n + ' issues): ' + (keys.length ? keys.map(k => ent.issue.byKey.get(k).header + ' ' + o.f[k]).join(', ') : 'none — every title-level field inherited'));
  });
  rep.push('- New columns: Total Known Issues (Titles), Overridden Fields (Issues), ContentID and Parent ContentID (Contents). Schema Version is 3.0.');
  if (authLists.length) {
    const ix = SC.names.index(st);
    const matched = Array.from(st.authorities.values()).filter(a => SC.names.headingKeys(a).some(k => ix.forms.has(k))).length;
    rep.push('- Name headings from ' + authLists.map(f => '`' + f.name + '`').join(', ') + ': ' + authRecs.length + ' headings in `' + fname('authority') + '`, each given an AuthorityID' +
      (authNote.merged ? '; ' + authNote.merged + ' repeated heading(s) merged, their forms combined' : '') + '. Count is not kept: the app counts credits itself. Status "NeedsReview" is written "Needs review". ' +
      matched + ' of the ' + authRecs.length + ' headings match credits in this library\'s contents.');
  }
  rep.push('');
  rep.push('## Not converted');
  rep.push('');
  const nc = notConvertedLines();
  if (nc.length) { rep.push('Under the inputs of this run, these were not converted. They were not changed, and they are not in the converted folder:'); rep.push(''); nc.forEach(x => rep.push('- ' + x)); }
  else rep.push('Nothing: every file under the inputs was read and converted.');
  rep.push('');
  rep.push('## Output files');
  rep.push('');
  Array.from(st.files.keys()).sort().forEach(n => rep.push('- `' + n + '` — ' + (SC.csv.parse(written[n]).rows.length - 1) + ' rows'));
  rep.push('');
  rep.push('Replace the library folder\'s CSV files with these (keep the old ones somewhere safe until you have checked the result).');
  if (details.length) { rep.push(''); rep.push('## Details: every record that differs between copies'); rep.push(''); details.forEach(d => rep.push(d)); }
  outFiles.set(slug + '/CONVERSION-REPORT.md', rep.join('\n') + '\n');

  if (mismatches.length) console.log('  MISMATCHES (' + mismatches.length + '):\n    ' + mismatches.slice(0, 8).join('\n    '));
  summary.push({ slug, name: libName, titles: st.titles.size, issues: st.issues.size, contents: st.contents.size, headings: st.authorities.size, files: st.files.size, inputs: files.length + authLists.length,
    conflicts: conflicts.length, leftOut: leftOut.length, fromOlder: fromOlder.length, verified, dir, warnings: built.report.filter(r => r.level === 'warn' || r.level === 'error').map(r => r.msg) });
});

// ── Write: a new folder, verified before it is put in place ─────────────
let written = false, notWritten = '';
const left = so.leftovers(OUT);
if (!summary.length) notWritten = 'No Slaughter Cataloger CSV files were found under the inputs; nothing was written.';
else if (exitCode) notWritten = 'NOT WRITTEN: the verification failed (below); nothing was written to ' + OUT + '.';
else {
  try {
    so.writeVerified(OUT, outFiles, tmp => {
      summary.forEach(s => {
        const d = path.join(tmp, s.slug);
        const names = fs.readdirSync(d).filter(n => /\.csv$/i.test(n) && fs.lstatSync(path.join(d, n)).isFile());
        const back = R.buildLibrary(names.map(n => { const t = so.readText(path.join(d, n)); return R.readFile(n, t.text, { lastModified: 1, encodingError: t.encodingError }); }), { slug: s.slug });
        const bad = back.report.filter(r => r.level === 'skip' || r.level === 'error').map(r => (r.file ? r.file + ': ' : '') + r.msg);
        if (back.changed.length) bad.push('files change on load: ' + back.changed.join(', '));
        if (back.state.titles.size !== s.titles || back.state.issues.size !== s.issues || back.state.contents.size !== s.contents || back.state.authorities.size !== s.headings || back.state.files.size !== s.files) bad.push('record or file counts differ');
        if (bad.length) throw new so.SafeOutputError('verify', s.slug + ', read back from disk: ' + bad.slice(0, 10).join('; '));
      });
    });
    written = true;
  } catch (e) { notWritten = 'NOT WRITTEN: ' + e.message + ' Nothing was written to ' + OUT + '.'; exitCode = 1; }
}

console.log((written ? 'Converted ' : 'Read ') + found.length + ' CSV file(s)' + (written ? ' into ' + OUT : ''));
notConvertedLines().forEach(x => console.log('  not converted: ' + x.replace(/`/g, '')));
summary.forEach(s => {
  console.log(`\n${s.slug} "${s.name}": ${s.inputs} input files -> ${s.files} files; ${s.titles} titles, ${s.issues} issues, ${s.contents} contents items${s.headings ? ', ' + s.headings + ' name headings' : ''}`);
  console.log(`  verification: ${s.verified ? 'passed' : 'FAILED'}; ${s.conflicts} record(s) differ between copies; ${s.leftOut} set aside (only in older copies); ${s.fromOlder} issue(s) of contents from an older file`);
  s.warnings.forEach(w => console.log('  check: ' + w));
});
if (notWritten) console.log('\n' + notWritten);
if (left.length) console.log('\nNote: ' + left.map(x => path.basename(x)).join(', ') + ', beside the output, ' + (left.length === 1 ? 'was' : 'were') + ' left by an interrupted run (marked ' + so.MARKER + '). Not used; can be deleted.');
process.exit(exitCode);
