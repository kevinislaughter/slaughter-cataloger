/* Slaughter Cataloger 3 — an invented library for the destructive-action tests (Stage A2), made
   with the app's own writer and checked to read back cleanly.

   const L = require('./lib/integrity-library')(SC);   // SC with csv, ids, schema, records, store loaded
   L.files      { file name: CSV text } — Titles, Authorities, and an Issues and a Contents file per title
   L.ids        TitleIDs, IssueIDs, ContentIDs and AuthorityIDs by a short name (see below)
   L.names      the file names

   Titles (every name and value invented):
     LEDGER  SPECLEDX-1875  The Specimen Ledger   issues 1–4 (Entry Order 1–4); contents: no. 1 two items,
                                                  no. 2 four (a section with two parts, and a notice), no. 3 two, no. 4 none
     HERALD  SAMHERAX-1880  The Sample Herald     issues 1–2; contents: three items
     TRIAL   TRIALQUX-1890  The Trial Quarterly   no issues, no contents
     MODEL   MODELWKX-1901  The Model Weekly      one issue with two contents items
   Headings: PUBLIC "Public, John Q." (forms J. Q. Public, John Q. Public), ROE "Roe, Richard",
   DOE "Doe, Jane" (see also "Public, John Q."). Credits use those forms and one unheaded name. */
'use strict';
module.exports = function (SC) {
  const R = SC.records, S = SC.schema;
  const SLUG = 'INTEGRITY-TEST';
  const A = SC.ids.ALPHABET || '23456789ABCDEFGHJKMNPQRSTUVWYZ';
  const blank = ent => { const r = { spec: [], na: [], speculative: false }; S.entities[ent].fields.forEach(c => { r[c.key] = c.type === 'bool' ? false : ''; }); return r; };
  const fname = (kind, tid) => R.defaultFileName(kind, SLUG, tid);
  const TITLES = [
    ['LEDGER', 'SPECLEDX', '1875', 'The Specimen Ledger', 'Anytown'],
    ['HERALD', 'SAMHERAX', '1880', 'The Sample Herald', 'Otherville'],
    ['TRIAL', 'TRIALQUX', '1890', 'The Trial Quarterly', 'Elsewhere'],
    ['MODEL', 'MODELWKX', '1901', 'The Model Weekly', 'Nowhere']
  ];
  // [short id, title, number, year, contents: [short id, item title, author, parent short id]]
  const ISSUES = [
    ['L1', 'LEDGER', '1', '1875', [['L1a', 'Opening Remarks', 'J. Q. Public'], ['L1b', 'Town Notes', 'Richard Roe']]],
    ['L2', 'LEDGER', '2', '1875', [['L2a', 'Poetry', ''], ['L2b', 'A First Poem', 'Jane Doe', 'L2a'], ['L2c', 'A Second Poem', 'John Q. Public', 'L2a'], ['L2d', 'Notices', '']]],
    ['L3', 'LEDGER', '3', '1875', [['L3a', 'Market Report', 'Richard Roe'], ['L3b', 'Correspondence', 'A. N. Other']]],
    ['L4', 'LEDGER', '4', '1876', []],
    ['H1', 'HERALD', '1', '1880', [['H1a', 'Editorial', 'Jane Doe'], ['H1b', 'Local News', 'J. Q. Public']]],
    ['H2', 'HERALD', '2', '1880', [['H2a', 'Letters', 'Richard Roe']]],
    ['M1', 'MODEL', '1', '1901', [['M1a', 'Prospectus', 'J. Q. Public'], ['M1b', 'Advertisements', '']]]
  ];
  const HEADINGS = [
    ['PUBLIC', 'Public, John Q.', 'J. Q. Public; John Q. Public', ''],
    ['ROE', 'Roe, Richard', 'Richard Roe', ''],
    ['DOE', 'Doe, Jane', 'Jane Doe', 'Public, John Q.']
  ];
  const ids = {};
  const st = SC.emptyState();
  st.library = Object.freeze({ slug: SLUG, name: 'Integrity Test Library', note: 'Invented for the destructive-action tests.' });
  const files = new Map();
  const addFile = (name, kind) => { if (!files.has(name)) { files.set(name, kind); st.files.set(name, { name, kind, extraHeaders: [], hash: '', lastModified: 0, schemaVersion: S.VERSION, setAside: [] }); } };
  const FT = R.defaultFileName('title', SLUG), FA = R.defaultFileName('authority', SLUG);
  addFile(FT, 'title');
  TITLES.forEach(([k, code, year, name, city], n) => {
    const tid = code + '-' + year; ids[k] = tid;
    st.titles.set(tid, R.freezeRec(Object.assign(blank('title'), { titleID: tid, titleCode: code, firstYear: year, canonicalTitle: name, city, country: 'United States', _src: FT, entryOrder: n + 1 })));
  });
  const eo = new Map();
  const next = f => { eo.set(f, (eo.get(f) || 0) + 1); return eo.get(f); };
  let serial = 0;
  ISSUES.forEach(([k, t, num, year, list], n) => {
    const tid = ids[t], iid = tid + '-K' + A[2 + n] + 'AAAA2', fi = fname('issue', tid), fc = fname('content', tid);
    ids[k] = iid;
    addFile(fi, 'issue');
    st.issues.set(iid, R.freezeRec(Object.assign(blank('issue'), { overrides: [], issueID: iid, titleID: tid, shortname: TITLES.find(x => x[0] === t)[3].replace(/^The /, '') + ' No. ' + num, number: num, year, _src: fi, entryOrder: next(fi) })));
    list.forEach(([ck, title, author, parent], j) => {
      const cid = tid + '-C' + A[2 + (serial++ % 28)] + A[2 + n] + 'AAA' + A[2 + j];
      ids[ck] = cid;
      addFile(fc, 'content');
      st.contents.set(cid, R.freezeRec(Object.assign(blank('content'), { contentID: cid, issueID: iid, titleID: tid, sequence: String(j + 1), itemTitle: title, author,
        parentID: parent ? ids[parent] : '', parentItem: parent ? list.find(x => x[0] === parent)[1] : '', na: parent ? [] : ['Parent Item'], startPage: String(j + 1), _src: fc, entryOrder: next(fc) })));
    });
  });
  addFile(FA, 'authority');
  HEADINGS.forEach(([k, name, variants, seeAlso], n) => {
    const aid = 'AU-' + A[2 + n] + 'AAAA2'; ids[k] = aid;
    st.authorities.set(aid, R.freezeRec(Object.assign(blank('authority'), { authorityID: aid, name, variants, seeAlso, nameType: 'Person', status: 'Confirmed', _src: FA, entryOrder: n + 1 })));
  });
  const out = {};
  files.forEach((_, n) => { out[n] = R.writeFile(st, n); });
  const back = R.buildLibrary(Object.keys(out).map(n => R.readFile(n, out[n], {})), {});
  const problems = back.report.filter(r => r.level !== 'info');
  if (back.changed.length || problems.length || back.state.contents.size !== st.contents.size || back.state.issues.size !== st.issues.size) {
    throw new Error('the invented library does not read back cleanly: ' + JSON.stringify({ changed: back.changed, problems }));
  }
  return {
    files: out, ids, slug: SLUG,
    names: { titles: FT, authorities: FA, issues: tid => fname('issue', tid), contents: tid => fname('content', tid) },
    counts: { titles: st.titles.size, issues: st.issues.size, contents: st.contents.size, authorities: st.authorities.size }
  };
};
