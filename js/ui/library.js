/* Slaughter Cataloger 3 — Stage 1: Library (welcome, dashboard, title editor). */
(function (SC) {
  'use strict';
  const { html, useState, useEffect, useMemo, useRef, useStore, useSessionUI, navigate, fmt, plural, cls, fieldState, toggleState, Field, issueLabel } = SC.ui;
  const S = SC.schema, R = SC.records, ids = SC.ids, session = SC.session;
  const TENT = S.entities.title;

  // ── Welcome: nothing loaded yet ───────────────────────────────────────
  function Welcome() {
    const [creating, setCreating] = useState(false);
    const [drag, setDrag] = useState(false);
    const files = useRef(null);         // Load CSV files is a button that opens this input: a label round it is not reached with Tab
    const start = useRef(null);         // Cancel on the new library's form brings the focus back here
    const onDrop = e => { e.preventDefault(); setDrag(false); session.loadFiles(e.dataTransfer.files); };
    return html`<section class="welcome" onDragOver=${e => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)} onDrop=${onDrop}>
      <h1>Slaughter Cataloger</h1>
      <p class="lede">A catalog of serial publications — titles, their issues, and what appears in each issue — kept as CSV files in a folder you own.</p>
      ${!creating && html`<div class="welcome-actions">
        ${SC.storage.supportsFolders && html`<button class="btn primary" onClick=${() => session.openFolder()}>Open library folder</button>`}
        <button class="btn" onClick=${() => files.current && files.current.click()}>Load CSV files</button>
        <input ref=${files} type="file" multiple accept=".csv,text/csv" hidden onChange=${e => session.loadFiles(e.target.files)} />
        <button class="btn quiet" ref=${start} onClick=${() => setCreating(true)}>Start a new library</button>
      </div>`}
      ${creating && html`<${NewLibrary} onCancel=${() => { setCreating(false); setTimeout(() => start.current && start.current.focus(), 0); }} />`}
      <div class=${cls('dropzone', drag && 'over')}>Or drop your library's CSV files here.</div>
      ${SC.storage.supportsFolders
        ? html`<p class="fine">With a folder open, Save writes your changes straight back into the CSV files, and the previous version of each file is kept in a <code>_backups</code> folder inside it.</p>`
        : html`<p class="fine">This browser can't save into a folder, so you'll load files and download the changed ones. In Chrome or Edge, Save writes straight into your library folder.</p>`}
    </section>`;
  }

  function NewLibrary({ onCancel }) {
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [slugTouched, setSlugTouched] = useState(false);
    const [note, setNote] = useState('');
    const autoSlug = n => n.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const s = slugTouched ? slug : autoSlug(name);
    const valid = name.trim() && ids.RE.slug.test(s);
    const go = async useFolder => { if (valid && await session.newLibrary(s, name.trim(), note.trim(), useFolder)) navigate({ panel: 'library', titleID: 'new' }); };
    useEffect(() => { const el = document.getElementById('nl-name'); if (el) el.focus(); }, []);   // the button that opened the form is gone
    return html`<div class="card narrow">
      <h2>New library</h2>
      <div class="grid">
        <div class="field span-2"><div class="field-head"><label for="nl-name">Library name</label></div>
          <input id="nl-name" type="text" value=${name} onInput=${e => setName(e.target.value)} placeholder="e.g. Example Library" /></div>
        <div class="field span-2"><div class="field-head"><label for="nl-slug" title="Uppercase letters, numbers and hyphens. Part of every file name and every row; it cannot be changed later.">Library slug</label></div>
          <input id="nl-slug" type="text" value=${s} onInput=${e => { setSlugTouched(true); setSlug(e.target.value.toUpperCase()); }} placeholder="EXAMPLE-LIBRARY" />
          ${s && !ids.RE.slug.test(s) && html`<div class="field-note bad">Use A–Z, 0–9 and single hyphens.</div>`}</div>
        <div class="field span-4"><div class="field-head"><label for="nl-note">Note</label></div>
          <input id="nl-note" type="text" value=${note} onInput=${e => setNote(e.target.value)} placeholder="What this library collects" /></div>
      </div>
      <div class="actions">
        ${SC.storage.supportsFolders && html`<button class="btn primary" disabled=${!valid} onClick=${() => go(true)}>Choose an empty folder for it</button>`}
        <button class=${cls('btn', !SC.storage.supportsFolders && 'primary')} disabled=${!valid} onClick=${() => go(false)}>${SC.storage.supportsFolders ? 'Start without a folder' : 'Start library'}</button>
        <button class="btn quiet" onClick=${onCancel}>Cancel</button>
      </div>
    </div>`;
  }

  // ── Progress per title ────────────────────────────────────────────────
  function titleStats(store, t) {
    const issues = store.issuesOfTitle(t.titleID);
    const contents = store.contentsOfTitle(t.titleID);
    let covered = 0;
    issues.forEach(i => { if (store.contentsOfIssue(i.issueID).length) covered++; });
    const known = parseInt(t.knownIssues, 10) || 0;
    const years = issues.map(i => parseInt(i.year, 10)).filter(y => !isNaN(y));
    const span = years.length ? [Math.min.apply(null, years), Math.max.apply(null, years)] : null;
    let stage = 'none';
    if (issues.length) stage = (known && issues.length >= known && covered >= issues.length) ? 'complete' : 'progress';
    return { issues: issues.length, contents: contents.length, covered, known, span, stage };
  }

  // ── Dashboard ─────────────────────────────────────────────────────────
  function Dashboard() {
    const store = useStore();
    const ui = useSessionUI();
    const st = store.state;
    const [filter, setFilter] = useState('all');
    const [q, setQ] = useState('');
    const [sort, setSort] = useState({ key: 'title', dir: 1 });
    const [editLib, setEditLib] = useState(false);

    const rows = useMemo(() => Array.from(st.titles.values()).map(t => ({ t, s: titleStats(store, t) })), [store.version]);
    const totals = rows.reduce((a, r) => { a.i += r.s.issues; a.c += r.s.contents; return a; }, { i: 0, c: 0 });
    const orphanIssues = st.issues.size - totals.i;
    const needle = q.trim().toLowerCase();
    const shown = rows.filter(r => (filter === 'all' || r.s.stage === filter) &&
      (!needle || (r.t.canonicalTitle + ' ' + r.t.titleID + ' ' + (r.t.subtitle || '')).toLowerCase().indexOf(needle) !== -1));
    const key = {
      title: r => (r.t.canonicalTitle || '').replace(/^(the|a|an|der|die|das|le|la|les|il|l')\s+/i, '').toLowerCase(),
      // Statuses in the order of the work (as the editor lists them), a title with none as Not started (as shown); others last.
      id: r => r.t.titleID, year: r => r.t.firstYear, status: r => { const k = S.CATALOGING_STATUS.indexOf(r.t.catalogingStatus || 'Not started'); return k === -1 ? S.CATALOGING_STATUS.length : k; },
      issues: r => r.s.issues, contents: r => r.s.contents, coverage: r => r.s.issues ? r.s.covered / r.s.issues : -1
    }[sort.key];
    shown.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    // Each heading sorts by its column; a button, so the keyboard can sort too.
    const th = (k, label, extra) => html`<th class=${cls(extra, 'sortable', sort.key === k && 'sorted')} aria-sort=${sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" class="sort" onClick=${() => setSort(sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: 1 })}>${label}</button></th>`;
    const counts = { all: rows.length, none: 0, progress: 0, complete: 0 };
    rows.forEach(r => counts[r.s.stage]++);

    return html`<section>
      <header class="lib-head">
        <div>
          <h1 class="lib-name">${st.library.name || st.library.slug || 'Untitled library'}</h1>
          <div class="lib-meta"><code>${st.library.slug}</code>
            <span>${ui.mode === 'folder' ? 'Folder: ' + ui.folderName : ui.mode === 'files' ? 'Loaded from files; Save downloads changed files' : ''}</span></div>
          ${st.library.note && html`<p class="lib-note">${st.library.note}</p>`}
        </div>
        <div class="lib-actions">
          <button class="btn primary" onClick=${() => navigate({ panel: 'library', titleID: 'new' })}>Add title</button>
          <button class="btn quiet" onClick=${() => setEditLib(!editLib)}>Library details</button>
          ${SC.storage.supportsFolders && html`<button class="btn quiet" onClick=${() => session.openFolder()}>Open another folder</button>`}
          <button class="btn quiet" onClick=${() => session.closeLibrary()}>Close library</button>
        </div>
      </header>
      ${SC.views.LibraryTabs && html`<${SC.views.LibraryTabs} on="titles" />`}
      ${editLib && html`<${LibraryDetails} onDone=${() => setEditLib(false)} />`}
      <p class="summary">${plural(st.titles.size, 'title')}, ${plural(st.issues.size, 'issue')} and ${plural(st.contents.size, 'contents item')}.
        ${orphanIssues > 0 && html` <span class="warn-text">${plural(orphanIssues, 'issue')} ${orphanIssues === 1 ? 'belongs to a title' : 'belong to titles'} missing from the Titles file.</span>`}</p>
      ${ui.needsConversion && ui.needsConversion.length > 0 && html`<div class="message warn" role="status"><span>${plural(ui.needsConversion.length, 'file')} in the Beta 2 format ${ui.needsConversion.length === 1 ? 'was' : 'were'} not loaded and ${ui.needsConversion.length === 1 ? 'has' : 'have'} not been changed. Convert ${ui.needsConversion.length === 1 ? 'it' : 'them'} to 3.0 to include ${ui.needsConversion.length === 1 ? 'it' : 'them'} (see the Guide).</span></div>`}
      <${FileProblems} />
      <${SplitRuns} />
      <${LoadReport} report=${ui.report} />
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Show">
          ${[['all', 'All'], ['none', 'No issues yet'], ['progress', 'In progress'], ['complete', 'Complete']].map(([k, l]) =>
            html`<button class=${cls('seg-btn', filter === k && 'on')} aria-pressed=${filter === k} onClick=${() => setFilter(k)}>${l} <span class="count">${counts[k]}</span></button>`)}
        </div>
        <input class="search" type="search" placeholder="Find a title" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Find a title" />
      </div>
      <div class="table-wrap">
        <table class="shelf">
          <thead><tr>
            ${th('title', 'Title')}${th('id', 'TitleID')}${th('year', 'From', 'num')}${th('status', 'Cataloging status')}
            ${th('issues', 'Issues', 'num')}${th('contents', 'Contents', 'num')}${th('coverage', 'Issues with contents')}<th><span class="vh">Open</span></th>
          </tr></thead>
          <tbody>${shown.map(({ t, s }) => html`<tr key=${t.titleID} class="row-link" onClick=${e => { if (!e.target.closest('a')) navigate({ panel: 'library', titleID: t.titleID }); }}>
            <td><div class="t-name"><a class="row-main" href=${'#/library/' + encodeURIComponent(t.titleID)}>${t.canonicalTitle || '(untitled)'}</a></div>${t.subtitle && html`<div class="t-sub">${t.subtitle}</div>`}</td>
            <td><code>${t.titleID}</code></td>
            <td class="num">${t.firstYear}${s.span && s.span[1] !== parseInt(t.firstYear, 10) ? '–' + s.span[1] : ''}</td>
            <td>${t.catalogingStatus || 'Not started'}</td>
            <td class="num">${s.issues ? fmt(s.issues) : '—'}${s.known ? html`<span class="of"> of ${fmt(s.known)}</span>` : ''}</td>
            <td class="num">${s.contents ? fmt(s.contents) : '—'}</td>
            <td>${s.issues ? html`<div class="meter" title=${s.covered + ' of ' + s.issues + ' issues have contents'}><span style=${'width:' + Math.round(100 * s.covered / s.issues) + '%'}></span></div><span class="meter-n">${Math.round(100 * s.covered / s.issues)}%</span>` : ''}</td>
            <td class="go"><a href=${'#/issues/' + encodeURIComponent(t.titleID)} onClick=${e => e.stopPropagation()}>Issues</a></td>
          </tr>`)}</tbody>
        </table>
        ${!shown.length && html`<p class="empty">${rows.length ? 'No titles match.' : 'No titles yet. Add the first title to begin.'}</p>`}
      </div>
    </section>`;
  }

  function LibraryDetails({ onDone }) {
    const store = useStore();
    const lib = store.state.library;
    const nameCol = { key: 'name', header: 'Title Library Name', label: 'Library name', span: 2, type: 'text', states: false };
    const noteCol = { key: 'note', header: 'Title Library Note', label: 'Note', span: 2, type: 'text', states: false };
    return html`<div class="card">
      <div class="grid">
        <${Field} col=${nameCol} value=${lib.name} onCommit=${v => store.setLibrary({ name: v.trim() }, 'Rename library')} />
        <${Field} col=${noteCol} value=${lib.note} onCommit=${v => store.setLibrary({ note: v.trim() }, 'Edit library note')} />
        <div class="field span-4"><div class="field-head"><label>Library slug</label></div><code class="static">${lib.slug}</code>
          <div class="field-note">Written into every row and file name, so it is fixed once the library exists.</div></div>
      </div>
      <div class="actions"><button class="btn" onClick=${onDone}>Done</button></div>
    </div>`;
  }

  // Files that need a look: gone from the folder, no longer readable, or holding rows the app
  // keeps as they are without loading them. Stays until the cause is gone.
  function FileProblems() {
    const store = useStore();
    const [open, setOpen] = useState(false);
    const files = Array.from(store.state.files.values());
    const missing = files.filter(f => f.missing), unreadable = files.filter(f => f.unreadable && !f.missing), kept = files.filter(f => f.setAside && f.setAside.length);
    if (!missing.length && !unreadable.length && !kept.length) return null;
    const rows = kept.reduce((n, f) => n + f.setAside.length, 0);
    return html`<div class="file-problems">
      ${missing.length > 0 && html`<div class="message error" role="status"><div>
        <strong>${plural(missing.length, 'file')} ${missing.length === 1 ? 'is' : 'are'} no longer in the folder.</strong> ${missing.length === 1 ? 'Its' : 'Their'} records are still here and in outputs, but nothing is written to ${missing.length === 1 ? 'that name' : 'those names'} until the file is back (then use Reconnect, or reload).
        <ul>${missing.map(f => html`<li key=${f.name}><code>${f.name}</code> <button class="link" onClick=${() => session.forgetFile(f.name)}>Remove from library…</button></li>`)}</ul></div></div>`}
      ${unreadable.length > 0 && html`<div class="message warn" role="status"><div>
        <strong>${plural(unreadable.length, 'file')} in the folder no longer ${unreadable.length === 1 ? 'reads' : 'read'} cleanly.</strong> The records read from ${unreadable.length === 1 ? 'it' : 'them'} before are kept here. Correct the file, then reload or reconnect.
        <ul>${unreadable.map(f => html`<li key=${f.name}><code>${f.name}</code> <span class="why">${f.unreadable}</span></li>`)}</ul></div></div>`}
      ${kept.length > 0 && html`<div class="message warn" role="status"><div>
        <strong>${plural(rows, 'row')} in ${plural(kept.length, 'file')} could not be taken in.</strong> They are kept exactly as they are and written back (at the end of the file) whenever the file is saved, so nothing is lost. To use such a row, correct it in the file — for a repeated ID, clear the ID cell and the app gives the row a new one — then open the folder again.
        <button class="link" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? 'Hide' : 'Show'} the rows</button>
        ${open && html`<ul>${kept.map(f => f.setAside.map((x, k) => html`<li key=${f.name + k}><code>${f.name}</code> row ${x.row}: <span class="why">${x.reason}</span></li>`))}</ul>`}</div></div>`}
    </div>`;
  }

  // Titles whose issues are in more than one Issues file (DF-22). Such a run is shown file by file,
  // the files in the order the store gives them, which comes from their names. This names each
  // such title, its files in exactly that order and the issues each holds, and changes nothing.
  // It is worked out from the records as they are, so it is right after opening, reloading or any change.
  function splitRuns(store) {
    const st = store.state;
    const tids = Array.from(new Set(Array.from(st.issues.values()).map(i => i.titleID)));
    const out = [];
    SC.catalog.titleOrder(st, tids).forEach(tid => {
      const parts = [];
      store.issuesOfTitle(tid).forEach(i => {
        const p = parts[parts.length - 1];
        if (p && p.file === i._src) p.issues.push(i); else parts.push({ file: i._src, issues: [i] });
      });
      if (parts.length > 1) out.push({ titleID: tid, title: st.titles.get(tid) || null, parts });
    });
    return out;
  }
  function SplitRuns() {
    const store = useStore();
    const runs = splitRuns(store);
    if (!runs.length) return null;
    const n = runs.length;
    const span = list => issueLabel(list[0]) + (list.length > 1 ? ' to ' + issueLabel(list[list.length - 1]) : '');
    const why = ' Such a run is shown file by file: the files in the order listed here, and the issues of each file in their order in that file.' +
      ' The order of the files comes from their names, not from the issues’ dates or numbers, so it may not be the order in which the issues were published.' +
      ' Nothing has been reordered, merged or changed.';
    return html`<div class="message warn split-runs" role="status"><div>
      <strong>${plural(n, 'title')} ${n === 1 ? 'has its' : 'have their'} issues in more than one Issues file.</strong>${why}
      <ul>${runs.map(r => html`<li key=${r.titleID}><strong>${(r.title && r.title.canonicalTitle) || r.titleID}</strong> <code>${r.titleID}</code>: ${plural(r.parts.reduce((k, p) => k + p.issues.length, 0), 'issue')} in ${r.parts.length} files, shown in this order:
        <ol>${r.parts.map(p => html`<li key=${p.file}><code>${p.file}</code>: ${plural(p.issues.length, 'issue')}, ${span(p.issues)}</li>`)}</ol></li>`)}</ul>
      If an order is wrong: save, rename the files outside the app so that their names sort in run order (<code>…_ISSUES_01.csv</code>, <code>…_ISSUES_02.csv</code> and so on), and open the library again.</div></div>`;
  }

  function LoadReport({ report }) {
    const [open, setOpen] = useState(false);
    if (!report || !report.length) return null;
    const serious = report.filter(r => r.level === 'skip' || r.level === 'error' || r.level === 'warn');
    const label = serious.length ? plural(serious.length, 'note') + ' from loading ' + (serious.length === 1 ? 'needs' : 'need') + ' a look' : plural(report.length, 'note') + ' from loading';
    return html`<div class=${cls('report', serious.length && 'has-serious')}>
      <button class="link" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? 'Hide' : 'Show'} ${label}</button>
      ${open && html`<ul>${report.map(r => html`<li class=${'lvl-' + r.level}><span class="lvl">${{ skip: 'Not loaded', error: 'Problem', warn: 'Check', info: 'Note', ok: 'OK' }[r.level] || r.level}</span>
        ${r.file && html`<code>${r.file}</code>`} ${r.msg}</li>`)}</ul>`}
    </div>`;
  }

  // ── The catalog entry, typeset from the record ────────────────────────
  // Uncertain values appear in brackets with a question mark, as in a printed bibliography.
  function Entry({ t, span }) {
    const v = (key, text) => {
      const col = TENT.byKey.get(key);
      const val = text != null ? text : t[key];
      if (!val) return null;
      return (t.spec || []).indexOf(col.header) !== -1 ? SC.ui.uncertain(val) : val;
    };
    const place = [v('city'), t.state && v('state'), t.country && v('country')].filter(Boolean);
    const years = t.firstYear ? (span && span[1] > (parseInt(t.firstYear, 10) || 0) ? t.firstYear + '–' + span[1] : t.firstYear + '–') : '';
    const join = (parts, sep) => parts.filter(Boolean).reduce((acc, p, i) => i ? acc.concat([sep, p]) : [p], []);
    return html`<div class="entry">
      <p class="entry-main"><cite>${t.canonicalTitle || 'Untitled'}</cite>${t.subtitle && html`: ${v('subtitle')}`}.
        ${(place.length || t.publisher || years) && html` ${join(place, ', ')}${place.length && t.publisher ? ': ' : ''}${v('publisher')}${years && (place.length || t.publisher ? ', ' : '')}${years && v('firstYear', years)}.`}
        ${t.editors && html` Edited by ${v('editors')}.`}
        ${t.frequency && html` ${v('frequency', t.frequency.charAt(0).toUpperCase() + t.frequency.slice(1))}.`}
        ${t.issn && html` ISSN ${v('issn')}.`}</p>
      ${(t.formerTitles || t.laterTitles || t.originalTitle) && html`<p class="entry-sub">
        ${t.originalTitle && html`Began as <cite>${v('originalTitle')}</cite>. `}
        ${t.formerTitles && html`Formerly <cite>${v('formerTitles')}</cite>. `}
        ${t.laterTitles && html`Continued as <cite>${v('laterTitles')}</cite>.`}</p>`}
      <p class="entry-id"><code>${t.titleID || 'TitleID assigned when added'}</code></p>
    </div>`;
  }

  // ── Title editor ──────────────────────────────────────────────────────
  function TitleEditor({ titleID }) {
    const store = useStore();
    const st = store.state;
    const isNew = titleID === 'new';
    const existing = st.titles.get(titleID);
    const [draft, setDraft] = useState(() => ({ titleID: '', titleCode: '', firstYear: '', canonicalTitle: '', catalogingStatus: 'Not started', spec: [], na: [], speculative: false,
      language: '', country: '' }));
    const [codeTouched, setCodeTouched] = useState(false);
    if (!isNew && !existing) return html`<section><p><a href="#/library">Library</a></p><p class="empty">No title ${titleID} in this library.</p></section>`;

    const rec = isNew ? draft : existing;
    const issueCount = isNew ? 0 : store.issuesOfTitle(titleID).length;
    const contentCount = isNew ? 0 : store.contentsOfTitle(titleID).length;
    // The library's name, note and slug are kept in the rows of the Titles file, so its last title
    // cannot be deleted (DF-19); the page says so instead of hiding the button.
    const onlyTitle = !isNew && st.titles.size === 1;
    const span = isNew ? null : titleStats(store, existing).span;
    const takenCodes = new Set(Array.from(st.titles.values()).map(t => t.titleCode));

    function update(patch, label) {
      if (isNew) {
        const next = Object.assign({}, draft, patch);
        if (!codeTouched && 'canonicalTitle' in patch) next.titleCode = ids.suggestTitleCode(next.canonicalTitle, takenCodes);
        next.titleID = ids.titleIDOf(next.titleCode, next.firstYear);
        setDraft(next);
      } else {
        store.put('title', Object.assign({}, existing, patch), label);
      }
    }
    const commit = col => v => {
      if (col.key === 'titleCode') { setCodeTouched(true); v = v.trim().toUpperCase(); }
      if (col.key === 'firstYear') v = v.trim().toUpperCase();
      update({ [col.key]: typeof v === 'string' && col.type !== 'long' ? v.replace(/\s+$/, '') : v }, 'Edit ' + col.label.toLowerCase());
    };
    const toggle = col => which => update(toggleState(TENT, rec, col, which), (which === 'spec' ? 'Mark ? on ' : 'Mark N/A on ') + col.label.toLowerCase());

    const codeErr = rec.titleCode && !ids.RE.titleCode.test(rec.titleCode) ? 'Eight characters, A–Z and 0–9.' :
      (isNew && rec.titleCode && takenCodes.has(rec.titleCode) ? 'Another title already uses this code.' : '');
    const yearErr = rec.firstYear && !ids.RE.firstYear.test(rec.firstYear) ? 'YYYY, or X for unknown digits: 189X, 18XX, XXXX.' : '';
    const canAdd = isNew && rec.canonicalTitle.trim() && ids.RE.titleCode.test(rec.titleCode) && ids.RE.firstYear.test(rec.firstYear) && !takenCodes.has(rec.titleCode) && !st.titles.has(rec.titleID);
    const lockedIDs = !isNew;
    const unaddressed = TENT.fields.filter(c => c.states && SC.ui.isUnaddressed(c, rec[c.key], fieldState(rec, c))).length;

    function add() {
      const file = store.fileForNew('title');
      const why = store.blocked(file); if (why) { SC.session.say('error', why); return; }
      const t = Object.assign({}, draft, { titleID: ids.titleIDOf(draft.titleCode, draft.firstYear), _src: file, entryOrder: store.nextEntryOrder(file, 'title') });
      TENT.fields.forEach(c => { if (t[c.key] === undefined) t[c.key] = ''; });
      // Issues already here for this TitleID (read while their title was missing) are settled
      // against it in the same step, as reading the files again would settle them.
      store.batch('Add title ' + t.canonicalTitle, () => {
        store.put('title', t);
        SC.records.settleIssues(store.state, t).forEach(i => store.put('issue', i));
      });
      navigate({ panel: 'library', titleID: t.titleID }, true);
    }
    function remove() {
      if (store.state.titles.size <= 1) return;
      if (!confirm('Delete the title record "' + existing.canonicalTitle + '"? You can undo this until you close the app.')) return;
      store.remove('title', existing.titleID, 'Delete title ' + existing.canonicalTitle);
      navigate({ panel: 'library', titleID: '' });
    }

    return html`<section class="editor">
      <h1 class="vh">${isNew ? 'New title' : 'Title: ' + (rec.canonicalTitle || rec.titleID)}</h1>
      <nav class="crumbs"><a href="#/library">${st.library.name || 'Library'}</a> <span aria-hidden="true">/</span> ${isNew ? 'New title' : rec.canonicalTitle}</nav>
      <div class="card entry-card">
        <${Entry} t=${rec} span=${span} />
        <div class="entry-facts">
          ${!isNew && html`<span>${plural(issueCount, 'issue')} recorded${existing.knownIssues ? ' of ' + existing.knownIssues + ' known' : ''}</span>
          <span>${plural(contentCount, 'contents item')}</span>
          <a href=${'#/issues/' + encodeURIComponent(titleID)}>Open issues</a>`}
          <span class=${cls('unaddr-count', unaddressed && 'some')}>${unaddressed ? plural(unaddressed, 'field') + ' not yet addressed' : 'Every field addressed'}</span>
        </div>
        ${!isNew && SC.views.RunStrip && html`<${SC.views.RunStrip} titleID=${titleID} target="issues" />`}
      </div>
      ${S.TITLE_GROUPS.map(g => html`<fieldset class="card group">
        <legend>${g.label}</legend>
        <div class="grid">
          ${TENT.groupFields(g.id).map(c => {
            const locked = lockedIDs && (c.key === 'titleCode' || c.key === 'firstYear');
            return html`<${Field} key=${c.key} col=${c} value=${rec[c.key]} state=${fieldState(rec, c)} onCommit=${commit(c)} onToggle=${toggle(c)}
              readOnly=${locked && c.key === 'titleCode'} valueLocked=${locked && c.key === 'firstYear'}
              invalid=${c.key === 'titleCode' ? codeErr : c.key === 'firstYear' ? yearErr : ''}
              note=${locked ? (c.key === 'titleCode' ? 'Part of the permanent TitleID ' + rec.titleID + '.' : 'Year is part of the TitleID; marking it ? is still possible.') : (c.key === 'titleCode' && isNew && !codeTouched ? 'Suggested from the title.' : '')} />`;
          })}
        </div>
      </fieldset>`)}
      <div class="actions sticky-actions">
        ${isNew ? html`<button class="btn primary" disabled=${!canAdd} onClick=${add}>Add title</button>
            <button class="btn quiet" onClick=${() => navigate({ panel: 'library', titleID: '' })}>Cancel</button>
            ${!canAdd && html`<span class="hint">Needs a canonical title, an eight-character title code and a first year.</span>`}`
          : html`<button class="btn" onClick=${() => navigate({ panel: 'library', titleID: '' })}>Back to library</button>
            ${!issueCount && !contentCount && (onlyTitle
              ? html`<button class="btn quiet danger" disabled aria-describedby="last-title-note">Delete title</button>
                <span class="hint last-title" id="last-title-note">This is the library's only title, so it cannot be deleted: the library's name, note and slug are kept with the titles in the Titles file. Add another title first if this one should go.</span>`
              : html`<button class="btn quiet danger" onClick=${remove}>Delete title</button>`)}
            <span class="hint">Changes are kept as you go. Save writes them to your files.</span>`}
      </div>
    </section>`;
  }

  function LibraryPanel({ route }) {
    useStore();
    if (route.titleID) return html`<${TitleEditor} key=${route.titleID} titleID=${route.titleID} />`;
    return html`<${Dashboard} />`;
  }

  SC.views = Object.assign(SC.views || {}, { Welcome, LibraryPanel, LoadReport, Entry, titleStats });
})(globalThis.SC = globalThis.SC || {});
