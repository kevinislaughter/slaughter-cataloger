/* Slaughter Cataloger 3 — application shell. */
(function (SC) {
  'use strict';
  const { html, useEffect, useStore, useSessionUI, useRoute, navigate, plural, cls, Message } = SC.ui;
  const V = SC.views, session = SC.session;

  const STAGES = [
    { id: 'library', n: '1', label: 'Library' },
    { id: 'issues', n: '2', label: 'Issues' },
    { id: 'contents', n: '3', label: 'Contents' },
    { id: 'compiler', n: '4', label: 'Compiler' }
  ];

  function Rail({ route, loaded }) {
    const href = id => '#/' + id + (id !== 'library' && id !== 'guide' && route.titleID && route.titleID !== 'new' ? '/' + encodeURIComponent(route.titleID) + (route.issueID ? '/' + encodeURIComponent(route.issueID) : '') : '');
    return html`<nav class="rail" aria-label="Stages">
      <div class="brand"><svg class="brand-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg><span class="brand-name">Slaughter<br /> Cataloger</span><span class="ver">3.0</span></div>
      <ol class="stages">${STAGES.map(s => {
        const on = route.panel === s.id || (s.id === 'library' && route.panel === 'names');     // Names is part of Library
        return html`<li><a href=${loaded ? href(s.id) : '#/library'} class=${cls('stage', on && 'on', !loaded && s.id !== 'library' && 'off')}
        aria-current=${on ? 'page' : undefined} aria-disabled=${!loaded && s.id !== 'library' ? 'true' : undefined}><span class="n">${s.n}</span>${s.label}</a></li>`;
      })}</ol>
      <a href="#/guide" class=${cls('stage guide-link', route.panel === 'guide' && 'on')}>Guide</a>
    </nav>`;
  }

  function TopBar({ route }) {
    const store = useStore();
    const ui = useSessionUI();
    const n = store.dirty.size;
    return html`<header class="topbar">
      <div class="where">${store.state.library.name || store.state.library.slug}${ui.mode === 'folder' && html`<span class="folder">${ui.folderName}</span>`}</div>
      ${route.panel !== 'search' && V.SearchBox && html`<${V.SearchBox} route=${route} />`}
      <div class="doing">
        <button class="btn small" disabled=${!store.canUndo} title=${store.canUndo ? 'Undo: ' + store.undoLabel : 'Nothing to undo'} onClick=${() => store.undo()}>Undo</button>
        <button class="btn small" disabled=${!store.canRedo} title=${store.canRedo ? 'Redo: ' + store.redoLabel : 'Nothing to redo'} onClick=${() => store.redo()}>Redo</button>
        <span class=${cls('save-state', n && 'dirty')}>${n ? plural(n, 'file') + ' changed' : 'All changes saved'}</span>
        <button class=${cls('btn', n ? 'primary' : '')} disabled=${!n || !!ui.busy} onClick=${() => session.save()}
          title=${n ? Array.from(store.dirty).join('\n') : ''}>${ui.mode === 'files' ? 'Download changed files' : 'Save'}</button>
      </div>
    </header>`;
  }

  function ReconnectBanner() {
    const ui = useSessionUI();
    if (!ui.needsReconnect) return null;
    const when = ui.restoredAt ? new Date(ui.restoredAt).toLocaleString() : '';
    if (ui.wrongFolder) return html`<div class="message error" role="status"><span>${ui.wrongFolder}</span>
      <button class="btn small primary" onClick=${() => session.chooseFolder()}>Choose folder</button></div>`;
    return html`<div class="message warn" role="status"><span>Your work${when ? ' (last change ' + when + ')' : ''} is restored from this browser. Allow access to <strong>${ui.folderName}</strong> to save and to pick up changes made to the files elsewhere.</span>
      <span class="actions-inline"><button class="btn small primary" onClick=${() => session.reconnect()}>Allow access</button>
      <button class="btn small" onClick=${() => session.chooseFolder()}>Choose folder</button></span></div>`;
  }

  // Downloads are not saves: the files stay changed until you say they replaced the old ones.
  function DownloadBanner() {
    const ui = useSessionUI();
    const d = ui.download;
    if (!d) return null;
    return html`<div class="message warn download-banner" role="status"><span>Downloaded ${plural(d.names.length, 'file')}: ${d.names.join(', ')}.
      They count as saved once they have replaced the old copies in your library folder (check your Downloads folder; the browser may have renamed a file it already had).
      Until then the changes stay marked unsaved here.</span>
      <span class="actions-inline"><button class="btn small primary" onClick=${() => session.confirmDownload()}>I've replaced the files</button>
      <button class="link" onClick=${() => session.dismissDownload()}>Not yet</button></span></div>`;
  }

  function StorageProblem() {
    const ui = useSessionUI();
    if (!ui.storageProblem || ui.mode === 'none') return null;
    return html`<div class="message error" role="alert"><span>Your changes are not being kept in this browser (${ui.storageProblem}). If this tab closes, unsaved changes are lost: ${ui.mode === 'folder' ? 'save' : 'download the changed files'} now and often until this message goes away.</span></div>`;
  }

  // Only one tab works on the library at a time.
  function AccessScreen({ access }) {
    if (access === 'checking') return html`<section class="welcome"><p class="lede">Starting…</p></section>`;
    if (access === 'elsewhere') return html`<section class="welcome">
      <h1>Already open in another tab</h1>
      <p class="lede">Slaughter Cataloger is open in another tab or window of this browser. Only one at a time can work on your library, so that one does not overwrite the other's changes.</p>
      <div class="welcome-actions"><button class="btn primary" onClick=${() => session.takeOver()}>Use this tab instead</button></div>
      <p class="fine">The other tab stops working on the library. Every change it made was kept in this browser as it was made, so this tab carries on from there; only a change made in the very moment of switching could miss it.</p>
    </section>`;
    return html`<section class="welcome">
      <h1>Opened in another tab</h1>
      <p class="lede">Your library is now open in another tab or window. This one has stopped, so the two cannot overwrite each other's changes. The other tab has every change this one had kept in the browser when it took over; a change made here after that moment was not kept.</p>
      <div class="welcome-actions"><button class="btn" onClick=${() => location.reload()}>Use this tab again</button></div>
    </section>`;
  }

  function App() {
    const route = useRoute();
    const store = useStore();
    const ui = useSessionUI();
    const loaded = ui.mode !== 'none';

    useEffect(() => {
      const onKey = e => {
        const mod = e.metaKey || e.ctrlKey;
        // "/" goes to the search box, unless the focus is somewhere that takes typing.
        if (e.key === '/' && !mod && !e.altKey) {
          const el = document.activeElement || {};
          const takesText = el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
            (el.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file|image)$/.test(el.type || ''));
          const box = document.getElementById('search-q') || document.getElementById('top-search');
          if (!takesText && box) { e.preventDefault(); box.focus(); box.select && box.select(); }
          return;
        }
        // Alt+Page Up / Page Down: previous / next issue of the title, in any stage.
        if (e.altKey && !mod && (e.key === 'PageUp' || e.key === 'PageDown')) {
          const r = SC.ui.parseRoute();
          const list = r.titleID ? store.issuesOfTitle(r.titleID) : [];
          const pos = list.findIndex(i => i.issueID === r.issueID);
          const next = pos === -1 ? null : list[pos + (e.key === 'PageUp' ? -1 : 1)];
          if (next && ['issues', 'contents'].indexOf(r.panel) !== -1) {
            e.preventDefault();
            const el = document.activeElement;
            // The place is kept: the same field of the next issue, or the same column of its first item.
            const fieldId = el && /^f-/.test(el.id || '') ? el.id : '';
            const col = el && el.getAttribute && el.getAttribute('data-cell') ? el.getAttribute('data-cell').split(':').pop() : '';
            const oldGrid = col ? el.closest('table.grid-toc') : null;
            if (el && el.blur && el !== document.body) el.blur();          // commit what is being typed
            navigate({ panel: r.panel, titleID: r.titleID, issueID: next.issueID });
            if (fieldId || col) {
              const until = Date.now() + 1500;
              const refocus = () => {
                const t = fieldId ? document.getElementById(fieldId) : document.querySelector('table.grid-toc [data-cell$=":' + col + '"]');
                if (t && t !== el && t.isConnected && !(oldGrid && oldGrid.contains(t))) { if (!t.disabled) t.focus(); }
                else if (Date.now() < until) requestAnimationFrame(refocus);
              };
              requestAnimationFrame(refocus);
            }
          }
          return;
        }
        if (!mod) return;
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); if (store.dirty.size) session.save(); return; }
        // In a field with nothing typed yet, undo means the last change to the library;
        // with text typed and not yet committed, it means the browser's own text undo.
        const el = document.activeElement || {};
        const textBox = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|number|)$/.test(el.type || ''));
        const typing = textBox && (!el.hasAttribute('data-sc-field') || el.getAttribute('data-pending') === 'true');
        if (typing) return;
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
        else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); store.redo(); }
      };
      // Changes are already in the browser's working copy; this only warns that files are unsaved.
      // Text typed in a field and not yet committed is in no working copy, so it is warned about
      // too: leaving would lose it (D-K2).
      const onUnload = e => {
        if (SC.session.ui.access !== 'owner') return;
        // A new issue being entered and not recorded is in no working copy either (K-D1).
        const draft = SC.drafts && SC.drafts.changed().length;
        if (store.dirty.size || document.querySelector('[data-pending="true"]') || draft) { e.preventDefault(); e.returnValue = ''; }
      };
      window.addEventListener('keydown', onKey);
      window.addEventListener('beforeunload', onUnload);
      return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); };
    }, []);

    useEffect(() => { document.title = (store.state.library.name ? store.state.library.name + ' — ' : '') + 'Slaughter Cataloger'; }, [store.state.library.name]);

    // The top bar, the context bar, the grid's tools and the actions under a form stay in view as the page
    // scrolls (not in a window too short for them: app.css). How tall they are depends on how they wrap, so
    // it is measured: each bar is placed under the ones above it, and a field reached with Tab is scrolled
    // clear of them (scroll-padding), never left hidden beneath one.
    useEffect(() => {
      const root = document.documentElement, SEL = ['.topbar', '.context-bar', '.grid-tools', '.sticky-actions'];
      let raf = 0, watched = [];
      const last = {};                       // set a height only when it changes: each setting makes the page be laid out again
      const later = () => { if (!raf) raf = requestAnimationFrame(measure); };
      const ro = new ResizeObserver(later), mo = new MutationObserver(later);
      const stuck = e => (e && getComputedStyle(e).position === 'sticky' ? e.getBoundingClientRect().height : 0);
      function measure() {
        raf = 0;
        const els = SEL.map(s => document.querySelector(s));
        watched.filter(e => els.indexOf(e) === -1).forEach(e => ro.unobserve(e));
        els.forEach(e => { if (e && watched.indexOf(e) === -1) ro.observe(e); });
        watched = els.filter(Boolean);
        const [top, ctx, tools, foot] = els.map(stuck);
        // Rounded down, so that a bar overlaps the one above it by a fraction of a pixel rather than leave a gap.
        [['--top-h', top], ['--stick', top + ctx], ['--stick-pad', top + ctx + tools], ['--stick-foot', foot]].forEach(([k, v]) => {
          const px = Math.floor(v) + 'px';
          if (last[k] !== px) { last[k] = px; root.style.setProperty(k, px); }
        });
      }
      mo.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
      window.addEventListener('resize', later);
      measure();
      return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', later); if (raf) cancelAnimationFrame(raf); };
    }, []);

    let body;
    if (ui.access !== 'owner' && route.panel !== 'guide') {
      return html`<div class="shell"><${Rail} route=${route} loaded=${false} /><div class="main-col"><main class="main"><${AccessScreen} access=${ui.access} /></main></div></div>`;
    }
    if (route.panel === 'guide') body = html`<${V.GuidePanel} />`;
    else if (!loaded) body = html`<${V.Welcome} />`;
    else if (route.panel === 'issues') body = html`<${V.IssuesPanel} route=${route} />`;
    else if (route.panel === 'contents') body = html`<${V.ContentsPanel} route=${route} />`;
    else if (route.panel === 'compiler') body = html`<${V.CompilerPanel} route=${route} />`;
    else if (route.panel === 'names') body = html`<${V.NamesPanel} route=${route} />`;
    else if (route.panel === 'search') body = html`<${V.SearchPanel} route=${route} />`;
    else body = html`<${V.LibraryPanel} route=${route} />`;

    // The Compiler chooses its own titles, one or several, so it has no context bar.
    const showContext = loaded && ['issues', 'contents'].indexOf(route.panel) !== -1;
    return html`<div class="shell">
      <${Rail} route=${route} loaded=${loaded} />
      <div class="main-col">
        ${loaded && html`<${TopBar} route=${route} />`}
        ${showContext && html`<${V.ContextBar} route=${route} />`}
        <main class="main">
          <${StorageProblem} />
          <${ReconnectBanner} />
          <${DownloadBanner} />
          <${Message} msg=${ui.message} onClose=${() => session.dismissMessage()} />
          ${ui.busy && html`<div class="message info" role="status">${ui.busy}</div>`}
          ${body}
        </main>
      </div>
    </div>`;
  }

  async function start() {
    const root = document.getElementById('app');
    try { await session.init(); } catch (e) { console.error(e); }
    globalThis.preact.render(html`<${App} />`, root);
  }

  SC.start = start;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})(globalThis.SC = globalThis.SC || {});
