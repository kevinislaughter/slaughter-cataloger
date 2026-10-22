/* Slaughter Cataloger 3 — UI kit: rendering, hooks, routing, and the
   schema-driven field used by every form. */
(function (SC) {
  'use strict';
  const { h, Fragment } = globalThis.preact;
  const { useState, useEffect, useRef, useMemo, useCallback } = globalThis.preactHooks;
  const html = globalThis.htm.bind(h);
  const S = SC.schema, R = SC.records;

  // Re-render when the store or session changes.
  function useStore() {
    const store = SC.session.store;
    const [, setV] = useState(store.version);
    useEffect(() => store.subscribe(v => setV(v)), []);
    return store;
  }
  function useSessionUI() {
    const [, setN] = useState(0);
    useEffect(() => SC.session.subscribeUI(() => setN(n => n + 1)), []);
    return SC.session.ui;
  }

  // ── Routing: #/panel/titleID/issueID[/itemID][?query] ─────────────────
  // itemID: a contents item to show, in #/contents/<TitleID>/<IssueID>/<ContentID>.
  // query: only the search panel has one: #/search?q=…&kind=…&order=…&from=…
  const PANELS = ['library', 'names', 'issues', 'contents', 'compiler', 'guide', 'search'];
  const decode = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  function parseRoute() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    const qi = h.indexOf('?');
    const parts = (qi === -1 ? h : h.slice(0, qi)).split('/').map(decode);
    const panel = PANELS.indexOf(parts[0]) !== -1 ? parts[0] : 'library';
    const query = {};
    if (panel === 'search' && qi !== -1) new URLSearchParams(h.slice(qi + 1)).forEach((v, k) => { query[k] = v; });
    return { panel, titleID: parts[1] || '', issueID: parts[2] || '', itemID: panel === 'contents' ? parts[3] || '' : '', query };
  }
  function routeHref(r) {
    const path = [r.panel, r.titleID, r.issueID, r.panel === 'contents' && r.issueID ? r.itemID : ''].filter((x, i) => i === 0 || x).map(encodeURIComponent).join('/');
    const q = r.panel === 'search' && r.query ? Object.keys(r.query).filter(k => r.query[k] !== undefined && r.query[k] !== '').map(k => k + '=' + encodeURIComponent(r.query[k])).join('&') : '';
    return '#/' + path + (q ? '?' + q : '');
  }
  function navigate(r, replace) {
    const cur = parseRoute();
    const next = Object.assign({}, cur, r);
    if (r.panel && r.titleID === undefined) next.titleID = cur.titleID;
    // An item to show and a search query belong to one visit: they never carry over.
    next.itemID = r.itemID || '';
    next.query = r.query || (next.panel === 'search' && cur.panel === 'search' && r.panel === undefined ? cur.query : null);
    const href = routeHref(next);
    if (href === location.hash) return;
    if (replace) history.replaceState(null, '', href); else location.hash = href;
    if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  function useRoute() {
    const [route, setRoute] = useState(parseRoute());
    useEffect(() => {
      const on = () => setRoute(parseRoute());
      window.addEventListener('hashchange', on);
      return () => window.removeEventListener('hashchange', on);
    }, []);
    return route;
  }

  // ── Small helpers ─────────────────────────────────────────────────────
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const plural = (n, one, many) => fmt(n) + ' ' + (n === 1 ? one : (many || one + 's'));
  const cls = (...xs) => xs.filter(Boolean).join(' ');

  // Field states. spec / na hold canonical CSV headers.
  function fieldState(rec, col) {
    const spec = (rec.spec || []).indexOf(col.header) !== -1;
    const na = (rec.na || []).indexOf(col.header) !== -1;
    return { spec, na };
  }
  // Returns a patch for the record after toggling '?' or 'N/A' on a field.
  function toggleState(ent, rec, col, which) {
    let spec = (rec.spec || []).slice(), na = (rec.na || []).slice();
    const has = (arr) => arr.indexOf(col.header) !== -1;
    const without = (arr) => arr.filter(x => x !== col.header);
    const patch = {};
    if (which === 'spec') {
      if (has(spec)) spec = without(spec); else { spec.push(col.header); na = without(na); }
    } else {
      if (has(na)) na = without(na); else { na.push(col.header); spec = without(spec); patch[col.key] = ''; }
    }
    patch.spec = R.orderStates(ent, spec);
    patch.na = R.orderStates(ent, na);
    patch.speculative = patch.spec.length > 0;
    return patch;
  }
  // Uncertain value, bibliographic style: "1872" -> "[1872?]"; an already supplied "[Untitled]" -> "[Untitled?]".
  function uncertain(v) {
    const t = String(v == null ? '' : v);
    const m = /^\[(.*)\]$/.exec(t.trim());
    return html`<span class="unc">[${m ? m[1] : t}${/\?$/.test(m ? m[1] : t) ? '' : '?'}]</span>`;
  }
  // How an issue is named in lists: its short name, else its numbers.
  const issueLabel = i => i.shortname || [i.volume && 'Vol. ' + i.volume, i.issue && 'No. ' + i.issue, i.number && 'Whole No. ' + i.number].filter(Boolean).join(', ') || i.issueDesignation || i.issueID || 'New issue';
  // "May 18, 1872", "March–April 1965", "Dec–Jan 1964–1965"; the printed date when nothing else is known.
  function issueDate(i) {
    const y = i.year ? (i.yearEnd && i.yearEnd !== i.year ? i.year + '–' + i.yearEnd : i.year) : '';
    const md = [i.months, i.day].filter(Boolean).join(' ');
    return (md && y ? md + (i.day ? ', ' : ' ') + y : md || y) || i.datePrinted || '';
  }
  const isUnaddressed = (col, value, st) => col.states && !st.spec && !st.na && String(value == null ? '' : value).trim() === '';

  // A long run of links is one stop for Tab (the run beside an issue, the strip, the Names list): only one
  // of its links is in the Tab order, at first the one open (or the first link), and the arrow keys, Home and End move
  // along it; Enter opens, as for any link. Given rowSel (the strip's rows), Up and Down move to the
  // row above or below, keeping the place in the row as far as it goes.
  function rovingKeys(e, rowSel) {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    if ((!step && e.key !== 'Home' && e.key !== 'End') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const box = e.currentTarget, links = Array.from(box.querySelectorAll('a[href]'));
    const at = links.indexOf(document.activeElement);
    if (at === -1) return;
    let to = e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : at + step;
    if (rowSel && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const rows = Array.from(box.querySelectorAll(rowSel)).map(r => Array.from(r.querySelectorAll('a[href]'))).filter(r => r.length);
      const r = rows.findIndex(row => row.indexOf(links[at]) !== -1), row = rows[r + step];
      to = row ? links.indexOf(row[Math.min(rows[r].indexOf(links[at]), row.length - 1)]) : at;
    }
    e.preventDefault();
    to = Math.max(0, Math.min(links.length - 1, to));
    links.forEach((a, k) => { a.tabIndex = k === to ? 0 : -1; });
    links[to].focus();
  }

  // ── Field ─────────────────────────────────────────────────────────────
  /* props: col, value, state {spec,na}, onCommit(v), onToggle(which), placeholder,
            readOnly, note (small text under the input), invalid (message),
            inheritedValue (issues: the title's value, shown when this record has none of its own),
            onReset (go back to the inherited value), children (shown under the input) */
  function Field(p) {
    const col = p.col, st = p.state || { spec: false, na: false };
    const str = v => v == null ? '' : String(v);
    // While the person is typing, the field shows what they typed; otherwise it shows the record's
    // value, so changes from outside (undo, a suggestion, the next draft) appear at once. Only typing
    // is committed: leaving a field you did not type in never writes to the record.
    const [draft, setDraft] = useState(str(p.value));
    const typed = useRef(false);
    // The record's value changed from outside (Undo, Redo, a suggestion) while the field held typing
    // that left it as it was (typed and deleted again, or taken back with the browser's own undo):
    // nothing of the person's is waiting, so the field shows the new value and leaving it writes
    // nothing. Before, it kept showing the old text and wrote it back on leaving, which silently
    // reversed an Undo (D-K1). Typing that differs from the record still wins, as before.
    const seen = useRef(str(p.value));
    if (str(p.value) !== seen.current) {
      if (typed.current && draft === seen.current) typed.current = false;
      seen.current = str(p.value);
    }
    const shown = typed.current ? draft : str(p.value);
    const commit = (v) => { typed.current = false; if (String(v) !== str(p.value)) p.onCommit(v); else setDraft(str(p.value)); };
    const id = 'f-' + (p.idPrefix || '') + col.key;
    const inheriting = p.inheritedValue !== undefined && !st.na && str(p.value) === '';
    const overriding = p.inheritedValue !== undefined && !inheriting;
    const unaddressed = !p.readOnly && !inheriting && isUnaddressed(col, p.value, st);
    const common = {
      id, disabled: p.readOnly || p.valueLocked || st.na, title: col.tip || '',
      'data-sc-field': '', 'data-pending': typed.current && draft !== str(p.value) ? 'true' : undefined,
      onBlur: (e) => { if (typed.current) commit(e.target.value); },
      onInput: (e) => { typed.current = true; setDraft(e.target.value); },
      onKeyDown: (e) => {
        if (e.key === 'Escape') { typed.current = false; setDraft(str(p.value)); e.target.blur(); }
        if (e.key === 'Enter' && col.type !== 'long') { e.preventDefault(); if (typed.current) commit(e.target.value); }
      }
    };
    let input;
    if (col.type === 'enum') {
      const opts = col.options.slice();
      if (p.value && opts.indexOf(p.value) === -1) opts.push(p.value);   // keep values the list does not know
      input = html`<select id=${id} disabled=${p.readOnly} value=${p.value || ''} onChange=${e => p.onCommit(e.target.value)}>
        ${!col.required && html`<option value="">—</option>`}
        ${opts.map(o => html`<option value=${o}>${o}</option>`)}</select>`;
    } else if (col.type === 'bool') {
      input = html`<label class="check"><input type="checkbox" id=${id} disabled=${p.readOnly} checked=${!!p.value} onChange=${e => p.onCommit(e.target.checked)} /> ${p.checkLabel || 'Yes'}</label>`;
    } else if (col.type === 'long') {
      input = html`<textarea rows="3" ...${common} value=${st.na ? '' : shown} placeholder=${st.na ? 'not applicable' : (p.inheritedValue || p.placeholder || '')}></textarea>`;
    } else {
      input = html`<input type="text" autocomplete="off" spellcheck=${col.type === 'text'} ...${common} value=${st.na ? '' : shown}
        placeholder=${st.na ? 'not applicable' : (p.inheritedValue || p.placeholder || '')} inputmode=${col.type === 'int' ? 'numeric' : undefined} />`;
    }
    return html`<div class=${cls('field', 'span-' + (col.span || 1), st.spec && 'is-spec', st.na && 'is-na', unaddressed && 'is-unaddressed', p.invalid && 'is-invalid', inheriting && 'is-inherited', p.className)}>
      <div class="field-head">
        <label for=${id} title=${col.tip || ''}>${p.label || col.label}${inheriting && html` <span class="src">from title</span>`}</label>
        ${col.states && !p.readOnly && html`<span class="toggles">
          <button type="button" class=${cls('tog', st.spec && 'on')} aria-pressed=${st.spec} title="Speculative: inferred, uncertain, or from a secondary source" onClick=${() => p.onToggle('spec')}>?</button>
          ${!col.noNA && html`<button type="button" class=${cls('tog', st.na && 'on')} aria-pressed=${st.na} title="Not applicable: considered, and does not apply" onClick=${() => p.onToggle('na')}>N/A</button>`}
        </span>`}
      </div>
      ${input}
      ${overriding && p.onReset && !p.readOnly && html`<div class="field-note inh-note">${st.na ? 'Not applicable to this issue' : 'Set for this issue'}. Title: ${p.inheritedValue ? html`<span class="tv">${p.inheritedValue}</span>` : html`<em>blank</em>`}
        <button type="button" class="link" title="Use the title's value again" onClick=${p.onReset}>use title's</button></div>`}
      ${p.children}
      ${p.invalid ? html`<div class="field-note bad">${p.invalid}</div>` : p.note ? html`<div class="field-note">${p.note}</div>` : null}
    </div>`;
  }

  function Message({ msg, onClose }) {
    if (!msg) return null;
    return html`<div class=${'message ' + msg.level} role="status"><span>${msg.text}</span>
      ${onClose && html`<button type="button" class="link" onClick=${onClose}>Dismiss</button>`}</div>`;
  }

  SC.ui = { h, Fragment, html, useState, useEffect, useRef, useMemo, useCallback, useStore, useSessionUI, useRoute, navigate, parseRoute, routeHref,
    fmt, plural, cls, fieldState, toggleState, isUnaddressed, uncertain, issueLabel, issueDate, rovingKeys, Field, Message };
})(globalThis.SC = globalThis.SC || {});
