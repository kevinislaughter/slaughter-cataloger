/* Slaughter Cataloger 3 — Library › Names.
   Every name credited in the library's contents, and the headings that gather them.
   Contents keep each credit as printed; a heading (a record in the library's Authorities
   file) lists the forms one person or body is credited under and the form an index files
   them under. Making, extending and combining headings never changes the contents. */
(function (SC) {
  'use strict';
  const { html, useState, useMemo, useStore, navigate, routeHref, plural, cls, issueLabel, rovingKeys, Field } = SC.ui;
  const S = SC.schema, NM = SC.names, ids = SC.ids, R = SC.records;
  const AENT = S.entities.authority;
  const LIST_MAX = 600;

  // The library's names, worked out once for each change: the Names tab's count and the Names view
  // both need them, and are drawn together.
  let ixCache = { version: -1, store: null, ix: null };
  function namesIndex(store) {
    if (ixCache.store !== store || ixCache.version !== store.version) ixCache = { version: store.version, store, ix: NM.index(store.state) };
    return ixCache.ix;
  }

  // The Library stage's two views.
  function LibraryTabs({ on }) {
    const store = useStore();
    const nNames = useMemo(() => namesIndex(store).entries.length, [store.version]);
    return html`<nav class="lib-tabs" aria-label="Library">
      <a href="#/library" class=${cls(on === 'titles' && 'on')} aria-current=${on === 'titles' ? 'page' : undefined}>Titles <span class="count">${store.state.titles.size}</span></a>
      <a href="#/names" class=${cls(on === 'names' && 'on')} aria-current=${on === 'names' ? 'page' : undefined}>Names <span class="count">${nNames.toLocaleString('en-US')}</span></a>
    </nav>`;
  }

  // ── Changes ───────────────────────────────────────────────────────────
  function newHeading(store, fields, label) {
    const file = store.fileForNew('authority');
    const why = store.blocked(file); if (why) { SC.session.say('error', why); return null; }
    const id = ids.newAuthorityID(x => store.state.authorities.has(x));
    const rec = { authorityID: id, spec: [], na: [], speculative: false, _src: file, entryOrder: store.nextEntryOrder(file, 'authority') };
    AENT.fields.forEach(c => { rec[c.key] = ''; });
    Object.assign(rec, { nameType: 'Person', status: 'Needs review' }, fields);
    store.put('authority', rec, label || 'Make heading ' + rec.name);
    return id;
  }
  function addForms(store, a, raws, label) {
    const forms = NM.splitForms(a.variants).concat(raws);
    store.put('authority', Object.assign({}, a, { variants: NM.joinForms(forms) }), label || 'Add ' + plural(raws.length, 'form') + ' to ' + a.name);
  }
  function removeForm(store, a, raw) {
    const k = NM.nameKey(raw);
    store.put('authority', Object.assign({}, a, { variants: NM.joinForms(NM.splitForms(a.variants).filter(f => NM.nameKey(f) !== k)) }), 'Remove ' + raw + ' from ' + a.name);
  }
  // A heading from a group of forms: the suggested form of the fullest name, every form listed.
  function headingFromForms(forms, suggestion) {
    const s = NM.suggestHeading(suggestion || forms[0].raw);
    return { name: suggestion || s.name, nameType: s.nameType, honorifics: s.honorifics, roles: s.roles, variants: NM.joinForms(forms.map(f => f.raw)) };
  }

  // ── Credits under a name ──────────────────────────────────────────────
  function Credits({ store, ix, keys }) {
    const [all, setAll] = useState(false);
    const st = store.state;
    const items = [].concat.apply([], keys.map(k => (ix.forms.get(k) || { items: [] }).items)).map(id => st.contents.get(id)).filter(Boolean);
    const rows = items.map(c => {
      const iss = st.issues.get(c.issueID);
      const tid = R.titleOfContent(st, c);
      const t = st.titles.get(tid);
      return { c, iss, tid, tname: t ? t.canonicalTitle : tid, order: (t ? t.canonicalTitle : tid) + '|' + (iss ? String(iss.entryOrder).padStart(6, '0') : 'zz') + '|' + String(c.sequence).padStart(5, '0') };
    }).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    const shown = all ? rows : rows.slice(0, 60);
    let lastTitle = '';
    return html`<div class="card nm-credits"><h2>Credits <span class="nm-sub">${plural(rows.length, 'item')}</span></h2>
      <ol class="nm-items">${shown.map(r => {
        const head = r.tname !== lastTitle ? html`<li class="nm-title-row"><cite>${r.tname}</cite></li>` : null;
        lastTitle = r.tname;
        const pages = r.c.startPage ? (r.c.endPage && r.c.endPage !== r.c.startPage ? r.c.startPage + '–' + r.c.endPage : r.c.startPage) : '';
        return html`${head}<li key=${r.c.contentID}><a href=${routeHref({ panel: 'contents', titleID: r.tid, issueID: r.c.issueID })}>
          <span class="nm-iss">${r.iss ? issueLabel(r.iss) : r.c.issueID}</span>
          <span class="nm-item">${r.c.itemTitle || '(untitled)'}${pages ? html` <span class="dim">p. ${pages}</span>` : ''}</span>
          <span class="nm-as" title="Credited as">${r.c.author}</span></a></li>`;
      })}</ol>
      ${rows.length > shown.length && html`<button class="link" onClick=${() => setAll(true)}>Show all ${rows.length.toLocaleString('en-US')}</button>`}
    </div>`;
  }

  // Unheaded names that may be this person.
  function possibleForms(ix, heading) {
    const p = NM.parse(heading.name);
    if (!p) return [];
    const letters = (p.initials.join('') + NM.nameKey(p.surname).charAt(0));
    // Compatible names, initialisms that spell the name, and the bare surname ("Public").
    return ix.entries.filter(e => e.kind === 'name').filter(e => {
      const q = NM.parse(e.label);
      if (q) return NM.compatible(p, q);
      if (e.keys[0] === NM.nameKey(p.surname)) return true;
      return NM.isInitialism(e.label) && e.label.replace(/[^A-Za-z]/g, '').toLowerCase() === letters;
    }).slice(0, 12);
  }

  // ── A heading ─────────────────────────────────────────────────────────
  function HeadingDetail({ store, ix, entry }) {
    const a = entry.authority;
    const [q, setQ] = useState('');
    const update = (patch, label) => store.put('authority', Object.assign({}, a, patch), label);
    const listed = new Set(NM.splitForms(a.variants).map(NM.nameKey));
    const own = new Set([NM.nameKey(a.name), NM.nameKey(NM.directOrder(a.name))]);
    const notFound = NM.splitForms(a.variants).filter(f => !ix.forms.has(NM.nameKey(f)));
    const maybe = possibleForms(ix, a);
    const needle = NM.nameKey(q);
    const found = needle.length >= 2 ? ix.entries.filter(e => e.kind === 'name' && e.keys[0].indexOf(needle) !== -1).slice(0, 10) : [];
    const seeAlso = a.seeAlso ? Array.from(store.state.authorities.values()).find(x => x.name === a.seeAlso) : null;
    function remove() {
      if (!confirm('Delete the heading "' + a.name + '"? The credits stay as they are in the contents; you can undo this.')) return;
      store.remove('authority', a.authorityID, 'Delete heading ' + a.name);
      navigate({ panel: 'names', titleID: '' });
    }
    const field = c => html`<${Field} key=${c.key} col=${c} value=${a[c.key]} idPrefix="a-" onCommit=${v => update({ [c.key]: typeof v === 'string' && c.type !== 'long' ? v.trim() : v }, 'Edit ' + c.label.toLowerCase() + ' of ' + a.name)} />`;
    return html`<div class="nm-detail">
      <div class="card entry-card">
        <div class="entry"><p class="entry-main nm-heading">${a.name || '(no heading)'}${a.dates ? html`, <span class="nm-dates">${a.dates}</span>` : ''}</p>
          <p class="entry-sub">${[a.nameType, a.honorifics, a.roles].filter(Boolean).join(' · ')}${seeAlso ? html` · See also <a href=${routeHref({ panel: 'names', titleID: seeAlso.authorityID })}>${seeAlso.name}</a>` : a.seeAlso ? ' · See also ' + a.seeAlso : ''}</p>
          <p class="entry-id"><code>${a.authorityID}</code></p></div>
        <div class="entry-facts"><span>${plural(entry.count, 'credit')}</span><span>${plural(entry.forms.length, 'form')}</span>
          <span class=${cls('nm-status', a.status === 'Confirmed' ? 'ok' : 'review')}>${a.status || 'Needs review'}</span></div>
      </div>
      <fieldset class="card group"><legend>Heading</legend><div class="grid">${AENT.groupFields('name').map(field)}</div></fieldset>
      <div class="card nm-forms">
        <h2>Forms <span class="nm-sub">credits filed under this heading</span></h2>
        <ul class="nm-formlist">${entry.forms.map(f => {
          const k = NM.nameKey(f.raw);
          return html`<li key=${f.raw}><span class="nm-form">${f.raw}</span><span class="nm-n">${f.count}</span>
            ${listed.has(k) ? html`<button class="link" onClick=${() => removeForm(store, a, f.raw)}>Remove</button>` : html`<span class="dim small">${own.has(k) ? 'the heading itself' : ''}</span>`}</li>`;
        })}
          ${notFound.map(f => html`<li key=${'nf' + f}><span class="nm-form dim">${f}</span><span class="nm-n dim">0</span><button class="link" onClick=${() => removeForm(store, a, f)}>Remove</button></li>`)}</ul>
        ${maybe.length > 0 && html`<div class="nm-maybe"><h3>Possibly the same name</h3>
          <ul class="nm-formlist">${maybe.map(e => html`<li key=${e.id}><span class="nm-form">${e.label}</span><span class="nm-n">${e.count}</span>
            <button class="link" onClick=${() => addForms(store, a, e.forms.map(f => f.raw))}>Add</button></li>`)}</ul>
          ${maybe.length > 1 && html`<button class="btn small" onClick=${() => addForms(store, a, [].concat.apply([], maybe.map(e => e.forms.map(f => f.raw))))}>Add all ${maybe.length}</button>`}</div>`}
        <div class="nm-find"><input type="search" placeholder="Find another form to add" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Find a form to add" />
          ${found.length > 0 && html`<ul class="nm-formlist">${found.map(e => html`<li key=${e.id}><span class="nm-form">${e.label}</span><span class="nm-n">${e.count}</span>
            <button class="link" onClick=${() => { addForms(store, a, e.forms.map(f => f.raw)); setQ(''); }}>Add</button></li>`)}</ul>`}</div>
      </div>
      <${Credits} store=${store} ix=${ix} keys=${entry.keys} />
      <details class="card group collapsible"><summary><span class="group-title">More</span> <span class="group-note">roles, honorifics, sources, notes, the list of forms as text</span></summary>
        <div class="grid">${AENT.groupFields('more').concat(AENT.groupFields('forms')).map(field)}</div></details>
      <div class="actions"><button class="btn quiet danger" onClick=${remove}>Delete heading</button>
        <span class="hint">Headings never change the contents: each credit stays as printed.</span></div>
    </div>`;
  }

  // ── A name without a heading ──────────────────────────────────────────
  function NameDetail({ store, ix, entry, groups }) {
    const sug = NM.suggestHeading(entry.label);
    const [name, setName] = useState(sug.name);
    const [q, setQ] = useState('');
    const group = groups.find(g => g.keys.indexOf(entry.keys[0]) !== -1);
    const needle = NM.nameKey(q);
    const heads = ix.entries.filter(e => e.kind === 'heading' && (!needle || NM.nameKey(e.label).indexOf(needle) !== -1)).slice(0, 8);
    function make(forms, heading) {
      const id = newHeading(store, headingFromForms(forms, heading));
      if (id) navigate({ panel: 'names', titleID: id });
    }
    function addTo(e) {
      addForms(store, e.authority, entry.forms.map(f => f.raw));
      navigate({ panel: 'names', titleID: e.id });
    }
    return html`<div class="nm-detail">
      <div class="card entry-card">
        <div class="entry"><p class="entry-main nm-heading nm-raw">${entry.label}</p>
          <p class="entry-sub">No heading yet${entry.forms.length > 1 ? html`. Credited as ${entry.forms.map((f, k) => html`${k ? ', ' : ''}<q>${f.raw}</q>`)}` : ''}.</p></div>
        <div class="entry-facts"><span>${plural(entry.count, 'credit')}</span></div>
      </div>
      <div class="card nm-make">
        <h2>Make a heading</h2>
        <div class="nm-make-row"><input type="text" class="nm-name-input" value=${name} onInput=${e => setName(e.target.value)} aria-label="Heading" />
          <button class="btn primary" disabled=${!name.trim()} onClick=${() => make(entry.forms, name.trim())}>Make heading</button></div>
        <p class="hint">Suggested from <q>${entry.label}</q>: surname first${sug.roles ? ', “' + sug.roles + '” set aside as a role' : ''}${sug.honorifics ? ', “' + sug.honorifics + '” set aside' : ''}. ${sug.nameType !== 'Person' ? 'Read as ' + sug.nameType.toLowerCase() + ', so left as given.' : ''}</p>
      </div>
      ${group && html`<div class="card nm-group">
        <h2>Probably the same name</h2>
        <ul class="nm-formlist">${group.forms.map(f => html`<li key=${f.raw}><span class="nm-form">${f.raw}</span><span class="nm-n">${f.count}</span></li>`)}</ul>
        <div class="actions"><button class="btn" onClick=${() => make(group.forms, group.suggestion)}>Combine as “${group.suggestion}”</button></div>
      </div>`}
      ${ix.entries.some(e => e.kind === 'heading') && html`<div class="card nm-addto">
        <h2>Add to a heading</h2>
        <input type="search" placeholder="Find a heading" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Find a heading" />
        <ul class="nm-formlist">${heads.map(e => html`<li key=${e.id}><span class="nm-form"><b>${e.label}</b></span><span class="nm-n">${e.count}</span>
          <button class="link" onClick=${() => addTo(e)}>Add here</button></li>`)}</ul>
      </div>`}
      <${Credits} store=${store} ix=${ix} keys=${entry.keys} />
    </div>`;
  }

  // ── Suggested matches ─────────────────────────────────────────────────
  function Matches({ store, groups }) {
    const [skip, setSkip] = useState(() => new Set());
    const shown = groups.filter(g => !skip.has(g.keys.join('|'))).slice(0, 80);
    return html`<div class="nm-detail">
      <div class="card"><h2>Suggested matches</h2>
        <p class="hint">Forms that look like one name: the same surname, with forenames and initials that agree. Combining them makes one heading that lists every form; the contents stay as printed. Check each before combining.</p></div>
      ${shown.map(g => html`<div class="card nm-group" key=${g.keys.join('|')}>
        <div class="nm-group-head"><b>${g.suggestion}</b> <span class="nm-sub">${plural(g.count, 'credit')}</span></div>
        <ul class="nm-formlist">${g.forms.map(f => html`<li key=${f.raw}><span class="nm-form">${f.raw}</span><span class="nm-n">${f.count}</span></li>`)}</ul>
        <div class="actions"><button class="btn small primary" onClick=${() => newHeading(store, headingFromForms(g.forms, g.suggestion), 'Combine ' + plural(g.forms.length, 'form') + ' as ' + g.suggestion)}>Combine</button>
          <button class="btn small quiet" onClick=${() => setSkip(new Set(skip).add(g.keys.join('|')))}>Not the same</button></div>
      </div>`)}
      ${!shown.length && html`<p class="empty">No suggested matches.</p>`}
    </div>`;
  }

  // ── The view ──────────────────────────────────────────────────────────
  function NamesPanel({ route }) {
    const store = useStore();
    const st = store.state;
    const ix = useMemo(() => namesIndex(store), [store.version]);
    const groups = useMemo(() => NM.suggestGroups(ix), [ix]);
    const [filter, setFilter] = useState('all');
    const [q, setQ] = useState('');
    const sel = route.titleID;
    const needle = NM.nameKey(q);
    const counts = { all: ix.entries.length, headed: 0, unheaded: 0, review: 0, matches: groups.length };
    ix.entries.forEach(e => { if (e.kind === 'heading') { counts.headed++; if (e.authority.status !== 'Confirmed') counts.review++; } else counts.unheaded++; });
    const list = ix.entries.filter(e => (filter === 'all' || (filter === 'headed' && e.kind === 'heading') || (filter === 'unheaded' && e.kind === 'name') ||
      (filter === 'review' && e.kind === 'heading' && e.authority.status !== 'Confirmed')) &&
      (!needle || NM.nameKey(e.label).indexOf(needle) !== -1 || e.forms.some(f => NM.nameKey(f.raw).indexOf(needle) !== -1)));
    // The list is one stop for Tab: the name chosen, else the first; the arrow keys move along it.
    const tabStop = list.slice(0, LIST_MAX).some(e => e.id === sel) ? sel : list.length ? list[0].id : '';
    const entry = sel ? ix.entries.find(e => e.id === sel) : null;
    const credits = ix.entries.reduce((n, e) => n + e.count, 0);
    let detail;
    if (filter === 'matches') detail = html`<${Matches} store=${store} groups=${groups} />`;
    else if (entry && entry.kind === 'heading') detail = html`<${HeadingDetail} key=${entry.id} store=${store} ix=${ix} entry=${entry} />`;
    else if (entry) detail = html`<${NameDetail} key=${entry.id} store=${store} ix=${ix} entry=${entry} groups=${groups} />`;
    else if (sel && st.authorities.has(sel)) detail = html`<${HeadingDetail} key=${sel} store=${store} ix=${ix} entry=${{ id: sel, kind: 'heading', label: st.authorities.get(sel).name, keys: [], forms: [], count: 0, authority: st.authorities.get(sel) }} />`;
    else detail = html`<div class="card nm-intro"><h2>Names</h2>
      <p>Every name credited in the contents of this library, ${plural(ix.entries.length, 'name')} in ${plural(credits, 'credit')}. A heading gathers the forms one person is credited under (<q>J.Q.P.</q>, <q>Jno. Q. Public</q>) and is the form the name files under in an index (<q>Public, John Q.</q>).</p>
      <p>Choose a name to make or extend a heading, or look at <button class="link" onClick=${() => setFilter('matches')}>${plural(groups.length, 'suggested match', 'suggested matches')}</button>. Headings are kept in <code>${R.defaultFileName('authority', st.library.slug)}</code>; the contents always keep each credit as printed.</p></div>`;

    return html`<section class="names">
      <header class="lib-head"><div><h1 class="lib-name">${st.library.name || st.library.slug}</h1></div></header>
      <${LibraryTabs} on="names" />
      ${ix.conflicts.length > 0 && html`<div class="message warn" role="status"><span>${plural(ix.conflicts.length, 'form')} ${ix.conflicts.length === 1 ? 'is' : 'are'} listed under two headings, and ${ix.conflicts.length === 1 ? 'files' : 'file'} under the first: ${ix.conflicts.slice(0, 4).map((c, k) => html`${k ? '; ' : ''}${(st.authorities.get(c.authorityIDs[0]) || {}).name} and ${(st.authorities.get(c.authorityIDs[1]) || {}).name}`)}.</span></div>`}
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Show">${[['all', 'All'], ['headed', 'Headings'], ['unheaded', 'No heading'], ['review', 'Needs review'], ['matches', 'Suggested matches']].map(([k, l]) =>
          html`<button class=${cls('seg-btn', filter === k && 'on')} aria-pressed=${filter === k} onClick=${() => setFilter(k)}>${l} <span class="count">${counts[k].toLocaleString('en-US')}</span></button>`)}</div>
        ${filter !== 'matches' && html`<input class="search" type="search" placeholder="Find a name" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Find a name" />`}
      </div>
      <div class="nm-layout">
        ${filter !== 'matches' && html`<aside class="nm-list card" aria-label="Names">
          <ol title="The arrow keys move from name to name" onKeyDown=${e => rovingKeys(e)}>${list.slice(0, LIST_MAX).map(e => html`<li key=${e.id}><a href=${routeHref({ panel: 'names', titleID: e.id })} class=${cls('nm-row', e.kind, e.id === sel && 'on')}
            tabIndex=${e.id === tabStop ? 0 : -1}>
            <span class="nm-label">${e.label}</span><span class="nm-n">${e.count.toLocaleString('en-US')}</span>
            ${(e.kind === 'heading' && e.forms.length > 1) || e.forms.length > 1 ? html`<span class="nm-forms">${plural(e.forms.length, 'form')}</span>` : ''}
            ${e.kind === 'heading' && e.authority.status !== 'Confirmed' ? html`<span class="nm-flag">review</span>` : ''}</a></li>`)}</ol>
          ${list.length > LIST_MAX && html`<p class="hint nm-more">Showing ${LIST_MAX} of ${list.length.toLocaleString('en-US')}. Find a name to narrow the list.</p>`}
          ${!list.length && html`<p class="empty">No names match.</p>`}
        </aside>`}
        <div class=${cls('nm-main', filter === 'matches' && 'wide')}>${detail}</div>
      </div>
    </section>`;
  }

  SC.views = Object.assign(SC.views || {}, { NamesPanel, LibraryTabs });
})(globalThis.SC = globalThis.SC || {});
