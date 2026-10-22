/* Slaughter Cataloger 3 — catalog search.
   One search over the canonical 3.0 records of the open library: titles, issues, contents
   items, and the names credited in the contents (headings from the Authorities file, and
   credited forms that have no heading yet). Nothing else is searched: no issue package, no
   transcription, no index of names merely mentioned in a text.

   Pure. It reads a state ({ library, titles, issues, contents, authorities, files }) through a
   function the caller gives it, and never changes a record, a file or any storage. The index
   lives in memory only and goes away with the page. docs/SEARCH.md describes the query
   language, the fields searched and the ranking.

   SC.search = { fold, foldMapped, tokens, parse, without, createIndex, highlight, snippet,
                 FIELDS, KINDS } */
(function (SC) {
  'use strict';
  const S = SC.schema, R = SC.records, NM = SC.names, CAT = SC.catalog;

  // ── Folding ───────────────────────────────────────────────────────────
  // One rule for documents and queries:
  //   1. NFD, combining marks U+0300–U+036F removed, lower case (as names.sortKey);
  //   2. letters NFD leaves whole: æ→ae œ→oe ß→ss ø→o ł→l đ→d ð→d þ→th ı→i, and ς→σ;
  //   3. apostrophes (' ‘ ’ ʼ) removed without splitting: O'Brien → obrien;
  //   4. a period between single letters removed: S.E.P. → sep, J.Q. → jq;
  //   5. any other run of characters that are not letters, digits or marks → one space.
  const APOS = /['‘’ʼ]/;
  const LETTERS = { 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ς': 'σ' };
  const LETTER_RE = /[æœßøłđðþıς]/g;
  const WORD = /[\p{L}\p{N}\p{M}]/u, LETTER = /\p{L}/u, MARK = /\p{M}/u;
  // What each character is, worked out once: a = apostrophe, w = letter, digit or mark, l = letter,
  // m = mark, f = what it folds to.
  const INFO = new Map(), ASCII = new Array(128);
  function info(cp) {
    let x = cp < 128 ? ASCII[cp] : INFO.get(cp);
    if (x) return x;
    const ch = String.fromCodePoint(cp);
    x = { a: APOS.test(ch), w: WORD.test(ch), l: LETTER.test(ch), m: MARK.test(ch), f: '' };
    if (x.w) x.f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(LETTER_RE, c => LETTERS[c]);
    if (cp < 128) ASCII[cp] = x; else INFO.set(cp, x);
    return x;
  }
  // One pass over the text. With map, it also keeps for every character of the result the span of
  // the original it came from (UTF-16 positions), so a match can be marked in the text as typed.
  function scan(s, map) {
    let text = '', space = false;
    const from = map ? [] : null, to = map ? [] : null;
    // The two characters before this one, leaving out marks and apostrophes: 'L' a letter,
    // 'N' another word character, 'S' anything else, '' none.
    let p1 = '', p2 = '';
    for (let i = 0; i < s.length;) {
      const cp = s.codePointAt(i), len = cp > 0xffff ? 2 : 1;
      const x = info(cp);
      if (x.a) { i += len; continue; }                       // removed, never splits
      if (cp === 46) {                                       // a period between single letters is removed
        let j = i + 1;
        while (j < s.length && info(s.codePointAt(j)).a) j += s.codePointAt(j) > 0xffff ? 2 : 1;
        const joins = p1 === 'L' && p2 !== 'L' && p2 !== 'N' && j < s.length && info(s.codePointAt(j)).l;
        p2 = p1; p1 = 'S';
        if (!joins && text) space = true;
        i += len; continue;
      }
      if (!x.w) { if (text) space = true; p2 = p1; p1 = 'S'; i += len; continue; }
      if (!x.m) { p2 = p1; p1 = x.l ? 'L' : 'N'; }
      const f = x.f;
      if (f) {
        if (space) { text += ' '; if (map) { from.push(i); to.push(i); } space = false; }
        text += f;
        if (map) for (let k = 0; k < f.length; k++) { from.push(i); to.push(i + len); }
      }
      i += len;
    }
    return map ? { text, from, to } : text;
  }
  const foldMapped = s => scan(s == null ? '' : String(s), true);
  // Plain ASCII, most catalog text, goes through the same rules with the engine's own string
  // functions. The tests check that the two paths agree.
  const NON_ASCII = /[^\x00-\x7f]/, JOIN_ASCII = /(?<![A-Za-z0-9]'*)([A-Za-z])'*\.(?='*[A-Za-z])/g;
  function fold(s) {
    s = s == null ? '' : String(s);
    if (NON_ASCII.test(s)) return scan(s, false);
    return s.replace(JOIN_ASCII, '$1').replace(/'/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  const EMPTY_TOKENS = [];
  // The words of a text, folded: fold(s).split(' '), without the steps plain text does not need.
  function tokens(s) {
    s = s == null ? '' : String(s);
    if (NON_ASCII.test(s)) { const f = scan(s, false); return f ? f.split(' ') : EMPTY_TOKENS; }
    if (s.indexOf('.') !== -1) s = s.replace(JOIN_ASCII, '$1');
    if (s.indexOf("'") !== -1) s = s.replace(/'/g, '');
    return s.toLowerCase().match(/[a-z0-9]+/g) || EMPTY_TOKENS;
  }

  // ── What is searched ──────────────────────────────────────────────────
  // Weights feed ranking. group: 'title' (title:), 'credit' (credit:), 'type' (type:), 'note' (note:).
  // Field lists name schema keys; a key the schema does not define stops the module from loading.
  const FIELDS = {
    title: [
      [10, 'title', ['canonicalTitle']], [10, '', ['titleCode']],
      [6, 'title', ['originalTitle', 'subtitle', 'formerTitles', 'laterTitles', 'relatedTitles']],
      [3, '', ['publisher', 'editors', 'city', 'state', 'country', 'language', 'frequency', 'issn', 'firstYear']],
      [1, 'note', ['firstYearNote', 'pubHistory', 'mission', 'editorial', 'biblioNote', 'generalNotes']]
    ],
    issue: [
      [8, '', ['shortname', 'issueDesignation']],
      [6, 'title', ['title', 'subtitle', 'formerTitle', 'laterTitle']],            // own (overridden) values only
      [5, '', ['year', 'yearEnd', 'months', 'day', 'datePrinted']],
      [3, '', ['contributors', 'printer', 'printerLocation', 'series', 'seriesNumber', 'edition', 'supplementLabel', 'price', 'pages', 'size',
        'publisher', 'editors', 'city', 'state', 'country', 'language', 'frequency', 'issn']],
      [1, 'note', ['notes', 'evidenceNote', 'calendarNote']]
    ],
    content: [
      [10, 'title', ['itemTitle']], [8, 'credit', ['author']], [4, 'type', ['contentType']], [1, 'note', ['notes']]
    ],
    authority: [
      [10, 'credit', ['name']], [8, 'credit', ['variants']],
      [3, '', ['dates', 'roles', 'honorifics', 'nameType']], [1, 'note', ['notes', 'sources', 'seeAlso']]
    ]
  };
  Object.keys(FIELDS).forEach(kind => FIELDS[kind].forEach(([, , keys]) => keys.forEach(k => {
    if (!S.entities[kind].byKey.has(k)) throw new Error('search: ' + kind + ' has no field ' + k);
  })));
  const NUMBER_WEIGHT = 6, PAGES_WEIGHT = 2, FORMS_WEIGHT = 8, DIRECT_WEIGHT = 10;
  const KINDS = ['title', 'issue', 'item', 'name'];
  const KIND_OF_RECORD = { title: 'title', issue: 'issue', item: 'content' };

  const has = v => v != null && String(v).trim() !== '';
  // String.prototype.localeCompare with no arguments, as names.js and the store sort; a collator
  // made once gives the same order without setting one up for every comparison.
  const COLL = new Intl.Collator();
  const cmp = (a, b) => COLL.compare(a, b);
  // Credits repeat (a contributor is credited in many items), so how a credit cell splits and what
  // each credit's key is are kept, by their text. Both are pure functions of the text; the caches are
  // emptied when they grow large. What a heading's keys are is kept by its record (records never
  // change in place: an edit makes a new record).
  const CACHE_MAX = 200000;
  const creditMemo = new Map(), keyMemo = new Map();
  let headingMemo = new WeakMap();
  const creditsOf = author => {
    const a = author == null ? '' : String(author);
    let c = creditMemo.get(a);
    if (!c) { if (creditMemo.size > CACHE_MAX) creditMemo.clear(); c = NM.splitCredits(a); creditMemo.set(a, c); }
    return c;
  };
  // names.nameKey; for plain ASCII it comes to lower case without anything but letters and digits.
  const nameKey = raw => (typeof raw === 'string' && !NON_ASCII.test(raw)) ? raw.toLowerCase().replace(/[^a-z0-9]+/g, '') : NM.nameKey(raw);
  const keyOf = raw => {
    let k = keyMemo.get(raw);
    if (k === undefined) { if (keyMemo.size > CACHE_MAX) keyMemo.clear(); k = nameKey(raw); keyMemo.set(raw, k); }
    return k;
  };
  // names.headingKeys(a), with the direct-order form worked out once and kept for the documents.
  function headingOf(a) {
    let h = headingMemo.get(a);
    if (!h) {
      const direct = NM.directOrder(a.name);
      h = { direct, keys: Array.from(new Set([nameKey(a.name), nameKey(direct)].concat(NM.splitForms(a.variants).map(nameKey)).filter(Boolean))) };
      headingMemo.set(a, h);
    }
    return h;
  }
  // Short values repeat (credits, content types, months, prices, places): their words are kept by
  // text, so each is folded once and its word list shared (word lists are never changed).
  const wordMemo = new Map();
  function words(text) {
    if (typeof text !== 'string' || text.length > 48) return tokens(text);
    let t = wordMemo.get(text);
    if (!t) { if (wordMemo.size > CACHE_MAX) wordMemo.clear(); t = tokens(text); wordMemo.set(text, t); }
    return t;
  }
  function field(name, weight, group, text) {
    const t = words(text);
    return t.length ? { name, weight, group, tokens: t } : null;
  }
  const PLAN = {};
  Object.keys(FIELDS).forEach(kind => {
    PLAN[kind] = [];
    FIELDS[kind].forEach(([w, g, keys]) => keys.forEach(k => PLAN[kind].push({ k, w, g, header: S.entities[kind].byKey.get(k).header })));
  });
  function fieldsOf(kind, rec, skip) {
    const out = [], na = rec.na || [];
    for (const p of PLAN[kind]) {
      const v = rec[p.k];
      if (v == null || v === '' || (skip && skip(p.k))) continue;
      if (na.length && na.indexOf(p.header) !== -1) continue;            // N/A holds no value
      const f = field(p.k, p.w, p.g, v);
      if (f) out.push(f);
    }
    return out;
  }
  const lower = s => String(s || '').toLowerCase();

  function titleDoc(st, t) {
    return { key: 'title:' + t.titleID, kind: 'title', id: t.titleID, titleID: t.titleID, issueID: '',
      fields: fieldsOf('title', t), lid: lower(t.titleID), creditKeys: [] };
  }
  function issueDoc(st, i) {
    const title = st.titles.get(i.titleID) || null;
    // A value the issue inherits from its title is the title's, and is found on the title.
    const fs = fieldsOf('issue', i, k => !!S.INHERIT[k] && R.inherits(i, title, k));
    const num = [has(i.volume) && 'vol ' + i.volume, has(i.issue) && 'no ' + i.issue, has(i.number) && 'whole no ' + i.number].filter(Boolean).join(' ');
    const nf = field('numbering', NUMBER_WEIGHT, '', num);
    if (nf) fs.push(nf);
    return { key: 'issue:' + i.issueID, kind: 'issue', id: i.issueID, titleID: i.titleID, issueID: i.issueID,
      fields: fs, lid: lower(i.issueID), creditKeys: [] };
  }
  function itemDoc(st, c) {
    const fs = fieldsOf('content', c);
    if (has(c.startPage)) fs.push({ name: 'pages', weight: PAGES_WEIGHT, group: '', tokens: words('p ' + c.startPage + (has(c.endPage) ? ' ' + c.endPage : '')) });
    const credits = creditsOf(c.author);
    const keys = credits.length === 1 ? (keyOf(credits[0]) ? [keyOf(credits[0])] : []) : Array.from(new Set(credits.map(keyOf).filter(Boolean)));
    return { key: 'item:' + c.contentID, kind: 'item', id: c.contentID, titleID: R.titleOfContent(st, c), issueID: c.issueID || '',
      fields: fs, lid: lower(c.contentID), creditKeys: keys, author: String(c.author || '') };
  }
  // Names: the same list the Names tab shows (names.index), built in one pass. names.index looks up
  // each heading's forms by scanning every form, which grows with headings × forms (about 0.6 s at
  // 2,000 headings and 10,000 items); this gives the same result in linear time. The tests check
  // that the two agree, entry for entry.
  function nameIndex(st) {
    const forms = new Map();
    st.contents.forEach(c => creditsOf(c.author).forEach(raw => {
      const key = keyOf(raw);
      if (!key) return;
      let f = forms.get(key);
      if (!f) { f = { key, forms: new Map(), count: 0, items: [] }; forms.set(key, f); }
      f.forms.set(raw, (f.forms.get(raw) || 0) + 1);
      f.count++;
      f.items.push(c.contentID);
    }));
    const headingOfKey = new Map(), conflicts = [];
    const auths = Array.from((st.authorities || new Map()).values()).sort((a, b) => (a.entryOrder || 1e9) - (b.entryOrder || 1e9));
    auths.forEach(a => headingOf(a).keys.forEach(k => {
      if (!headingOfKey.has(k)) headingOfKey.set(k, a.authorityID);
      else if (headingOfKey.get(k) !== a.authorityID) conflicts.push({ key: k, authorityIDs: [headingOfKey.get(k), a.authorityID] });
    }));
    const keysOf = new Map();
    forms.forEach((f, k) => { const id = headingOfKey.get(k); if (id) (keysOf.get(id) || keysOf.set(id, []).get(id)).push(k); });
    const formList = f => Array.from(f.forms.entries()).map(([raw, count]) => ({ raw, count })).sort((a, b) => b.count - a.count || cmp(a.raw, b.raw));
    const entries = [];
    auths.forEach(a => {
      const keys = keysOf.get(a.authorityID) || [];
      const fl = [].concat.apply([], keys.map(k => formList(forms.get(k))));
      entries.push({ id: a.authorityID, kind: 'heading', label: a.name || '(no heading)', sort: NM.sortKey(a.name), keys, forms: fl,
        count: keys.reduce((n, k) => n + forms.get(k).count, 0), authority: a, headingKeys: headingOf(a).keys, direct: headingOf(a).direct });
    });
    forms.forEach(f => {
      if (headingOfKey.has(f.key)) return;
      const fl = formList(f);
      entries.push({ id: 'k:' + f.key, kind: 'name', label: fl[0].raw, sort: NM.sortKey(NM.suggestHeading(fl[0].raw).name), keys: [f.key], forms: fl, count: f.count });
    });
    entries.sort((a, b) => cmp(a.sort, b.sort) || cmp(a.label, b.label));
    return { forms, headingOfKey, entries, conflicts };
  }
  const nameDocs = (st, ix) => ix.entries.map(e => nameDoc(e));
  function nameDoc(e) {
    const forms = e.forms.map(f => f.raw).join(' | ');
    if (e.kind === 'heading') {
      const a = e.authority;
      const fs = fieldsOf('authority', a);
      const direct = e.direct != null ? e.direct : NM.directOrder(a.name);
      if (has(direct) && direct !== a.name) { const df = field('direct', DIRECT_WEIGHT, 'credit', direct); if (df) fs.push(df); }
      const ff = field('forms', FORMS_WEIGHT, 'credit', forms); if (ff) fs.push(ff);
      return { key: 'name:' + e.id, kind: 'name', id: e.id, titleID: '', issueID: '', fields: fs, lid: lower(a.authorityID),
        creditKeys: Array.from(new Set(e.keys.concat(e.headingKeys || NM.headingKeys(a)))), entry: e };
    }
    const ff = field('forms', FORMS_WEIGHT, 'credit', forms);
    return { key: 'name:' + e.id, kind: 'name', id: e.id, titleID: '', issueID: '', fields: ff ? [ff] : [], lid: '', creditKeys: e.keys.slice(), entry: e };
  }
  // Whether a name entry makes the same document as before: same kind, label, forms, keys and
  // heading record. (How often each form is credited is not indexed, only shown.)
  function sameEntry(a, b) {
    if (!a || !b || a.kind !== b.kind || a.label !== b.label || a.authority !== b.authority || a.keys.length !== b.keys.length || a.forms.length !== b.forms.length) return false;
    for (let k = 0; k < a.keys.length; k++) if (a.keys[k] !== b.keys[k]) return false;
    for (let k = 0; k < a.forms.length; k++) if (a.forms[k].raw !== b.forms[k].raw) return false;
    return true;
  }

  // ── Query language ────────────────────────────────────────────────────
  //   words            every word must match the same record; the last word is also a prefix
  //   "a phrase"       these words, in this order, in one field
  //   title: credit: type: year: id: note: in:     field filters (a value, or a "quoted value")
  //   -word -"phrase" -type:notice                  leave out records that match
  const FILTERS = ['title', 'credit', 'type', 'year', 'id', 'note', 'in'];
  const MAX_CHARS = 200, MAX_TERMS = 32;
  const ID_SHAPED = /^([a-z0-9]{8}-(\d{4}|\d{3}x|\d{2}xx|xxxx)(-[a-z0-9]{1,16})?|au-[a-z0-9]{1,6})$/i;

  function parse(raw) {
    const q = { raw: String(raw == null ? '' : raw), words: [], wordRaw: [], ids: [], phrases: [], filters: [], neg: [], parts: [], notices: [], prefix: '' };
    let s = q.raw.replace(/[\r\n\t]+/g, ' ');
    if (s.length > MAX_CHARS) { s = s.slice(0, MAX_CHARS); q.notices.push('Only the first ' + MAX_CHARS + ' characters were searched.'); }
    // Pieces: [neg][field:]("quoted" | bare)
    const pieces = [];
    let i = 0;
    while (i < s.length) {
      while (i < s.length && s[i] === ' ') i++;
      if (i >= s.length) break;
      const start = i;
      let neg = false;
      if (s[i] === '-' && i + 1 < s.length && s[i + 1] !== ' ') { neg = true; i++; }
      let fieldName = '';
      const m = /^([A-Za-z]+):/.exec(s.slice(i));
      if (m && FILTERS.indexOf(m[1].toLowerCase()) !== -1) { fieldName = m[1].toLowerCase(); i += m[0].length; }
      let value = '', quoted = false;
      if (s[i] === '"') {
        quoted = true; i++;
        const end = s.indexOf('"', i);
        if (end === -1) { value = s.slice(i); i = s.length; } else { value = s.slice(i, end); i = end + 1; }
      } else {
        const end = s.indexOf(' ', i);
        const stop = end === -1 ? s.length : end;
        value = s.slice(i, stop); i = stop;
      }
      pieces.push({ neg, field: fieldName, value, quoted, raw: s.slice(start, i) });
    }
    const endsOpen = !/\s$/.test(q.raw) && !(pieces.length && pieces[pieces.length - 1].quoted);
    let count = 0, cut = false;
    const room = n => { if (count + n > MAX_TERMS) { cut = true; return false; } count += n; return true; };
    pieces.forEach((p, k) => {
      const last = k === pieces.length - 1;
      const toks = tokens(p.value);
      if (p.field) {
        const label = p.field + ':' + (p.quoted ? '"' + p.value + '"' : p.value);
        if (!p.value.trim()) { q.notices.push(p.field + ': needs a value; it was ignored.'); return; }
        let f;
        if (p.field === 'year') {
          const y = /^\s*(\d{1,4})\s*(?:[-–]\s*(\d{1,4}))?\s*$/.exec(p.value);
          if (!y) { q.notices.push('year: “' + p.value + '” is not a year or a range of years; it was ignored.'); return; }
          let a = parseInt(y[1], 10), b = y[2] ? parseInt(y[2], 10) : a;
          if (a > b) { const t = a; a = b; b = t; }
          f = { field: 'year', range: [a, b] };
        } else if (p.field === 'id') {
          f = { field: 'id', id: lower(p.value.trim()) };
        } else {
          if (!toks.length) { q.notices.push(p.field + ': “' + p.value + '” has nothing to search for; it was ignored.'); return; }
          f = { field: p.field, tokens: toks, phrase: p.quoted, prefix: p.field === 'type' || p.field === 'in', key: NM.nameKey(p.value), id: lower(p.value.trim()) };
        }
        if (!room(f.tokens ? f.tokens.length : 1)) return;
        f.raw = p.raw; f.label = label;
        (p.neg ? q.neg : q.filters).push(f);
        q.parts.push({ raw: p.raw, label: (p.neg ? '−' : '') + label, neg: p.neg });
        return;
      }
      if (p.quoted) {
        if (!toks.length) return;
        if (!room(toks.length)) return;
        (p.neg ? q.neg : q.phrases).push({ phrase: toks, raw: p.raw });
        q.parts.push({ raw: p.raw, label: (p.neg ? '−' : '') + '"' + p.value + '"', neg: p.neg });
        return;
      }
      if (ID_SHAPED.test(p.value)) {
        if (!room(1)) return;
        (p.neg ? q.neg : q.ids).push({ id: lower(p.value), raw: p.raw });
        q.parts.push({ raw: p.raw, label: (p.neg ? '−' : '') + p.value, neg: p.neg });
        return;
      }
      if (!toks.length) return;
      if (!room(toks.length)) return;
      if (p.neg) { q.neg.push({ words: toks, raw: p.raw }); q.parts.push({ raw: p.raw, label: '−' + p.value, neg: true }); return; }
      toks.forEach(t => q.words.push(t));
      q.wordRaw.push(p.value);
      q.parts.push({ raw: p.raw, label: p.value, neg: false });
      if (last && endsOpen) {
        const t = toks[toks.length - 1];
        if (t.length >= 2) q.prefix = t;            // the last word also matches as the start of a word
      }
    });
    if (cut) q.notices.push('Only the first ' + MAX_TERMS + ' terms were searched.');
    // The words together, as one credit would be keyed (names.nameKey, on the words as typed).
    q.wordKey = q.words.length ? NM.nameKey(q.wordRaw.join(' ')) : '';
    q.positive = q.words.length + q.ids.length + q.phrases.length + q.filters.length;
    q.empty = !q.positive && !q.neg.length;
    if (!q.positive && q.neg.length) q.notices.push('An exclusion needs something to search for: add a word or a filter.');
    return q;
  }
  // The query with one of its parts taken out (for "remove this filter").
  function without(raw, part) {
    const s = String(raw || '');
    const k = s.indexOf(part);
    return k === -1 ? s : (s.slice(0, k) + s.slice(k + part.length)).replace(/\s{2,}/g, ' ').trim();
  }

  // ── Matching ──────────────────────────────────────────────────────────
  // Quality: 1 for a whole word, 0.6 for the start of a word; ×1.5 when it is the field's first
  // word; ×3 instead when the whole field is exactly the query.
  function termIn(f, term, prefix) {
    let best = 0;
    for (let k = 0; k < f.tokens.length; k++) {
      const tok = f.tokens[k];
      let q = tok === term ? 1 : (prefix && tok.length > term.length && tok.startsWith(term) ? 0.6 : 0);
      if (q && k === 0) q *= 1.5;
      if (q > best) best = q;
      if (best >= 1.5) break;
    }
    return best;
  }
  function phraseIn(f, ph) {
    const t = f.tokens;
    for (let k = 0; k + ph.length <= t.length; k++) {
      let ok = true;
      for (let j = 0; j < ph.length; j++) if (t[k + j] !== ph[j]) { ok = false; break; }
      if (ok) return ph.length === t.length ? 3 : k === 0 ? 1.5 : 1;
    }
    return 0;
  }
  function wholeField(f, words, prefix) {
    if (f.tokens.length !== words.length) return false;
    for (let k = 0; k < words.length; k++) {
      const tok = f.tokens[k], w = words[k];
      if (tok !== w && !(prefix && k === words.length - 1 && w === prefix && tok.startsWith(w))) return false;
    }
    return true;
  }
  // Every word in the fields given; the score, or 0.
  function wordsIn(fs, words, prefix, matched) {
    let total = 0;
    for (let w = 0; w < words.length; w++) {
      const term = words[w], pre = prefix && w === words.length - 1 && term === prefix;
      let best = 0, where = null;
      for (const f of fs) {
        let q = termIn(f, term, pre);
        if (q && wholeField(f, words, prefix)) q = pre && !f.tokens.includes(term) ? 1.8 : 3;
        if (q * f.weight > best) { best = q * f.weight; where = f.name; }
      }
      if (!best) return 0;
      total += best;
      if (matched && where && matched.indexOf(where) === -1) matched.push(where);
    }
    return total;
  }
  const inGroup = (doc, g) => doc.fields.filter(f => f.group === g);
  const noteFields = doc => doc.fields.filter(f => f.group === 'note');
  // A credit, by its key: the whole key (1) or its start (0.6).
  function creditKeyQuality(doc, key) {
    if (!key || key.length < 2) return 0;
    let best = 0;
    for (const k of doc.creditKeys) { if (k === key) return 1; if (k.startsWith(key)) best = 0.6; }
    return best;
  }

  // ── The index ─────────────────────────────────────────────────────────
  /* createIndex(getState) → index. getState() returns the current state; it is read, never changed.
     index.update(changed)   after a store change: changed = [[kind, id], …] as store events give it
     index.reset()           after a load (open, reconnect, restore): dropped; built again when next used
     index.run(query, opts)  → { query, groups: { title, issue, item, name }, counts, total, ms }
     index.stats()           counts and timings, for the tests and the status line */
  function createIndex(getState) {
    let docs = null;                       // key → doc
    let postings = null;                   // term → [slot]
    let creditIdx = null;                  // credit key → [slot]
    let slots = null, free = null;         // slot → doc; slots to reuse
    let stamp = new Uint32Array(1024), tick = 0;   // de-duplicating slots without building sets
    let ix = null;                         // names.index(state)
    let namesStale = true, orderStale = true, nameOrderStale = true;
    let order = null;
    const stats = { built: false, builds: 0, buildMs: 0, namesMs: 0, orderMs: 0, lastQueryMs: 0, updates: 0, lastUpdateMs: 0, phases: {} };

    function addDoc(d) {
      const slot = d.slot = free.length ? free.pop() : slots.length;
      slots[slot] = d;
      if (slot >= stamp.length) { const n = new Uint32Array(stamp.length * 2); n.set(stamp); stamp = n; }
      docs.set(d.key, d);
      // A document's words are listed together, so a word it has already listed ends with its slot.
      for (const f of d.fields) for (const t of f.tokens) {
        const list = postings.get(t);
        if (!list) postings.set(t, [slot]);
        else if (list[list.length - 1] !== slot) list.push(slot);
      }
      for (const k of d.creditKeys) { const list = creditIdx.get(k); if (list) list.push(d.slot); else creditIdx.set(k, [d.slot]); }
    }
    const unlist = (map, term, slot) => {
      const list = map.get(term); if (!list) return;
      const at = list.indexOf(slot); if (at === -1) return;
      list[at] = list[list.length - 1]; list.pop();
      if (!list.length) map.delete(term);
    };
    function dropDoc(key) {
      const d = docs.get(key);
      if (!d) return null;
      for (const f of d.fields) for (const t of f.tokens) unlist(postings, t, d.slot);
      for (const k of d.creditKeys) unlist(creditIdx, k, d.slot);
      docs.delete(key);
      slots[d.slot] = null; free.push(d.slot);
      return d;
    }
    // Slots from several lists, each once.
    function unite(lists) {
      tick++;
      if (tick === 0xffffffff) { stamp.fill(0); tick = 1; }
      const out = [];
      for (const list of lists) for (const n of list) if (stamp[n] !== tick) { stamp[n] = tick; out.push(n); }
      return out;
    }
    // The name list is worked out again in full (as the Names tab does), but only the entries that
    // changed are indexed again.
    function buildNames() {
      const t0 = now();
      const st = getState();
      const t1 = now();
      const next = nameIndex(st);
      stats.phases.nameIndex = now() - t1;
      const keep = new Set();
      next.entries.forEach(e => {
        const key = 'name:' + e.id, old = docs.get(key);
        if (old && sameEntry(old.entry, e)) { old.entry = e; keep.add(key); return; }
        if (old) dropDoc(key);
        addDoc(nameDoc(e));
        keep.add(key);
      });
      if (ix) ix.entries.forEach(e => { const key = 'name:' + e.id; if (!keep.has(key)) dropDoc(key); });
      ix = next;
      namesStale = false;
      nameOrderStale = true;
      stats.namesMs = now() - t0;
    }
    function build() {
      const t0 = now();
      const st = getState();
      docs = new Map(); postings = new Map(); creditIdx = new Map(); slots = []; free = []; ix = null;
      let t = now();
      st.titles.forEach(x => addDoc(titleDoc(st, x)));
      st.issues.forEach(x => addDoc(issueDoc(st, x)));
      stats.phases.titlesIssues = now() - t; t = now();
      st.contents.forEach(x => addDoc(itemDoc(st, x)));
      stats.phases.items = now() - t;
      buildNames();
      orderStale = true;
      stats.built = true; stats.builds++; stats.buildMs = now() - t0;
    }
    // Catalog order, for ties and for "catalog order": titles as the catalog sorts them (a leading
    // article ignored), issues in run order, items by issue and Sequence, names in filing order.
    function buildOrder() {
      const t0 = now();
      const st = getState();
      const tids = new Set(st.titles.keys());
      st.issues.forEach(i => tids.add(i.titleID));
      st.contents.forEach(c => tids.add(R.titleOfContent(st, c)));
      const titleRank = new Map(CAT.titleOrder(st, Array.from(tids)).map((t, n) => [t, n]));
      const issues = Array.from(st.issues.values()).sort((a, b) => (titleRank.get(a.titleID) - titleRank.get(b.titleID)) ||
        cmp(a._src || '', b._src || '') || ((a.entryOrder || 1e9) - (b.entryOrder || 1e9)) || cmp(a.issueID, b.issueID));
      const issueRank = new Map(issues.map((i, n) => [i.issueID, n]));
      // Issues known only from contents come after the run of their title.
      const extra = Array.from(new Set(Array.from(st.contents.values()).map(c => c.issueID).filter(id => id && !issueRank.has(id))))
        .sort((a, b) => (titleRank.get(R.titleOfContent(st, { issueID: a })) - titleRank.get(R.titleOfContent(st, { issueID: b }))) || cmp(a, b));
      const base = issues.length;
      extra.forEach((id, n) => issueRank.set(id, base + n));
      const tr = id => { const t = st.issues.get(id); return titleRank.get(t ? t.titleID : R.titleOfContent(st, { issueID: id })); };
      const irank = c => { const t = st.issues.get(c.issueID); return t ? (titleRank.get(t.titleID) * 1e6 + issueRank.get(c.issueID)) : tr(c.issueID) * 1e6 + 5e5 + (issueRank.get(c.issueID) || 0); };
      const seq = c => { const n = parseFloat(c.sequence); return isNaN(n) ? 1e9 : n; };
      const items = Array.from(st.contents.values()).sort((a, b) => (irank(a) - irank(b)) || (seq(a) - seq(b)) || ((a.entryOrder || 1e9) - (b.entryOrder || 1e9)) || cmp(a.contentID, b.contentID));
      const itemRank = new Map(items.map((c, n) => [c.contentID, n]));
      const issueRankAll = new Map(issues.map(i => [i.issueID, titleRank.get(i.titleID) * 1e6 + issueRank.get(i.issueID)]));
      order = { titleRank, issueRank: issueRankAll, itemRank, nameRank: order ? order.nameRank : new Map() };
      orderStale = false;
      stats.orderMs = now() - t0;
    }
    function ensure() {
      if (!docs) build();
      if (namesStale) buildNames();
      if (orderStale) buildOrder();
      if (nameOrderStale) { order.nameRank = new Map(ix.entries.map((e, n) => [e.id, n])); nameOrderStale = false; }
    }
    function update(changed) {
      if (!docs) return;                                  // not built yet: nothing to keep up
      const t0 = now();
      const st = getState();
      const titlesTouched = new Set();
      (changed || []).forEach(([kind, id]) => {
        if (kind === 'title') {
          dropDoc('title:' + id);
          const t = st.titles.get(id); if (t) addDoc(titleDoc(st, t));
          titlesTouched.add(id);
          orderStale = true;
        } else if (kind === 'issue') {
          dropDoc('issue:' + id);
          const i = st.issues.get(id); if (i) addDoc(issueDoc(st, i));
          orderStale = true;
        } else if (kind === 'content') {
          const old = dropDoc('item:' + id);
          const c = st.contents.get(id);
          if (c) addDoc(itemDoc(st, c));
          if ((old ? old.author : '') !== (c ? String(c.author || '') : '')) namesStale = true;
          orderStale = true;
        } else if (kind === 'authority') {
          namesStale = true;
        }
      });
      // Whether an issue's value is its own or the title's depends on the title record.
      titlesTouched.forEach(tid => st.issues.forEach(i => { if (i.titleID === tid) { dropDoc('issue:' + i.issueID); addDoc(issueDoc(st, i)); } }));
      stats.updates++; stats.lastUpdateMs = now() - t0;
    }
    function reset() { docs = null; postings = null; creditIdx = null; slots = null; free = null; ix = null; namesStale = true; orderStale = true; nameOrderStale = true; order = null; stats.built = false; }

    // ── Running a query ──
    function run(query, opts) {
      opts = opts || {};
      const t0 = now();
      const q = typeof query === 'string' ? parse(query) : query;
      ensure();
      const st = getState();
      const groups = { title: [], issue: [], item: [], name: [] };
      if (!q.positive) return finish(q, groups, t0);

      // Context for filters, worked out once per query.
      const ctx = { st };
      q.filters.concat(q.neg).forEach(f => { if (f.field === 'in') f.titles = titlesMatching(st, f); });
      if (q.filters.some(f => f.field === 'year') || q.neg.some(f => f.field === 'year')) ctx.years = yearInfo(st);

      // Candidates: the records holding the rarest required word (or, for the words together, a
      // credit with their key), else those holding a filter's word, else every record.
      let cands;
      const EMPTY = [];
      if (q.words.length) {
        const lists = q.words.map(w => w === q.prefix ? prefixSlots(w) : postings.get(w) || EMPTY);
        lists.sort((a, b) => a.length - b.length);
        cands = q.wordKey.length >= 2 ? unite([lists[0], creditSlots(q.wordKey)]) : lists[0];
      } else if (q.phrases.length) {
        cands = postings.get(q.phrases[0].phrase[0]) || EMPTY;
      } else {
        const tf = q.filters.find(f => f.tokens && f.field !== 'in');
        if (tf) {
          const first = tf.tokens.length === 1 && tf.prefix ? prefixSlots(tf.tokens[0]) : postings.get(tf.tokens[0]) || EMPTY;
          cands = tf.field === 'credit' ? unite([first, creditSlots(tf.key)]) : first;
        } else cands = slots.map((d, n) => n).filter(n => slots[n]);
      }
      const direct = new Set();
      for (const n of cands) {
        const d = slots[n];
        if (!d) continue;
        const r = score(d, q, ctx);
        if (r) { groups[d.kind].push({ key: d.key, kind: d.kind, id: d.id, score: r.score, tier: r.tier, matched: r.matched }); direct.add(d.key); }
      }
      // Heading expansion: a query that matches a heading's name or forms also brings in the items
      // credited under any form filed under that heading. They rank below every direct match and
      // must still pass the query's other filters and exclusions.
      const creditFilters = q.filters.filter(f => f.field === 'credit');
      if (opts.expand !== false && (q.words.length || q.phrases.length || creditFilters.length) && !q.ids.length) {
        const textQ = { words: q.words, prefix: q.prefix, wordKey: q.wordKey, phrases: q.phrases, filters: creditFilters, ids: [], neg: [], positive: 1 };
        const restQ = { words: [], prefix: '', wordKey: '', phrases: [], ids: [], filters: q.filters.filter(f => f.field !== 'credit'), neg: q.neg, positive: 1 };
        docs.forEach(d => {
          if (d.kind !== 'name' || d.entry.kind !== 'heading' || !headingMatches(d, textQ, ctx)) return;
          const e = d.entry;
          e.keys.forEach(k => {
            const f = ix.forms.get(k); if (!f) return;
            f.items.forEach(cid => {
              const key = 'item:' + cid;
              if (direct.has(key)) return;
              const it = docs.get(key); if (!it || !score(it, restQ, ctx)) return;
              direct.add(key);
              const raw = NM.splitCredits(it.author).find(x => NM.nameKey(x) === k) || it.author;
              groups.item.push({ key, kind: 'item', id: it.id, score: 0, tier: 3, matched: ['author'], via: { form: raw, headingID: e.id, heading: e.label } });
            });
          });
        });
      }
      return finish(q, groups, t0, opts);
    }
    function finish(q, groups, t0, opts) {
      const catalogOrder = opts && opts.order === 'catalog';
      const rk = { title: h => order.titleRank.get(h.id), issue: h => order.issueRank.get(h.id), item: h => order.itemRank.get(h.id), name: h => order.nameRank.get(h.id) };
      KINDS.forEach(k => {
        const r = h => { const v = rk[k](h); return v == null ? 1e15 : v; };
        if (catalogOrder && k === 'item') groups[k].sort((a, b) => r(a) - r(b));
        else groups[k].sort((a, b) => (a.tier - b.tier) || (b.score - a.score) || (r(a) - r(b)));
      });
      const counts = { title: groups.title.length, issue: groups.issue.length, item: groups.item.length, name: groups.name.length };
      stats.lastQueryMs = now() - t0;
      return { query: q, groups, counts, total: counts.title + counts.issue + counts.item + counts.name, ms: stats.lastQueryMs };
    }

    function prefixSlots(p) {
      const lists = [];
      postings.forEach((list, term) => { if (term.startsWith(p)) lists.push(list); });
      return lists.length === 1 ? lists[0] : unite(lists);
    }
    function creditSlots(key) {
      if (!key || key.length < 2) return [];
      const lists = [];
      creditIdx.forEach((list, k) => { if (k.startsWith(key)) lists.push(list); });
      return unite(lists);
    }

    // One record against the whole query: { score, tier, matched } or null.
    function score(d, q, ctx) {
      const matched = [];
      let total = 0;
      if (q.words.length) {
        let s = wordsIn(d.fields, q.words, q.prefix, matched);
        if (d.kind === 'item' || d.kind === 'name') {
          const kq = creditKeyQuality(d, q.wordKey);
          const ks = kq * FORMS_WEIGHT * q.words.length;
          if (ks > s) { s = ks; if (matched.indexOf(d.kind === 'item' ? 'author' : 'forms') === -1) matched.push(d.kind === 'item' ? 'author' : 'forms'); }
        }
        if (!s) return null;
        total += s;
      }
      let exact = false;
      for (const idt of q.ids) {
        const hit = !d.lid ? 0 : d.lid === idt.id ? 1 : d.lid.startsWith(idt.id) ? 0.6 : 0;
        if (!hit) return null;
        if (hit === 1) exact = true;
        total += 10 * hit;
      }
      for (const ph of q.phrases) {
        let best = 0, where = null;
        for (const f of d.fields) { const v = phraseIn(f, ph.phrase) * f.weight; if (v > best) { best = v; where = f.name; } }
        if (!best) return null;
        total += best;
        if (where && matched.indexOf(where) === -1) matched.push(where);
      }
      for (const f of q.filters) {
        const s = filterScore(d, f, ctx, matched);
        if (s === null) return null;
        total += s;
      }
      if (excluded(d, q, ctx)) return null;
      // Tier 1: the whole query is this record's ID.
      const tier = exact && q.ids.length === 1 && q.positive === 1 ? 1 : 2;
      return { score: total, tier, matched };
    }
    // A filter's score (0 for filters that only narrow), or null when the record fails it.
    function filterScore(d, f, ctx, matched) {
      switch (f.field) {
        case 'title': case 'note': case 'type': case 'credit': {
          const fs = f.field === 'note' ? noteFields(d) : inGroup(d, f.field);
          let s = 0;
          if (fs.length) {
            if (f.phrase) { for (const x of fs) { const v = phraseIn(x, f.tokens) * x.weight; if (v > s) s = v; } }
            else s = wordsIn(fs, f.tokens, f.prefix ? f.tokens[f.tokens.length - 1] : '', matched);
          }
          if (f.field === 'credit' && (d.kind === 'item' || d.kind === 'name')) {
            const kq = creditKeyQuality(d, f.key) * FORMS_WEIGHT * f.tokens.length;
            if (kq > s) s = kq;
          }
          if (!s) return null;
          if (fs.length && matched.indexOf(fs[0].name) === -1 && f.field !== 'note') matched.push(fs[0].name);
          return s;
        }
        case 'id': return d.lid && d.lid.startsWith(f.id) ? 0 : null;
        case 'in': return inTitles(d, ctx, f.titles) ? 0 : null;
        case 'year': return inYears(d, ctx, f.range) ? 0 : null;
      }
      return null;
    }
    // A heading matched by its name, its forms or their keys (not by its notes or dates).
    function headingMatches(d, q, ctx) {
      const credit = inGroup(d, 'credit');
      if (q.words.length && !wordsIn(credit, q.words, q.prefix, null) && !creditKeyQuality(d, q.wordKey)) return false;
      for (const ph of q.phrases) if (!credit.some(f => phraseIn(f, ph.phrase))) return false;
      for (const f of q.filters) if (filterScore(d, f, ctx, []) === null) return false;
      return true;
    }
    function excluded(d, q, ctx) {
      for (const n of q.neg) {
        if (n.words) { if (n.words.every(w => d.fields.some(f => f.tokens.includes(w)))) return true; continue; }
        if (n.phrase) { if (d.fields.some(f => phraseIn(f, n.phrase))) return true; continue; }
        if (n.id && !n.field) { if (d.lid && d.lid.startsWith(n.id)) return true; continue; }
        if (n.field === 'in') { if (inTitles(d, ctx, n.titles)) return true; continue; }
        if (n.field === 'year') { if (inYears(d, ctx, n.range)) return true; continue; }
        if (n.field) { if (filterScore(d, Object.assign({}, n, { prefix: n.field === 'type' }), ctx, []) !== null) return true; }
      }
      return false;
    }
    // in: the titles whose names or TitleID match.
    function titlesMatching(st, f) {
      const out = new Set();
      const all = new Set(st.titles.keys());
      st.issues.forEach(i => all.add(i.titleID));
      all.forEach(tid => {
        if (lower(tid).startsWith(f.id)) { out.add(tid); return; }
        const t = st.titles.get(tid);
        if (!t) return;
        const names = ['canonicalTitle', 'originalTitle', 'formerTitles', 'laterTitles', 'titleCode'].map(k => tokens(t[k]));
        if (names.some(nt => containsRun(nt, f.tokens, f.phrase ? '' : f.tokens[f.tokens.length - 1]))) out.add(tid);
      });
      return out;
    }
    function containsRun(toks, run, prefix) {
      for (let k = 0; k + run.length <= toks.length; k++) {
        let ok = true;
        for (let j = 0; j < run.length; j++) {
          const t = toks[k + j], w = run[j];
          if (t !== w && !(prefix && j === run.length - 1 && t.startsWith(w))) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    }
    function inTitles(d, ctx, set) {
      if (!set) return false;
      if (d.kind !== 'name') return set.has(d.titleID);
      return d.entry.keys.some(k => { const f = ix.forms.get(k); return f && f.items.some(cid => { const c = ctx.st.contents.get(cid); return c && set.has(R.titleOfContent(ctx.st, c)); }); });
    }
    // year: issues whose year…year end overlaps; items through their issue; titles with an issue
    // in it or a first year in it; names with a credited item in it.
    function yearInfo(st) {
      const issueSpan = new Map(), titleSpans = new Map();
      st.issues.forEach(i => {
        const a = parseInt(i.year, 10); if (isNaN(a)) return;
        let b = parseInt(i.yearEnd, 10); if (isNaN(b) || b < a) b = a;
        issueSpan.set(i.issueID, [a, b]);
        (titleSpans.get(i.titleID) || titleSpans.set(i.titleID, []).get(i.titleID)).push([a, b]);
      });
      return { issueSpan, titleSpans };
    }
    const overlaps = (s, r) => s && s[0] <= r[1] && s[1] >= r[0];
    function inYears(d, ctx, r) {
      const y = ctx.years;
      if (d.kind === 'issue') return overlaps(y.issueSpan.get(d.id), r);
      if (d.kind === 'item') return overlaps(y.issueSpan.get(d.issueID), r);
      if (d.kind === 'title') {
        const t = ctx.st.titles.get(d.id), fy = t ? parseInt(t.firstYear, 10) : NaN;
        if (!isNaN(fy) && fy >= r[0] && fy <= r[1]) return true;
        return (y.titleSpans.get(d.id) || []).some(s => overlaps(s, r));
      }
      return d.entry.keys.some(k => { const f = ix.forms.get(k); return f && f.items.some(cid => { const c = ctx.st.contents.get(cid); return c && overlaps(y.issueSpan.get(c.issueID), r); }); });
    }

    return {
      ensure, update, reset, run,
      get built() { return !!docs; },
      doc: key => { ensure(); return docs.get(key) || null; },
      names: () => { ensure(); return ix; },
      stats: () => Object.assign({ docs: docs ? docs.size : 0, terms: postings ? postings.size : 0 }, stats),
      // A canonical picture of the index, for the test that an index kept up by updates is the
      // same as one built afresh.
      dump: () => {
        ensure();
        const ds = Array.from(docs.values()).map(d => JSON.stringify([d.key, d.titleID, d.issueID, d.fields, d.lid, d.creditKeys.slice().sort()])).sort();
        const keys = list => list.map(n => slots[n].key).sort().join(',');
        const ps = Array.from(postings.entries()).map(([t, l]) => t + '=' + keys(l)).sort();
        const cs = Array.from(creditIdx.entries()).map(([t, l]) => t + '=' + keys(l)).sort();
        return { docs: ds, postings: ps, credits: cs, order: [order.titleRank, order.issueRank, order.itemRank, order.nameRank].map(m => Array.from(m.entries()).sort((a, b) => a[1] - b[1]).map(e => e[0]).join(',')) };
      }
    };
  }
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  // ── Marking matches in text as typed ──────────────────────────────────
  // highlight(text, query, opts) → [{ text, mark }]: the original text, with the words the query
  // matched marked. Works on the original characters, whatever folding changed in length.
  // opts.credit: the text is a credit cell or a list of forms, so a credit matched by its key
  // ("J.Q. Public" for "J. Q. Public") is marked whole.
  function highlight(text, query, opts) {
    const s = text == null ? '' : String(text);
    const q = typeof query === 'string' ? parse(query) : query;
    if (!s || !q) return [{ text: s, mark: false }];
    const fm = foldMapped(s);
    const toks = [];
    const re = /[^ ]+/g;
    let m;
    while ((m = re.exec(fm.text))) toks.push({ t: m[0], a: m.index, b: m.index + m[0].length });
    const ranges = [];
    const mark = (tk, len) => { const a = fm.from[tk.a], b = fm.to[tk.a + len - 1]; if (a != null && b != null) ranges.push([a, b]); };
    const words = q.words.concat([].concat.apply([], q.filters.filter(f => f.tokens && f.field !== 'in').map(f => f.tokens)));
    toks.forEach(tk => {
      words.forEach(w => {
        if (tk.t === w) mark(tk, tk.t.length);
        else if (tk.t.startsWith(w) && (w === q.prefix || q.filters.some(f => f.field === 'type' && f.tokens.indexOf(w) !== -1))) mark(tk, w.length);
      });
    });
    q.phrases.concat(q.filters.filter(f => f.phrase && f.tokens).map(f => ({ phrase: f.tokens }))).forEach(ph => {
      for (let k = 0; k + ph.phrase.length <= toks.length; k++) {
        if (ph.phrase.every((w, j) => toks[k + j].t === w)) { const a = fm.from[toks[k].a], last = toks[k + ph.phrase.length - 1]; ranges.push([a, fm.to[last.b - 1]]); }
      }
    });
    // A credit matched by its key ("J.Q. Public" for "J. Q. Public"): mark the whole credit.
    if (opts && opts.credit) [q.wordKey].concat(q.filters.filter(f => f.field === 'credit').map(f => f.key)).filter(k => k && k.length >= 2).forEach(key => {
      let from = 0;
      (opts.forms ? NM.splitForms(s) : NM.splitCredits(s)).forEach(c => {
        const at = s.indexOf(c, from); if (at === -1) return;
        from = at + c.length;
        if (NM.nameKey(c).startsWith(key)) ranges.push([at, at + c.length]);
      });
    });
    if (!ranges.length) return [{ text: s, mark: false }];
    // A combining mark folds to nothing but belongs to the letter before it: keep it in the mark.
    ranges.forEach(r => { while (r[1] < s.length && MARK.test(String.fromCodePoint(s.codePointAt(r[1])))) r[1] += s.codePointAt(r[1]) > 0xffff ? 2 : 1; });
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    ranges.forEach(r => { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push(r.slice()); });
    const out = [];
    let at = 0;
    merged.forEach(([a, b]) => { if (a > at) out.push({ text: s.slice(at, a), mark: false }); out.push({ text: s.slice(a, b), mark: true }); at = b; });
    if (at < s.length) out.push({ text: s.slice(at), mark: false });
    return out;
  }
  // Up to max characters of text around its first match, as highlight() segments.
  function snippet(text, query, max, opts) {
    max = max || 120;
    const segs = highlight(text, query, opts);
    const s = segs.map(x => x.text).join('');
    if (s.length <= max) return segs;
    let first = 0, pos = 0;
    for (const x of segs) { if (x.mark) { first = pos; break; } pos += x.text.length; }
    let a = Math.max(0, first - Math.floor(max / 3));
    let b = Math.min(s.length, a + max);
    a = Math.max(0, b - max);
    const out = [];
    pos = 0;
    segs.forEach(x => {
      const xa = pos, xb = pos + x.text.length; pos = xb;
      const ca = Math.max(xa, a), cb = Math.min(xb, b);
      if (cb > ca) out.push({ text: x.text.slice(ca - xa, cb - xa), mark: x.mark });
    });
    if (a > 0) out.unshift({ text: '…', mark: false });
    if (b < s.length) out.push({ text: '…', mark: false });
    return out;
  }

  // Empties the caches of credit splits, credit keys and heading keys (for timing a build from scratch).
  function clearCaches() { creditMemo.clear(); keyMemo.clear(); wordMemo.clear(); headingMemo = new WeakMap(); }

  SC.search = { fold, foldMapped, tokens, parse, without, createIndex, highlight, snippet, nameIndex, nameKey, clearCaches, FIELDS, KINDS, KIND_OF_RECORD, FILTERS };
})(globalThis.SC = globalThis.SC || {});
