/* Slaughter Cataloger 3 — a generated library for the search budgets (tools/test-search.js).
   Built in memory from a fixed seed; never written to disk, never committed. Every word in it is
   made up from syllables: there is no real title, name or text here.

   makeLibrary({ titles, issuesPerTitle, itemsPerIssue, headings, vocabulary, seed }) → state
   The defaults are the Phase 2 budget scale: 50 titles, 1,000 issues, 10,000 items, 2,000 headings,
   a vocabulary of 30,000 invented words, and credits whose forms vary as real credits do
   ("Jaro Vellik", "J. Vellik", "J.V.", "Vellik"). */
'use strict';

function rng(seed) {                                   // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function makeLibrary(opts) {
  const o = Object.assign({ titles: 50, issuesPerTitle: 20, itemsPerIssue: 10, headings: 2000, vocabulary: 30000, seed: 20261015 }, opts || {});
  const SC = globalThis.SC;
  const R = SC.records, ids = SC.ids;
  const rand = rng(o.seed);
  const pick = a => a[Math.floor(rand() * a.length)];
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));

  // Invented words: consonant-vowel syllables, two to four of them; a few with accents.
  const C = ['b', 'd', 'f', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'br', 'dr', 'kl', 'st', 'tr', 'sh'];
  const V = ['a', 'e', 'i', 'o', 'u', 'ai', 'ou', 'é', 'ö'];
  const seen = new Set(), vocab = [];
  while (vocab.length < o.vocabulary) {
    let w = '';
    const n = int(2, 4);
    for (let k = 0; k < n; k++) w += pick(C) + (rand() < 0.04 ? pick(V) : pick(V.slice(0, 7)));
    if (!seen.has(w)) { seen.add(w); vocab.push(w); }
  }
  // Mostly common words, with a long tail: about half the words drawn come from the first 2,000.
  const word = () => rand() < 0.5 ? vocab[Math.floor(Math.pow(rand(), 2) * 2000)] : vocab[Math.floor(rand() * vocab.length)];
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
  const phrase = (a, b) => { const n = int(a, b); const out = []; for (let k = 0; k < n; k++) out.push(k === 0 || rand() < 0.6 ? cap(word()) : word()); return out.join(' '); };
  const sentence = () => cap(phrase(6, 16).toLowerCase()) + '.';

  // People: forenames and surnames from the vocabulary; each credited in several forms.
  const people = [];
  for (let k = 0; k < Math.max(o.headings, 2500); k++) {
    const given = cap(vocab[int(0, 4999)]), middle = rand() < 0.5 ? cap(vocab[int(0, 4999)]) : '', sur = cap(vocab[int(5000, 14999)]);
    const forms = [given + (middle ? ' ' + middle.charAt(0) + '.' : '') + ' ' + sur, given.charAt(0) + '. ' + (middle ? middle.charAt(0) + '. ' : '') + sur,
      given.charAt(0) + '.' + (middle ? middle.charAt(0) + '.' : '') + sur.charAt(0) + '.', sur];
    people.push({ given, middle, sur, forms });
  }
  const credit = () => {
    const p = people[Math.floor(Math.pow(rand(), 1.5) * people.length)];
    const r = rand();
    const f = r < 0.6 ? p.forms[0] : r < 0.8 ? p.forms[1] : r < 0.9 ? p.forms[2] : p.forms[3];
    return rand() < 0.08 ? f + '; ' + pick(people).forms[0] : f;
  };

  const slug = 'BENCH-LIBRARY';
  const state = SC.emptyState();
  state.library = Object.freeze({ slug, name: 'Generated budget library', note: '' });
  const TYPES = ['article', 'editorial', 'letter', 'poem', 'review', 'notice', 'report', 'essay', 'translation', 'department', 'advertisement', 'obituary'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const usedCodes = new Set();
  let titleEO = 1;
  for (let t = 0; t < o.titles; t++) {
    const name = 'The ' + cap(word()) + ' ' + cap(word());
    let code = ids.suggestTitleCode(name, usedCodes);
    usedCodes.add(code);
    const firstYear = String(int(1850, 1990));
    const titleID = code + '-' + firstYear;
    const tfile = 'SCAT_' + slug + '_TITLES.csv';
    state.titles.set(titleID, R.freezeRec({ _src: tfile, titleID, titleCode: code, firstYear, canonicalTitle: name, subtitle: phrase(3, 6), publisher: phrase(2, 3) + ' Press',
      editors: pick(people).forms[0], city: cap(word()), country: cap(word()), language: 'English', frequency: pick(['weekly', 'monthly', 'quarterly']),
      pubHistory: sentence(), generalNotes: rand() < 0.5 ? sentence() : '', catalogingStatus: 'Contents in progress', spec: [], na: [], speculative: false, entryOrder: titleEO++ }));
    const ifile = 'SCAT_' + slug + '_' + titleID + '_ISSUES.csv', cfile = 'SCAT_' + slug + '_' + titleID + '_CONTENTS.csv';
    let year = parseInt(firstYear, 10), itemEO = 1;
    for (let n = 1; n <= o.issuesPerTitle; n++) {
      const issueID = ids.newIssueID(titleID, x => state.issues.has(x));
      const vol = Math.ceil(n / 12), no = ((n - 1) % 12) + 1;
      if (no === 1 && n > 1) year++;
      const month = MONTHS[no - 1], day = String(int(1, 28));
      state.issues.set(issueID, R.freezeRec({ _src: ifile, issueID, titleID, shortname: cap(word()) + ' V' + vol + ' I' + no + ' N' + n, volume: String(vol), issue: String(no), number: String(n),
        months: month, day, year: String(year), datePrinted: month + ' ' + day + ', ' + year, price: int(1, 25) + ' cents', pages: String(int(4, 32)),
        printer: rand() < 0.3 ? phrase(2, 3) : '', notes: rand() < 0.2 ? sentence() : '', evidenceNote: rand() < 0.3 ? sentence() : '',
        city: rand() < 0.05 ? cap(word()) : '', spec: [], na: [], overrides: [], speculative: false, entryOrder: n,
        title: '', subtitle: '', formerTitle: '', laterTitle: '', publisher: '', editors: '', issn: '', language: '', frequency: '', state: '', country: '' }));
      for (let s = 1; s <= o.itemsPerIssue; s++) {
        const contentID = ids.newContentID(titleID, x => state.contents.has(x));
        const sp = int(1, 30);
        state.contents.set(contentID, R.freezeRec({ _src: cfile, contentID, issueID, titleID, sequence: String(s), parentID: '', parentItem: '',
          itemTitle: phrase(3, 8), author: rand() < 0.85 ? credit() : '', contentType: pick(TYPES), startPage: String(sp), endPage: rand() < 0.5 ? String(sp + int(1, 4)) : '',
          notes: rand() < 0.2 ? sentence() : '', spec: [], na: [], speculative: false, entryOrder: itemEO++ }));
      }
    }
  }
  // Headings: the first credited people, each with the forms they are credited under.
  const afile = 'SCAT_' + slug + '_AUTHORITIES.csv';
  for (let k = 0; k < o.headings; k++) {
    const p = people[k];
    const authorityID = ids.newAuthorityID(x => state.authorities.has(x));
    state.authorities.set(authorityID, R.freezeRec({ _src: afile, authorityID, name: p.sur + ', ' + p.given + (p.middle ? ' ' + p.middle.charAt(0) + '.' : ''), nameType: 'Person',
      dates: rand() < 0.5 ? int(1800, 1900) + '–' + int(1901, 1980) : '', variants: p.forms.join(' | '), status: rand() < 0.5 ? 'Confirmed' : 'Needs review',
      notes: rand() < 0.2 ? sentence() : '', spec: [], na: [], speculative: false, entryOrder: k + 1 }));
  }
  return state;
}

// The library as 3.0 CSV files ({ name: text }), written by the app's own writer, for loading it
// into the app in the browser tests.
function toFiles(state) {
  const SC = globalThis.SC, R = SC.records;
  const kinds = [['title', state.titles], ['issue', state.issues], ['content', state.contents], ['authority', state.authorities]];
  kinds.forEach(([kind, m]) => m.forEach(r => { if (!state.files.has(r._src)) state.files.set(r._src, { name: r._src, kind, style: SC.csv.DEFAULT_STYLE, extraHeaders: [], hash: '', lastModified: 0, schemaVersion: SC.schema.VERSION }); }));
  const out = {};
  state.files.forEach((f, name) => { out[name] = R.writeFile(state, name); });
  return out;
}

module.exports = { makeLibrary, toFiles, rng };
