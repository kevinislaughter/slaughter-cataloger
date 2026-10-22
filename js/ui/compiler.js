/* Slaughter Cataloger 3 — Stage 4: Compiler.
   Choose titles (one or several), an output and its options; the preview follows every
   choice. Download, Copy and Open build the whole output from the same view model as
   the preview. This is the only place the app exports anything other than its CSVs. */
(function (SC) {
  'use strict';
  const { html, useState, useEffect, useMemo, useRef, useStore, plural, cls } = SC.ui;
  const C = SC.catalog, O = SC.outputs, R = SC.records;

  const OUTPUTS = [
    { id: 'checklist', label: 'Checklist', desc: 'The run as a list to tick off, as a web page, Markdown or plain text.' },
    { id: 'catalog', label: 'Catalog', desc: 'Titles, issues and their contents as one standalone web page.' },
    { id: 'wordpress', label: 'WordPress', desc: 'The catalog as blocks to paste into the WordPress code editor.' },
    { id: 'proofing', label: 'Proofing catalog', desc: 'A printable sheet for each issue, for checking the records against the issues in hand.' },
    { id: 'names', label: 'Name index', desc: 'Every credited name, filed under its heading, with each credit and see-references from other forms.' },
    { id: 'ris', label: 'RIS', desc: 'One record per contents item, for Zotero and other reference managers.' },
    { id: 'bibtex', label: 'BibTeX', desc: 'One entry per contents item, for JabRef.' }
  ];
  const DEFAULTS = {
    checklist: Object.assign({}, O.CHECKLIST),
    catalog: { nested: false, types: true, itemNotes: false, evidence: false, marks: true },
    wordpress: { nested: false, types: true, marks: true },
    proofing: { nested: true },
    names: Object.assign({ nested: true }, O.NAMES),
    ris: { nested: true, headings: true },
    bibtex: { nested: true, headings: true }
  };
  // The preview holds the first 25 issues of a title, and fewer of each when several are chosen
  // (at least one each): with many titles at 25 each, it was the whole library, and a proofing
  // catalog of 1,000 issues kept the page busy for five seconds and more while it was laid out.
  const PREVIEW_ISSUES = 25;
  const previewLimit = n => Math.max(1, Math.floor(PREVIEW_ISSUES / Math.max(1, n)));
  const MIME = { html: 'text/html', md: 'text/markdown', txt: 'text/plain', ris: 'application/x-research-info-systems', bib: 'application/x-bibtex' };

  function loadPrefs() { try { return JSON.parse(localStorage.getItem('sc3.compiler') || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem('sc3.compiler', JSON.stringify(p)); } catch (e) { /* a convenience only */ } }

  const extOf = (output, o) => (output === 'checklist' || output === 'names' ? o.format : O.TYPES[output].ext);
  const isPage = (output, o) => output === 'catalog' || output === 'proofing' || ((output === 'checklist' || output === 'names') && o.format === 'html');

  // Titles in the order outputs list them (alphabetical), then titles that have issues or contents but no title record.
  function titleList(store) {
    const st = store.state;
    const ids = new Set(st.titles.keys());
    st.issues.forEach(i => ids.add(i.titleID));
    st.contents.forEach(c => { const t = R.titleOfContent(st, c); if (t) ids.add(t); });
    return C.titleOrder(st, Array.from(ids)).map(id => {
      const t = st.titles.get(id) || null;
      return { id, name: t ? t.canonicalTitle || id : id, rec: t, issues: store.issuesOfTitle(id).length, items: store.contentsOfTitle(id).length };
    });
  }
  // The files a title's records live in, for the proofing summary.
  function filesFor(store, tids) {
    const out = {};
    tids.forEach(tid => {
      const iss = store.issuesOfTitle(tid), con = store.contentsOfTitle(tid);
      out[tid] = { issues: iss.length ? iss[0]._src : '', contents: con.length ? con[0]._src : '' };
    });
    return out;
  }
  function make(store, vm, output, o) {
    if (output === 'checklist') return O.checklist(vm, o);
    if (output === 'catalog') return O.catalog(vm, o);
    if (output === 'wordpress') return O.wordpress(vm, o);
    if (output === 'proofing') return O.proofing(vm, Object.assign({}, o, { files: filesFor(store, vm.titles.map(t => t.id)) }));
    if (output === 'names') return O.names(vm, o);
    if (output === 'ris') return O.ris(vm, o);
    return O.bibtex(vm, o);
  }

  // ── Small controls ────────────────────────────────────────────────────
  function Check({ o, k, label, set, hint }) {
    return html`<label class="check cmp-opt" title=${hint || ''}><input type="checkbox" checked=${!!o[k]} onChange=${e => set(k, e.target.checked)} /> ${label}</label>`;
  }
  function Seg({ value, choices, onChange, label }) {
    return html`<div class="cmp-seg-row"><span class="cmp-seg-label">${label}</span><div class="seg" role="group" aria-label=${label}>${choices.map(([v, l]) =>
      html`<button type="button" class=${cls('seg-btn', value === v && 'on')} aria-pressed=${value === v} onClick=${() => onChange(v)}>${l}</button>`)}</div></div>`;
  }

  function Options({ output, o, set }) {
    const c = (k, label, hint) => html`<${Check} o=${o} k=${k} label=${label} set=${set} hint=${hint} />`;
    if (output === 'checklist') return html`
      <${Seg} label="Format" value=${o.format} onChange=${v => set('format', v)} choices=${[['html', 'Web page'], ['md', 'Markdown'], ['txt', 'Plain text']]} />
      <${Seg} label="Style" value=${o.style} onChange=${v => set('style', v)} choices=${[['plain', 'Plain'], ['bibliographic', 'Bibliographic'], ['technical', 'IssueID first']]} />
      <div class="cmp-opts">
        ${c('checkboxes', 'Checkboxes')}${c('marks', 'Mark uncertain values [1872?]')}
        ${c('pages', 'Pages')}${c('size', 'Size')}${c('price', 'Price')}${c('publisher', 'Place and publisher')}${c('printer', 'Printer')}
        ${c('designation', 'Designation, supplement, edition')}${c('evidence', 'Evidence, when reported')}${c('subtitle', 'Subtitle')}${c('notes', 'Notes on issue')}${c('issueID', 'IssueID')}
      </div>`;
    if (output === 'catalog' || output === 'wordpress') return html`<div class="cmp-opts">
        ${c('nested', 'Nested items', 'Items that are part of another item, such as poems in a section')}
        ${c('types', 'Content types')}${c('marks', 'Mark uncertain values [1872?]')}
        ${output === 'catalog' && c('itemNotes', 'Notes on items')}${output === 'catalog' && c('evidence', 'Evidence and evidence notes')}
      </div>`;
    if (output === 'proofing') return html`<p class="hint">Every field of every title, issue and item, with blank and N/A fields shown. Each issue starts a new printed page.</p>`;
    if (output === 'names') return html`
      <${Seg} label="Format" value=${o.format} onChange=${v => set('format', v)} choices=${[['html', 'Web page'], ['md', 'Markdown'], ['txt', 'Plain text']]} />
      <${Seg} label="Names without a heading" value=${o.unheaded} onChange=${v => set('unheaded', v)} choices=${[['suggest', 'Surname first'], ['asis', 'As credited']]} />
      <div class="cmp-opts">${c('see', 'See-references from other forms', 'J.Q.P. see Public, John Q.')}${c('forms', 'Forms each name was credited under')}${c('marks', 'Mark uncertain values [1872?]')}</div>
      <p class="hint">Headings come from Library › Names. A name without one files under the form a heading would take, unless you choose As credited.</p>`;
    return html`<div class="cmp-opts">${c('nested', 'Nested items', 'Items that are part of another item, such as poems in a section')}
      ${c('headings', 'Authors as headings where there is one', 'Public, John Q. rather than J.Q.P.; the credit as printed goes in a note')}</div>
      <p class="hint">${output === 'ris' ? 'Import into Zotero with File › Import. ' : 'Open in JabRef, or import with File › Import into current library. '}TitleID, IssueID and ContentID go with each record, so items can be traced back.</p>`;
  }

  // ── The stage ─────────────────────────────────────────────────────────
  function CompilerPanel({ route }) {
    const store = useStore();
    const slug = store.state.library.slug;
    const prefs = useMemo(loadPrefs, []);
    const titles = useMemo(() => titleList(store), [store.version]);
    const exists = id => titles.some(t => t.id === id);
    const [sel, setSel] = useState(() => {
      if (route.titleID && exists(route.titleID)) return [route.titleID];
      return prefs.lib === slug && Array.isArray(prefs.sel) ? prefs.sel.filter(exists) : [];
    });
    // A title named in the address is chosen, also when the address changes with the Compiler open (DF-17).
    useEffect(() => { if (route.titleID && exists(route.titleID) && !(sel.length === 1 && sel[0] === route.titleID)) setSel([route.titleID]); }, [route.titleID]);
    const [output, setOutput] = useState(() => (OUTPUTS.some(x => x.id === prefs.output) ? prefs.output : 'catalog'));
    const [opts, setOpts] = useState(() => {
      const o = {};
      Object.keys(DEFAULTS).forEach(k => { o[k] = Object.assign({}, DEFAULTS[k], (prefs.opts || {})[k]); });
      return o;
    });
    const [scope, setScope] = useState({ mode: 'all', keys: null });
    const [copied, setCopied] = useState('');
    // Bring the first chosen title into view in the list.
    const listRef = useRef(null);
    useEffect(() => {
      const list = listRef.current, el = list && list.querySelector('.cmp-title.on');
      if (el) list.scrollTop = el.offsetTop - list.offsetTop - 4;
    }, []);
    useEffect(() => { savePrefs({ lib: slug, sel, output, opts }); }, [slug, sel.join(','), output, JSON.stringify(opts)]);
    useEffect(() => { setScope({ mode: 'all', keys: null }); }, [sel.join(',')]);

    const o = opts[output];
    const setOpt = (k, v) => setOpts(Object.assign({}, opts, { [output]: Object.assign({}, o, { [k]: v }) }));
    const toggle = id => setSel(sel.indexOf(id) !== -1 ? sel.filter(x => x !== id) : sel.concat(id));
    const one = sel.length === 1 ? sel[0] : '';
    const groups = useMemo(() => (one ? C.scopeGroups(store, one) : []), [one, store.version]);
    const keys = scope.keys || new Set(groups.map(g => g.key));
    const issueIDs = one && scope.mode === 'some' ? new Set([].concat.apply([], groups.filter(g => keys.has(g.key)).map(g => g.issueIDs))) : null;
    const args = { titleIDs: sel, issueIDs, nested: o.nested !== false };
    const ext = extOf(output, o);

    const preview = useMemo(() => {
      if (!sel.length) return null;
      const vm = C.build(store, Object.assign({}, args, { limit: previewLimit(sel.length) }));
      return { vm, text: make(store, vm, output, o), name: O.filename(vm, output, ext) };
    }, [store.version, sel.join(','), output, JSON.stringify(o), issueIDs ? Array.from(issueIDs).join(',') : 'all']);

    function full() {
      const vm = C.build(store, Object.assign({}, args, { date: preview ? preview.vm.date : new Date() }));
      return { text: make(store, vm, output, o), name: O.filename(vm, output, ext), vm };
    }
    function download() {
      const f = full();
      SC.storage.download(f.name, f.text, MIME[ext] || 'text/plain');
      SC.session.say('ok', 'Downloaded ' + f.name + '.');
    }
    function copy() {
      const f = full();
      const done = () => { setCopied('Copied'); setTimeout(() => setCopied(''), 2500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(f.text).then(done, () => setCopied('Copy failed'));
      else setCopied('Copy failed');
    }
    function openPage() {
      const f = full();
      const url = URL.createObjectURL(new Blob([f.text], { type: 'text/html;charset=utf-8' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // What the person should know about this output.
    const notes = [];
    if (preview) {
      const vm = preview.vm;
      sel.filter(id => !store.state.titles.has(id)).forEach(id => notes.push(id + ' is not in the Titles file, so its issues are compiled without title-level values.'));
      const loose = sel.reduce((n, tid) => n + store.contentsOfTitle(tid).filter(c => !store.state.issues.has(c.issueID)).length, 0);
      if (loose) notes.push(plural(loose, 'contents item') + (loose === 1 ? ' belongs to an issue not in any Issues file and is left out.' : ' belong to issues not in any Issues file and are left out.'));
      if ((output === 'ris' || output === 'bibtex') && !vm.counts.contents) notes.push('There are no contents items in this selection, so the file would be empty.');
      if (!vm.counts.issues) notes.push('There are no issues in this selection.');
      const gone = Array.from(store.state.files.values()).filter(f => f.missing || f.unreadable);
      if (gone.length) notes.push('Includes records kept from ' + plural(gone.length, 'file') + ' that ' + (gone.length === 1 ? 'is' : 'are') + ' missing from the folder or no longer read' + (gone.length === 1 ? 's' : '') + ' cleanly (' + gone.map(f => f.name).join(', ') + '); see the Library page.');
      const kept = Array.from(store.state.files.values()).reduce((n, f) => n + ((f.setAside && f.setAside.length) || 0), 0);
      if (kept) notes.push(plural(kept, 'row') + ' that could not be taken in (see the Library page) ' + (kept === 1 ? 'is' : 'are') + ' not in outputs.');
    }
    const counts = preview ? preview.vm.counts : null;
    const shownIssues = preview ? preview.vm.titles.reduce((n, t) => n + t.issues.length, 0) : 0;

    return html`<section class="compiler">
      <div class="panel-head"><h1 class="panel-title">Compiler</h1></div>
      <div class="cmp-layout">
        <div class="cmp-settings">
          <div class="card cmp-block">
            <div class="cmp-block-head"><h2>Titles <span class="cmp-sel">${sel.length} of ${titles.length}</span></h2>
              <span class="cmp-tools"><button type="button" class="link" onClick=${() => setSel(titles.map(t => t.id))}>All</button>
              <button type="button" class="link" onClick=${() => setSel([])}>None</button></span></div>
            <ul class="cmp-titles" ref=${listRef}>${titles.map(t => html`<li key=${t.id}><label class=${cls('cmp-title', sel.indexOf(t.id) !== -1 && 'on')}>
              <input type="checkbox" checked=${sel.indexOf(t.id) !== -1} onChange=${() => toggle(t.id)} />
              <span class="ct-name">${t.name}${!t.rec && html` <span class="tag">not in Titles file</span>`}</span>
              <span class="ct-count">${plural(t.issues, 'issue')}${t.items ? ' · ' + plural(t.items, 'item') : ''}</span></label></li>`)}</ul>
          </div>
          <div class="card cmp-block">
            <h2>Output</h2>
            <div class="cmp-outputs" role="radiogroup" aria-label="Output">${OUTPUTS.map(x => html`<label key=${x.id} class=${cls('cmp-output', output === x.id && 'on')}>
              <input type="radio" name="cmp-output" checked=${output === x.id} onChange=${() => setOutput(x.id)} />
              <span class="co-label">${x.label}</span>${output === x.id && html`<span class="co-desc">${x.desc}</span>`}</label>`)}</div>
          </div>
          ${one && groups.length > 1 && html`<div class="card cmp-block">
            <h2>Issues</h2>
            <label class="check cmp-opt"><input type="radio" name="cmp-scope" checked=${scope.mode === 'all'} onChange=${() => setScope({ mode: 'all', keys: null })} /> The whole run</label>
            <label class="check cmp-opt"><input type="radio" name="cmp-scope" checked=${scope.mode === 'some'} onChange=${() => setScope({ mode: 'some', keys })} /> Some ${groups[0].key.indexOf('vol:') === 0 ? 'volumes' : 'years'}</label>
            ${scope.mode === 'some' && html`<div class="cmp-groups">
              <span class="cmp-tools"><button type="button" class="link" onClick=${() => setScope({ mode: 'some', keys: new Set(groups.map(g => g.key)) })}>All</button>
                <button type="button" class="link" onClick=${() => setScope({ mode: 'some', keys: new Set() })}>None</button></span>
              ${groups.map(g => html`<label key=${g.key} class="check cmp-opt"><input type="checkbox" checked=${keys.has(g.key)}
                onChange=${e => { const k = new Set(keys); if (e.target.checked) k.add(g.key); else k.delete(g.key); setScope({ mode: 'some', keys: k }); }} />
                ${g.label} <span class="dim">· ${plural(g.issueIDs.length, 'issue')}</span></label>`)}</div>`}
          </div>`}
          <div class="card cmp-block">
            <h2>Options</h2>
            <${Options} output=${output} o=${o} set=${setOpt} />
          </div>
        </div>
        <div class="cmp-preview">
          ${!preview ? html`<div class="card cmp-empty"><p class="empty">Choose one or more titles to compile.</p></div>` : html`
            <div class="cmp-bar">
              <div class="cmp-file"><code>${preview.name}</code>
                <span class="cmp-counts">${plural(counts.titles, 'title')} · ${plural(counts.issues, 'issue')}${counts.contents ? ' · ' + plural(counts.contents, 'contents item') : ''}</span></div>
              <div class="cmp-actions">
                ${copied && html`<span class="hint">${copied}</span>`}
                <button type="button" class="btn small" onClick=${copy}>Copy</button>
                ${isPage(output, o) && html`<button type="button" class="btn small" onClick=${openPage} title="Open the whole output in a new tab, to read or print">Open</button>`}
                <button type="button" class="btn primary" onClick=${download}>Download</button>
              </div>
            </div>
            ${notes.length > 0 && html`<ul class="cmp-notes">${notes.map(n => html`<li>${n}</li>`)}</ul>`}
            ${preview.vm.partial && html`<p class="cmp-partial">The preview shows the first ${sel.length > 1 ? plural(previewLimit(sel.length), 'issue') + ' of each title, ' + plural(shownIssues, 'issue') + ' of ' + counts.issues.toLocaleString('en-US') : plural(shownIssues, 'issue') + ' of ' + counts.issues.toLocaleString('en-US')}. Download, Copy and Open include them all.</p>`}
            ${isPage(output, o)
              ? html`<iframe class="cmp-frame" title="Preview" sandbox="" srcdoc=${preview.text}></iframe>`
              : html`<pre class="cmp-text">${preview.text.length > 200000 ? preview.text.slice(0, 200000) + '\n…' : preview.text}</pre>`}`}
        </div>
      </div>
    </section>`;
  }

  SC.views = Object.assign(SC.views || {}, { CompilerPanel });
  SC.compiler = { OUTPUTS, DEFAULTS, titleList, make };
})(globalThis.SC = globalThis.SC || {});
