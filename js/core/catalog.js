/* Slaughter Cataloger 3 — the catalog view model.
   Every Compiler output, and the typeset entry at the top of the editors, reads titles,
   issues and contents through here: values with inheritance resolved, field states,
   nesting depth, and one way of writing numbering, dates and physical facts.
   Pure; testable in Node.

   Text with uncertain values is built as a list of "parts": plain strings, and
   { text, spec } pieces for record values. toText / toHTML write a parts list with
   speculative values in bibliographic brackets: [1872?]. */
(function (SC) {
  'use strict';
  const S = SC.schema, N = SC.numbering;
  const TENT = S.entities.title, IENT = S.entities.issue, CENT = S.entities.content;
  const str = v => (v == null ? '' : String(v));
  const has = v => str(v).trim() !== '';
  const inList = (list, h) => !!list && list.indexOf(h) !== -1;

  // ── Views: values and field states of one record ─────────────────────
  function statesOf(ent, rec, keys) {
    const v = {}, spec = new Set(), na = new Set();
    ent.fields.forEach(c => {
      v[c.key] = rec && rec[c.key] != null ? rec[c.key] : '';
      if (rec && inList(rec.spec, c.header)) spec.add(c.key);
      if (rec && inList(rec.na, c.header)) na.add(c.key);
    });
    return { v, spec, na };
  }
  function titleView(t, tid) {
    const x = statesOf(TENT, t);
    return Object.assign(x, { kind: 'title', id: t ? t.titleID : tid, rec: t || null });
  }
  // An issue's own values, with the twelve title-level fields taken from the title unless the issue overrides them.
  function issueView(i, t) {
    const x = statesOf(IENT, i);
    const inherited = new Set();
    Object.keys(S.INHERIT).forEach(k => {
      if (!SC.records.inherits(i, t, k)) return;
      const tk = S.INHERIT[k], tc = TENT.byKey.get(tk);
      x.v[k] = t[tk] == null ? '' : t[tk];
      // A ? the issue puts on a value it takes from the title ("the same editor, probably") stands.
      const ownSpec = x.spec.has(k);
      x.spec.delete(k); x.na.delete(k);
      if (ownSpec || inList(t.spec, tc.header)) x.spec.add(k);
      if (inList(t.na, tc.header)) x.na.add(k);
      inherited.add(k);
    });
    return Object.assign(x, { kind: 'issue', id: i.issueID, titleID: i.titleID, rec: i, inherited });
  }
  function contentView(c, depth, parent) {
    const x = statesOf(CENT, c);
    return Object.assign(x, { kind: 'content', id: c.contentID, issueID: c.issueID, rec: c, depth: depth || 0, parentTitle: parent ? parent.itemTitle : '' });
  }

  // ── Parts ─────────────────────────────────────────────────────────────
  // A record value as a part; N/A values are left out.
  const part = (view, key, text) => ({ text: text != null ? str(text) : str(view.v[key]), spec: view.spec.has(key) });
  const val = (view, key) => (view.na.has(key) ? '' : str(view.v[key]).trim());
  function bracket(t) {
    const m = /^\[(.*)\]$/.exec(t.trim());
    const inner = m ? m[1] : t;
    return '[' + inner + (/\?$/.test(inner) ? '' : '?') + ']';
  }
  // opts.marks === false writes uncertain values plainly.
  function toText(parts, opts) {
    const marks = !opts || opts.marks !== false;
    return (parts || []).map(p => (typeof p === 'string' ? p : marks && p.spec ? bracket(p.text) : p.text)).join('');
  }
  function esc(v) {
    return str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toHTML(parts, opts) {
    const marks = !opts || opts.marks !== false;
    return (parts || []).map(p => (typeof p === 'string' ? esc(p) : marks && p.spec ? '<span class="unc">' + esc(bracket(p.text)) + '</span>' : esc(p.text))).join('');
  }
  // Join non-empty parts lists with a separator.
  function join(lists, sep) {
    return lists.filter(l => l && l.length).reduce((acc, l, k) => (k ? acc.concat([sep], l) : l.slice()), []);
  }
  // A closing mark, unless the text already ends with it ("4 pp.").
  function close(parts, mark) {
    const t = toText(parts);
    return t && !/[.?!]$/.test(t.replace(/[”"’']+$/, '')) ? parts.concat([mark || '.']) : parts;
  }
  const lead = s => s.charAt(0).toUpperCase() + s.slice(1);

  // ── How an issue is written ───────────────────────────────────────────
  // "Vol. 1, no. 2 (whole no. 2)"; "New Series, no. 4"; "No. 12".
  function numbering(iv) {
    const segs = [];
    if (val(iv, 'series')) segs.push([part(iv, 'series')].concat(val(iv, 'seriesNumber') ? [', no. ', part(iv, 'seriesNumber')] : []));
    if (val(iv, 'volume')) segs.push(['Vol. ', part(iv, 'volume')]);
    if (val(iv, 'issue')) segs.push(['no. ', part(iv, 'issue')]);
    let out = join(segs, ', ');
    if (val(iv, 'number')) out = out.length ? out.concat([' (whole no. ', part(iv, 'number'), ')']) : ['no. ', part(iv, 'number')];
    if (typeof out[0] === 'string') out[0] = lead(out[0]);
    return out;
  }
  // "May 4, 1872"; "March–April 1965"; "December–January 1964–1965"; "Autumn 1997".
  function dateOf(iv, opts) {
    const full = !opts || opts.full !== false;
    const months = val(iv, 'months'), day = val(iv, 'day'), year = val(iv, 'year'), end = val(iv, 'yearEnd');
    const p = N.parsePeriod(months);
    const mtext = p ? N.periodLabel(p.idx, p.kind, { full: full ? true : p.full, autumn: p.autumn }) : months;
    const md = join([months ? [part(iv, 'months', mtext)] : [], day ? [part(iv, 'day')] : []], ' ');
    const years = year ? [part(iv, 'year', end && end !== year ? year + '–' + end : year)] : [];
    if (md.length && years.length) return md.concat([day ? ', ' : ' '], years);
    if (md.length || years.length) return md.length ? md : years;
    return opts && opts.printed === false ? [] : (val(iv, 'datePrinted') ? [part(iv, 'datePrinted')] : []);
  }
  // "4 pp.; 8.5 × 11 in; 5 cents"
  function physical(iv) {
    const pages = val(iv, 'pages');
    return join([
      pages ? [part(iv, 'pages', /^\d+$/.test(pages) ? pages + ' pp.' : pages)] : [],
      val(iv, 'size') ? [part(iv, 'size', val(iv, 'size') + (val(iv, 'sizeUnit') ? ' ' + val(iv, 'sizeUnit') : ''))] : [],
      val(iv, 'price') ? [part(iv, 'price')] : []
    ], '; ');
  }
  // "Special Poetry Issue. Supplement: Index. City edition"
  function kindOf(iv) {
    const v = iv.v;
    return join([
      v.specialIssue ? (val(iv, 'issueDesignation') ? [part(iv, 'issueDesignation')] : ['Special issue']) : [],
      !v.specialIssue && val(iv, 'issueDesignation') ? [part(iv, 'issueDesignation')] : [],
      v.supplement ? ['Supplement'].concat(val(iv, 'supplementLabel') ? [': ', part(iv, 'supplementLabel')] : []) : [],
      val(iv, 'edition') ? [part(iv, 'edition'), ' edition'] : []
    ], '. ');
  }
  // How the issue is named in lists and headings: short name, else its numbers, else its date.
  function label(iv) {
    if (val(iv, 'shortname')) return [part(iv, 'shortname')];
    const n = numbering(iv);
    if (n.length) return n;
    if (val(iv, 'issueDesignation')) return [part(iv, 'issueDesignation')];
    const d = dateOf(iv);
    return d.length ? d : [iv.id || 'Issue'];
  }
  const titleOfIssue = (iv, tv) => val(iv, 'title') ? [part(iv, 'title')] : tv && val(tv, 'canonicalTitle') ? [part(tv, 'canonicalTitle')] : ['Untitled'];
  /* The typeset entry: { title, body, sub } where body follows "<title>." —
     "Vol. 1, no. 1 (whole no. 1). May 4, 1872. 4 pp." and sub is
     "Special issue. Dated “Saturday, May 4, 1872”." */
  function entry(iv, tv) {
    const num = numbering(iv), date = dateOf(iv, { printed: false }), phys = physical(iv), kind = kindOf(iv);
    const body = join([num.length ? close(num) : [], date.length ? close(date) : [], phys.length ? close(phys) : []], ' ');
    const printed = val(iv, 'datePrinted') ? ['Dated “', part(iv, 'datePrinted'), '”.'] : [];
    const sub = join([kind.length ? close(kind) : [], printed], ' ');
    return { title: titleOfIssue(iv, tv), body, sub };
  }
  // "5–7"
  function pagesOf(cv) {
    const s = val(cv, 'startPage'), e = val(cv, 'endPage');
    if (!s && !e) return [];
    if (!e || e === s) return [part(cv, 'startPage')];
    if (!s) return [part(cv, 'endPage')];
    return [part(cv, 'startPage'), '–', part(cv, 'endPage')];
  }
  // "Springfield, IL: Jno. Q. Public"
  function imprint(v) {
    const place = join([val(v, 'city') ? [part(v, 'city')] : [], val(v, 'state') ? [part(v, 'state')] : [], val(v, 'country') ? [part(v, 'country')] : []], ', ');
    const pub = val(v, 'publisher') ? [part(v, 'publisher')] : [];
    return join([place, pub], ': ');
  }

  // ── Runs ──────────────────────────────────────────────────────────────
  function runYears(ivs, tv) {
    const ys = [];
    ivs.forEach(iv => [iv.v.year, iv.v.yearEnd].forEach(y => { const m = /\d{4}/.exec(str(y)); if (m) ys.push(parseInt(m[0], 10)); }));
    if (ys.length) { const a = Math.min.apply(null, ys), b = Math.max.apply(null, ys); return a === b ? String(a) : a + '–' + b; }
    return tv && val(tv, 'firstYear') ? val(tv, 'firstYear') : '';
  }
  /* Long runs read better in sections: by volume when the run has volumes, else by year.
     Runs of ten issues or fewer stay in one section. Returns [{ key, label, issues }]. */
  function sections(ivs, threshold) {
    if (ivs.length <= (threshold == null ? 10 : threshold)) return [{ key: 'all', label: '', issues: ivs }];
    const byVol = ivs.some(iv => val(iv, 'volume'));
    const groups = new Map();
    ivs.forEach(iv => {
      const k = byVol ? (val(iv, 'volume') || '—') : ((/\d{4}/.exec(val(iv, 'year')) || ['—'])[0]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(iv);
    });
    return Array.from(groups.entries()).map(([k, list]) => {
      const yrs = runYears(list, null);
      const label = byVol ? (k === '—' ? (yrs ? 'Unnumbered (' + yrs + ')' : 'Unnumbered') : 'Volume ' + k + (yrs ? ' (' + yrs + ')' : '')) : (k === '—' ? 'Undated' : k);
      return { key: (byVol ? 'vol:' : 'yr:') + k, label, issues: list };
    });
  }

  // ── The view model ────────────────────────────────────────────────────
  // Titles are listed alphabetically, ignoring a leading article; titles with no record last.
  const sortKey = name => String(name || '').replace(/^(the|a|an)\s+/i, '').toLowerCase();
  function titleOrder(st, tids) {
    const name = tid => (st.titles.get(tid) && st.titles.get(tid).canonicalTitle) || '';
    return tids.slice().sort((a, b) => (!st.titles.has(a) - !st.titles.has(b)) || sortKey(name(a)).localeCompare(sortKey(name(b))) || a.localeCompare(b));
  }
  /* build(store, opts) for the titles in opts.titleIDs (alphabetical; titles with no
     record last). opts: issueIDs (Set: only these issues), nested (false: top-level items
     only), limit (issues per title, for previews), date (Date the output is made).
     Returns { library, date, titles: [titleView + { name, issues, runYears, total }], counts }. */
  function build(store, opts) {
    opts = opts || {};
    const st = store.state;
    const tids = titleOrder(st, Array.from(new Set(opts.titleIDs || [])));
    const counts = { titles: 0, issues: 0, contents: 0 };
    const titles = tids.map(tid => {
      const t = st.titles.get(tid) || null;
      const tv = titleView(t, tid);
      let list = store.issuesOfTitle(tid);
      if (opts.issueIDs) list = list.filter(i => opts.issueIDs.has(i.issueID));
      const total = list.length;
      const shown = opts.limit != null ? list.slice(0, opts.limit) : list;
      counts.titles++; counts.issues += total;
      list.forEach(i => { counts.contents += contentsOf(store, i.issueID, opts.nested).length; });
      const ivs = shown.map(i => Object.assign(issueView(i, t), { contents: contentsOf(store, i.issueID, opts.nested) }));
      const allIvs = shown.length === list.length ? ivs : list.map(i => issueView(i, t));
      const name = t && has(t.canonicalTitle) ? t.canonicalTitle : (ivs[0] && val(ivs[0], 'title')) || tid;
      return Object.assign(tv, { name, issues: ivs, total, runYears: runYears(allIvs, tv) });
    });
    return { library: st.library, date: opts.date || new Date(), titles, counts, authorities: st.authorities || new Map(),
      partial: opts.limit != null && titles.some(t => t.issues.length < t.total) };
  }
  function contentsOf(store, issueID, nested) {
    const items = store.contentsOfIssue(issueID);
    const rows = items.map(c => ({ id: c.contentID, parentID: c.parentID }));
    const depths = SC.toc.depths(rows);
    // A part shown away from its parent (D-12: another item between them) is marked, so outputs can
    // say whose part it is: partOf = { title, sequence } of its parent.
    const det = nested === false ? null : SC.toc.detached(rows);
    const byId = new Map(items.map(c => [c.contentID, c]));
    const out = [];
    items.forEach((c, k) => {
      if (nested === false && depths[k]) return;
      const cv = contentView(c, nested === false ? 0 : depths[k], byId.get(c.parentID));
      if (det && det[k] !== -1) cv.partOf = { title: items[det[k]].itemTitle || '', sequence: items[det[k]].sequence || '' };
      out.push(cv);
    });
    return out;
  }
  // "part of “Item 3”", or "part of item 3" when the parent has no title.
  const partOfText = cv => (cv.partOf ? 'part of ' + (cv.partOf.title ? '“' + cv.partOf.title + '”' : 'item ' + cv.partOf.sequence) : '');
  // Volume or year sections of one title's run, for choosing what to compile.
  function scopeGroups(store, titleID) {
    const t = store.state.titles.get(titleID) || null;
    return sections(store.issuesOfTitle(titleID).map(i => issueView(i, t)), 0).map(g => ({ key: g.key, label: g.label || 'All issues', issueIDs: g.issues.map(iv => iv.id) }));
  }

  SC.catalog = {
    titleView, issueView, contentView, part, val, toText, toHTML, esc, join, close, bracket,
    numbering, dateOf, physical, kindOf, label, entry, pagesOf, imprint, titleOfIssue,
    runYears, sections, build, scopeGroups, titleOrder, sortKey, partOfText
  };
})(globalThis.SC = globalThis.SC || {});
