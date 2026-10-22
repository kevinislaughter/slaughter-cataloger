/* Slaughter Cataloger 3 — catalog search: the box in the top bar and the results page (#/search).
   It searches the canonical 3.0 records of the open library (js/core/search.js): titles, issues,
   contents items and credited names. Read-only: nothing here changes a record, a file or anything
   the browser keeps; the query lives in the address bar and in memory only. */
(function (SC) {
  'use strict';
  const { html, Fragment, useState, useEffect, useRef, useMemo, navigate, routeHref, plural, fmt, cls, issueLabel, issueDate } = SC.ui;
  const X = SC.search, S = SC.schema, R = SC.records;

  // ── The index: one for the page, built the first time search is used, kept up by store events ──
  const live = { ix: null, version: 0, fns: new Set() };
  function index() {
    if (!live.ix) {
      const store = SC.session.store;
      live.ix = X.createIndex(() => store.state);
      store.subscribe((v, e) => {
        if (e.type === 'load') live.ix.reset();
        else if (e.type === 'change') live.ix.update(e.changed);
        else return;
        live.version++;
        live.fns.forEach(f => f());
      });
    }
    return live.ix;
  }
  // Build in the background of the first focus, so the box takes the focus at once.
  function warm() { const ix = index(); if (!ix.built) setTimeout(() => ix.ensure(), 0); }

  const KINDS = X.KINDS;                                  // title, issue, item, name
  const LABEL = { title: 'Titles', issue: 'Issues', item: 'Contents', name: 'Names' };
  const ONE = { title: ['title', 'titles'], issue: ['issue', 'issues'], item: ['contents item', 'contents items'], name: ['name', 'names'] };
  const FIRST = { title: 20, issue: 50, item: 100, name: 50 }, MORE = 200;
  // Where the page was when a result was opened, so that Back brings it back (memory only).
  const memo = { hash: '', focus: '', shown: null };

  // ── The top-bar box ──
  function SearchBox({ route }) {
    const [q, setQ] = useState('');
    const lib = SC.session.store.state.library;
    const go = e => {
      e.preventDefault();
      const v = q.trim();
      if (!v) return;
      const query = { q: v };
      if ((route.panel === 'issues' || route.panel === 'contents') && route.titleID && route.titleID !== 'new') query.from = route.titleID;
      setQ('');
      navigate({ panel: 'search', titleID: '', issueID: '', query });
    };
    return html`<form role="search" class="topsearch" onSubmit=${go} aria-label="Catalog">
      <label for="top-search" class="vh">Search the catalog</label>
      <input id="top-search" type="search" value=${q} placeholder="Search the catalog" autocomplete="off" spellcheck=${false} aria-describedby="top-search-hint"
        onFocus=${warm} onInput=${e => setQ(e.target.value)} onKeyDown=${e => { if (e.key === 'Escape') setQ(''); }} />
      <span id="top-search-hint" class="vh">Titles, issues, contents and credited names of ${lib.name || lib.slug}. Enter shows the results. The slash key comes back here.</span>
    </form>`;
  }

  // ── Showing values ──
  const marked = (text, q, opts) => X.highlight(text, q, opts).map(s => (s.mark ? html`<mark>${s.text}</mark>` : s.text));
  const ENT = { title: 'title', issue: 'issue', item: 'content', name: 'authority' };
  const OTHER_LABEL = { numbering: 'Numbering', pages: 'Pages', forms: 'Forms credited', direct: 'Name in direct order' };
  function labelOf(kind, name) {
    const col = S.entities[ENT[kind]].byKey.get(name);
    return col ? col.label : OTHER_LABEL[name] || name;
  }
  // A record's value, marked; in brackets with a question mark when it is speculative.
  function value(rec, kind, key, q, opts) {
    const v = rec && rec[key];
    if (v == null || v === '') return null;
    const col = S.entities[ENT[kind]].byKey.get(key);
    const body = marked(String(v), q, opts);
    return col && (rec.spec || []).indexOf(col.header) !== -1 ? html`<span class="unc">[${body}${/\?$/.test(String(v)) ? '' : '?'}]</span>` : body;
  }
  const join = (parts, sep) => parts.filter(p => p != null && p !== '' && p !== false).reduce((a, p, k) => (k ? a.concat([sep, p]) : [p]), []);
  // "a, b and c" (or "a, b or c"); numbers keep their own commas ("1,205 contents items").
  const list = (xs, word) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' ' + word + ' ' + xs[xs.length - 1]);
  // Where an item is: its title and issue ("The Example Gazette › Vol. 1, No. 1, May 4, 1872").
  function whereOf(st, c) {
    const iss = st.issues.get(c.issueID), tid = R.titleOfContent(st, c), t = st.titles.get(tid);
    return [t ? html`<cite>${t.canonicalTitle}</cite>` : html`<code>${tid}</code>`,
      iss ? issueLabel(iss) + (issueDate(iss) ? ', ' + issueDate(iss) : '') : html`issue <code>${c.issueID}</code> (not in an Issues file)`];
  }
  // A match in a field the row does not show: its label and the text around it.
  function snippet(rec, kind, hit, shown, q) {
    const f = hit.matched.find(n => shown.indexOf(n) === -1 && rec && rec[n] != null && rec[n] !== '');
    if (!f) return null;
    return html`<div class="r-snip"><span class="r-snip-label">${labelOf(kind, f)}:</span> ${X.snippet(String(rec[f]), q, 120, f === 'author' ? { credit: true } : null).map(s => (s.mark ? html`<mark>${s.text}</mark>` : s.text))}</div>`;
  }
  const fileNote = (st, rec) => { const f = rec && rec._src && st.files.get(rec._src); return f && (f.missing || f.unreadable) ? html`<span class="tag">${f.missing ? 'file missing from the folder' : 'file unreadable'}</span>` : null; };

  function TitleRow({ hit, st, store, q }) {
    const t = st.titles.get(hit.id);
    if (!t) return null;
    const n = store.issuesOfTitle(t.titleID).length;
    return html`<a class="r-main" href=${routeHref({ panel: 'library', titleID: t.titleID })} data-key=${hit.key}>${value(t, 'title', 'canonicalTitle', q) || '(untitled)'} <span class="r-id">(${marked(t.titleID, q)})</span></a>
      <div class="r-sub">${join([join([value(t, 'title', 'city', q), value(t, 'title', 'state', q), value(t, 'title', 'country', q)], ', '), value(t, 'title', 'publisher', q),
        value(t, 'title', 'firstYear', q), plural(n, 'issue'), t.catalogingStatus], ' · ')} ${fileNote(st, t)}</div>
      ${snippet(t, 'title', hit, ['canonicalTitle', 'titleCode', 'city', 'state', 'country', 'publisher', 'firstYear'], q)}`;
  }
  function IssueRow({ hit, st, q }) {
    const i = st.issues.get(hit.id);
    if (!i) return null;
    const t = st.titles.get(i.titleID);
    const date = issueDate(i);
    return html`<a class="r-main" href=${routeHref({ panel: 'issues', titleID: i.titleID, issueID: i.issueID })} data-key=${hit.key}>${marked(issueLabel(i), q)}${date ? html`, ${marked(date, q)}` : ''}</a>
      <div class="r-sub">${t ? html`<cite>${t.canonicalTitle}</cite>` : html`<code>${i.titleID}</code> <span class="tag">not in Titles file</span>`}
        ${i.supplement && html` <span class="tag">${i.supplementLabel || 'Supplement'}</span>`}${i.specialIssue && html` <span class="tag">Special issue</span>`}
        ${i.speculative && html` <span class="tag spec">speculative</span>`} ${fileNote(st, i)}</div>
      ${snippet(i, 'issue', hit, ['shortname', 'volume', 'issue', 'number', 'numbering', 'year', 'yearEnd', 'months', 'day', 'datePrinted', 'issueDesignation'], q)}`;
  }
  // grouped: the row is under its title and issue's sub-heading (catalog order), so it does not repeat them.
  function ItemRow({ hit, st, q, grouped }) {
    const c = st.contents.get(hit.id);
    if (!c) return null;
    const tid = R.titleOfContent(st, c);
    const parent = c.parentID && st.contents.get(c.parentID);
    const pages = c.startPage ? (c.endPage && c.endPage !== c.startPage ? 'pp. ' + c.startPage + '–' + c.endPage : 'p. ' + c.startPage) : '';
    const inParent = parent ? html`in “${parent.itemTitle || '[untitled]'}”` : '';
    const note = fileNote(st, c);
    return html`<a class="r-main" href=${routeHref({ panel: 'contents', titleID: tid, issueID: c.issueID, itemID: c.contentID })} data-key=${hit.key}>${value(c, 'item', 'itemTitle', q) || '[untitled]'}</a>
      <div class="r-sub">${join([value(c, 'item', 'author', q, { credit: true }), value(c, 'item', 'contentType', q), pages && marked(pages, q)], ' · ')}</div>
      ${grouped ? (inParent || note) && html`<div class="r-ctx">${inParent} ${note}</div>`
        : html`<div class="r-ctx">${join(whereOf(st, c), ' › ')}${inParent ? html`; ${inParent}` : ''} ${note}</div>`}
      ${hit.via && html`<div class="r-via">Credited as <strong>${hit.via.form}</strong>, filed under <strong>${hit.via.heading}</strong></div>`}
      ${snippet(c, 'item', hit, ['itemTitle', 'author', 'contentType', 'pages'], q)}`;
  }
  function NameRow({ hit, q, ix }) {
    const d = ix.doc(hit.key);
    if (!d) return null;
    const e = d.entry, a = e.authority;
    const forms = e.forms.slice(0, 5).map(f => f.raw).join(' | ');
    return html`<a class="r-main" href=${routeHref({ panel: 'names', titleID: e.id })} data-key=${hit.key}>${marked(e.label, q, { credit: true })}</a>
      <div class="r-sub">${join([plural(e.count, 'credited item'), forms && html`<span>${e.forms.length > 1 ? 'as ' : ''}${marked(forms, q, { credit: true, forms: true })}${e.forms.length > 5 ? ' …' : ''}</span>`,
        a && a.dates ? marked(a.dates, q) : ''], ' · ')}${a ? (a.status !== 'Confirmed' ? html` <span class="tag">Needs review</span>` : '') : html` <span class="tag">no heading</span>`}</div>
      ${a && snippet(a, 'name', hit, ['name', 'direct', 'variants', 'forms', 'dates'], q)}`;
  }

  // ── The results page ──
  function SearchPanel({ route }) {
    const store = SC.session.store;
    const ix = index();
    const st = store.state;
    const q = route.query.q || '';
    const kind = KINDS.indexOf(route.query.kind) !== -1 ? route.query.kind : '';
    const order = route.query.order === 'catalog' ? 'catalog' : '';
    const from = route.query.from || '';
    const restoring = memo.hash && memo.hash === location.hash;
    const [text, setText] = useState(q);
    const [ready, setReady] = useState(ix.built);
    const [, setTick] = useState(0);
    const [shown, setShown] = useState(() => (restoring && memo.shown ? Object.assign({}, memo.shown) : Object.assign({}, FIRST)));
    const [announce, setAnnounce] = useState('');
    const lastQ = useRef(q);
    const focusNext = useRef(restoring ? memo.focus : '');
    const set = patch => navigate({ panel: 'search', query: Object.assign({}, route.query, patch) }, true);

    // The field follows the address (Back, a link); the address follows the field, 150 ms after the
    // last key, without adding a step to the browser's history.
    useEffect(() => { if (q !== lastQ.current) { lastQ.current = q; setText(q); setShown(Object.assign({}, FIRST)); } }, [q]);
    useEffect(() => {
      if (text === q) return;
      const t = setTimeout(() => { lastQ.current = text; set({ q: text }); }, 150);
      return () => clearTimeout(t);
    }, [text]);
    // The first search builds the index, after "Preparing search…" has been drawn.
    useEffect(() => { if (ready) return; const t = setTimeout(() => { ix.ensure(); setReady(true); }, 0); return () => clearTimeout(t); }, []);
    // Edits, undo, redo and reloads show in the results, 150 ms after the last change. They are
    // not announced: editing elsewhere never makes the page speak.
    useEffect(() => {
      let timer = null;
      const f = () => { clearTimeout(timer); timer = setTimeout(() => setTick(n => n + 1), 150); };
      live.fns.add(f);
      return () => { live.fns.delete(f); clearTimeout(timer); };
    }, []);

    const res = useMemo(() => (ready && q.trim() ? ix.run(q, { order: order || undefined }) : null), [ready, q, order, live.version]);
    const counts = res ? res.counts : { title: 0, issue: 0, item: 0, name: 0 };
    // "4 titles, 6 issues and 1,205 contents items for “title:the”; no names": every kind is accounted for.
    const none = KINDS.filter(k => !counts[k]).map(k => ONE[k][1]);
    const summary = !res ? '' : res.total ? list(KINDS.filter(k => counts[k]).map(k => plural(counts[k], ONE[k][0], ONE[k][1])), 'and') + ' for “' + q.trim() + '”' + (none.length ? '; no ' + list(none, 'or') : '')
      : 'Nothing matches “' + q.trim() + '”';
    // What a screen reader hears: the summary, when the query, the kinds shown or the order change.
    useEffect(() => { if (res) setAnnounce(summary + (kind ? '. Showing ' + LABEL[kind].toLowerCase() + ' only' : '') + '.'); }, [ready, q, kind, order]);
    // Back from a result puts the focus on it again; "Show more" puts it on the first new row.
    useEffect(() => {
      if (!focusNext.current || !res) return;
      const el = document.querySelector('.search-page [data-key="' + focusNext.current + '"]');
      focusNext.current = '';
      memo.focus = '';
      if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center' }); }
    });

    const open = key => { memo.hash = location.hash; memo.focus = key; memo.shown = shown; };
    const lib = st.library;
    const names = ready ? ix.names().entries.length : 0;
    const kinds = kind ? [kind] : KINDS;
    const fromTitle = from && (st.titles.get(from) || store.issuesOfTitle(from).length) && !/(^|\s)-?in:/i.test(q) ? from : '';
    const ROW = { title: TitleRow, issue: IssueRow, item: ItemRow, name: NameRow };

    return html`<section class="search-page">
      <h1 class="panel-title">Search</h1>
      <p class="search-scope">Searching <strong>${lib.name || lib.slug}</strong> <code>${lib.slug}</code>, the library open now:${' '}${plural(st.titles.size, 'title')}, ${plural(st.issues.size, 'issue')}, ${plural(st.contents.size, 'contents item')}${ready ? html` and ${plural(names, 'credited name')}` : ''}.
        Only its catalog records are searched, never the text of an issue or a name merely mentioned in one.</p>
      <form role="search" class="search-form" aria-label="Catalog" onSubmit=${e => { e.preventDefault(); lastQ.current = text; set({ q: text }); }}>
        <label for="search-q">Search the catalog</label>
        <input id="search-q" type="search" value=${text} autocomplete="off" spellcheck=${false} aria-describedby="search-hint"
          onInput=${e => setText(e.target.value)} onKeyDown=${e => { if (e.key === 'Escape') setText(''); }} />
        <p id="search-hint" class="hint">Every word must match, and the last word may be the start of one. <code>"a phrase"</code>, <code>title:</code> <code>credit:</code> <code>type:</code> <code>year:</code> <code>id:</code> <code>note:</code> <code>in:</code>, and <code>-word</code> to leave out. <a href="#/guide">More in the Guide</a>.</p>
      </form>
      <div class="vh" role="status" aria-live="polite">${!ready && q ? 'Preparing search…' : announce}</div>
      ${!ready && q && html`<p class="summary">Preparing search…</p>`}
      ${res && res.query.notices.length > 0 && html`<ul class="search-notices">${res.query.notices.map(n => html`<li>${n}</li>`)}</ul>`}
      ${!q.trim() && html`<${Help} />`}
      ${res && html`<div class="search-bar">
        <p class="summary">${summary}.</p>
        ${fromTitle && html`<button type="button" class="btn small" onClick=${() => set({ q: q.trim() + ' in:' + fromTitle, from: undefined })}>Only in <cite>${(st.titles.get(fromTitle) || {}).canonicalTitle || fromTitle}</cite></button>`}
      </div>`}
      ${res && res.total > 0 && html`<div class="toolbar search-tools">
        <div class="seg" role="group" aria-label="Show">
          <button type="button" class=${cls('seg-btn', !kind && 'on')} aria-pressed=${!kind} onClick=${() => set({ kind: undefined })}>All <span class="count">${fmt(res.total)}</span></button>
          ${KINDS.map(k => html`<button type="button" class=${cls('seg-btn', kind === k && 'on')} aria-pressed=${kind === k} disabled=${!counts[k]} onClick=${() => set({ kind: k })}>${LABEL[k]} <span class="count">${fmt(counts[k])}</span></button>`)}
        </div>
        ${counts.item > 1 && (!kind || kind === 'item') && html`<div class="seg" role="group" aria-label="Order of contents items">
          <button type="button" class=${cls('seg-btn', !order && 'on')} aria-pressed=${!order} onClick=${() => set({ order: undefined })}>Best match</button>
          <button type="button" class=${cls('seg-btn', order && 'on')} aria-pressed=${!!order} onClick=${() => set({ order: 'catalog' })}>Catalog order</button>
        </div>`}
      </div>`}
      ${res && !res.total && html`<${NoResults} q=${q} res=${res} kind=${kind} set=${set} />`}
      ${res && res.total > 0 && kinds.filter(k => counts[k]).map(k => {
        const hits = res.groups[k], n = Math.min(hits.length, shown[k]);
        const Row = ROW[k];
        // Catalog order: contents items under a sub-heading for each title and issue, as the catalog lists them.
        const grouped = k === 'item' && order === 'catalog';
        const li = h => html`<li key=${h.key} class=${cls('r', 'r-' + k)} onClick=${e => { if (e.target.closest('a')) open(h.key); }}>
            <${Row} hit=${h} st=${st} store=${store} q=${res.query} ix=${ix} grouped=${grouped} /></li>`;
        return html`<section class="search-group" aria-labelledby=${'sg-' + k} key=${k}>
          <h2 id=${'sg-' + k}>${LABEL[k]} <span class="count">${fmt(hits.length)}</span></h2>
          ${grouped ? runs(hits.slice(0, n), st).map((r, j) => html`<${Fragment} key=${'run:' + r.issueID + ':' + j}>
              <h3 class="search-sub" id=${'ss-' + j}>${join(r.where, ' › ')}</h3>
              <ol class="results" aria-labelledby=${'ss-' + j}>${r.hits.map(li)}</ol><//>`)
            : html`<ol class="results">${hits.slice(0, n).map(li)}</ol>`}
          ${n < hits.length && html`<p class="more"><button type="button" class="btn small" onClick=${() => { focusNext.current = hits[n].key; setShown(Object.assign({}, shown, { [k]: shown[k] + MORE })); }}>
            Show ${fmt(Math.min(MORE, hits.length - n))} more</button> <span class="hint">${fmt(n)} of ${fmt(hits.length)} shown</span></p>`}
        </section>`;
      })}
    </section>`;
  }

  // Items in catalog order, in runs of one issue each, with where that issue is.
  function runs(hits, st) {
    const out = [];
    hits.forEach(h => {
      const c = st.contents.get(h.id);
      const iid = c ? c.issueID : '';
      const last = out[out.length - 1];
      if (last && last.issueID === iid) last.hits.push(h);
      else out.push({ issueID: iid, where: c ? whereOf(st, c) : [h.id], hits: [h] });
    });
    return out;
  }

  // Nothing found: every part of the query can be taken out with one click.
  function NoResults({ q, res, kind, set }) {
    return html`<div class="card search-none">
      <p>Nothing in this library matches every part of the search.${res.query.parts.length > 1 ? ' Take a part out:' : ''}</p>
      ${res.query.parts.length > 1 && html`<ul class="search-parts">${res.query.parts.map(p => html`<li><button type="button" class="btn small" onClick=${() => set({ q: X.without(q, p.raw) })}
        aria-label=${'Search without ' + p.label}>${p.label} ×</button></li>`)}</ul>`}
      ${kind && html`<p><button type="button" class="link" onClick=${() => set({ kind: undefined })}>Show every kind of record</button></p>`}
    </div>`;
  }

  const EXAMPLES = [['public', 'every record with the word, and names that start with it'], ['"town talk"', 'a phrase'], ['credit:"J. Q. Public"', 'items credited to a name, however it is spaced or pointed'],
    ['type:poem year:1872', 'poems in issues of 1872'], ['in:gazette fair', 'only in one periodical'], ['smith -john', 'leave out what matches a word']];
  function Help() {
    return html`<div class="card search-help"><h2>How to search</h2>
      <p>Type in the box: titles, issues, contents items and the names credited in them are found as you type. Click a result to open it where it is edited.</p>
      <ul>${EXAMPLES.map(([x, what]) => html`<li><a href=${routeHref({ panel: 'search', query: { q: x } })}><code>${x}</code></a> ${what}</li>`)}</ul></div>`;
  }

  SC.views = Object.assign(SC.views || {}, { SearchBox, SearchPanel });
  // For the browser tests: whether the index has been built, and how often (never written anywhere).
  SC.searchUI = { stats: () => (live.ix ? live.ix.stats() : { built: false, builds: 0 }) };
})(globalThis.SC = globalThis.SC || {});
