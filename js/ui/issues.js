/* Slaughter Cataloger 3 — Stage 2: Issues.
   The run of a title's issues beside the record of one issue.
   A new issue starts as a draft that follows the issue before it: the fields that
   rarely change are carried over, the numbers and the date move on, and the short
   name keeps the same pattern. Record adds it to the run and the next draft is ready. */
(function (SC) {
  'use strict';
  const { html, useState, useEffect, useRef, useMemo, useStore, navigate, routeHref, plural, cls, fieldState, toggleState, isUnaddressed, uncertain, issueLabel, issueDate, rovingKeys, Field } = SC.ui;
  const S = SC.schema, R = SC.records, ids = SC.ids, N = SC.numbering;
  const IENT = S.entities.issue;

  // ── Inheritance-aware changes ─────────────────────────────────────────
  const orderKeys = keys => Array.from(new Set(keys)).sort((a, b) => IENT.byKey.get(a).order - IENT.byKey.get(b).order);
  // A title-level field shows as the issue's own unless it inherits (records.inherits).
  const ownValue = (rec, c, title) => R.inherits(rec, title, c.key) ? '' : rec[c.key];

  // Typing a title-level field overrides it for this issue; typing the title's own value, or nothing, inherits again.
  function valuePatch(rec, c, v, title) {
    if (typeof v === 'string' && c.type !== 'long') v = v.replace(/\s+$/, '');
    const k = c.key;
    if (!S.INHERIT[k]) return { [k]: v };
    const tv = title ? String(title[S.INHERIT[k]] || '') : '';
    const ov = (rec.overrides || []).filter(x => x !== k);
    if (!fieldState(rec, c).na && (v === '' || v === tv)) return { [k]: '', overrides: ov };
    return { [k]: v, overrides: orderKeys(ov.concat(k)) };
  }
  // N/A on a title-level field is this issue's own statement, so it overrides the title.
  function statePatch(rec, c, which) {
    const p = toggleState(IENT, rec, c, which);
    const k = c.key;
    if (S.INHERIT[k] && which === 'na') {
      const ov = (rec.overrides || []).filter(x => x !== k);
      p.overrides = p.na.indexOf(c.header) !== -1 ? orderKeys(ov.concat(k)) : ov;
      p[k] = '';
    }
    return p;
  }
  function resetPatch(rec, c) {
    const na = (rec.na || []).filter(h => h !== c.header);
    return { [c.key]: '', overrides: (rec.overrides || []).filter(x => x !== c.key), na };
  }
  function unaddressedCount(rec) {
    return IENT.fields.filter(c => c.states && !(S.INHERIT[c.key] && (rec.overrides || []).indexOf(c.key) === -1) &&
      isUnaddressed(c, rec[c.key], fieldState(rec, c))).length;
  }
  // The count of fields not yet addressed; clicking it goes to the first of them.
  function UnaddressedCount({ n }) {
    if (!n) return html`<span class="unaddr-count">Every field addressed</span>`;
    const go = () => {
      const el = document.querySelector('.issue-form .field.is-unaddressed input, .issue-form .field.is-unaddressed textarea');
      if (!el) return;
      const d = el.closest('details');
      if (d && !d.open) d.open = true;
      el.scrollIntoView({ block: 'center' });
      el.focus({ preventScroll: true });
    };
    return html`<button type="button" class="link unaddr-count some" onClick=${go} title="Go to the first one">${plural(n, 'field')} not yet addressed</button>`;
  }
  const identifies = r => ['volume', 'issue', 'number', 'months', 'day', 'year', 'datePrinted', 'issueDesignation', 'shortname', 'supplementLabel'].some(k => String(r[k] || '').trim());
  const dupKey = i => [i.volume, i.issue, i.number, i.months, i.day, i.year, i.edition, i.issueDesignation, i.supplement ? 'S:' + (i.supplementLabel || '') : '', i.specialIssue ? 'SP' : '']
    .map(x => String(x || '').trim().toLowerCase()).join('|');
  function duplicatesOf(rec, issues) {
    if (!['volume', 'issue', 'number', 'months', 'year'].some(k => String(rec[k] || '').trim())) return [];
    const k = dupKey(rec);
    return issues.filter(i => i.issueID !== rec.issueID && dupKey(i) === k);
  }

  // ── The typeset entry for one issue ───────────────────────────────────
  // Written by the catalog view model, the same way the Compiler's outputs write it.
  function IssueEntry({ rec, title, idText }) {
    const CAT = SC.catalog;
    const e = CAT.entry(CAT.issueView(rec, title), title ? CAT.titleView(title) : null);
    const show = parts => parts.map(p => (typeof p === 'string' ? p : p.spec ? uncertain(p.text) : p.text));
    return html`<div class="entry">
      <p class="entry-main"><cite>${show(e.title)}</cite>.${e.body.length ? html` ${show(e.body)}` : ''}</p>
      ${e.sub.length > 0 && html`<p class="entry-sub">${show(e.sub)}</p>`}
      <p class="entry-id"><code>${idText || rec.issueID}</code>${rec.shortname ? html` · ${rec.shortname}` : ''}</p>
    </div>`;
  }

  // ── Months and seasons by click ───────────────────────────────────────
  function MonthsPicker({ rec, style, disabled, onPatch }) {
    const kind = rec.dateType === 'Season' ? 'seasons' : 'months';
    const p = N.parsePeriod(rec.months);
    const mine = p && p.kind === kind;
    const st = { full: mine && p.full != null ? p.full : !!style.full, autumn: mine && kind === 'seasons' && p.idx.indexOf(2) !== -1 ? p.autumn : !!style.autumn };
    const names = kind === 'seasons' ? N.SEASONS.map(n => n === 'Fall' && st.autumn ? 'Autumn' : n) : N.MON3;
    const sel = mine ? p.idx : [];
    const pick = i => {
      const next = sel.indexOf(i) !== -1 ? sel.filter(x => x !== i) : sel.concat(i);
      onPatch({ months: N.periodLabel(next, kind, st) }, 'Set ' + (kind === 'seasons' ? 'season' : 'months'));
    };
    const spans = mine && p.run && p.run.start + p.run.len > p.cycle;
    const y = String(rec.year || '').trim();
    return html`<div class=${cls('months-pick', kind)} role="group" aria-label=${kind === 'seasons' ? 'Seasons' : 'Months'}
        title=${rec.months && !p ? 'Clicking replaces "' + rec.months + '"' : ''}>
        ${names.map((n, i) => html`<button type="button" class=${cls('mp', sel.indexOf(i) !== -1 && 'on')} aria-pressed=${sel.indexOf(i) !== -1}
          disabled=${disabled} onClick=${() => pick(i)}>${n}</button>`)}
      </div>
      ${spans && !rec.yearEnd && /^\d{4}$/.test(y) && !disabled && html`<div class="field-note">Runs into the next year.
        <button type="button" class="link" onClick=${() => onPatch({ yearEnd: String(parseInt(y, 10) + 1) }, 'Set end year')}>Set end year to ${parseInt(y, 10) + 1}</button></div>`}`;
  }

  // ── The form, shared by new and existing issues ───────────────────────
  function IssueForm({ rec, title, onPatch, readOnly, style, extra }) {
    const overridden = (rec.overrides || []).length;
    function field(c) {
      const inh = S.INHERIT[c.key];
      const st = fieldState(rec, c);
      const props = {
        key: c.key, col: c, value: ownValue(rec, c, title), state: st, readOnly,
        onCommit: v => onPatch(valuePatch(rec, c, v, title), 'Edit ' + c.label.toLowerCase()),
        onToggle: which => onPatch(statePatch(rec, c, which), (which === 'spec' ? 'Mark ? on ' : 'Mark N/A on ') + c.label.toLowerCase())
      };
      if (inh) {
        props.inheritedValue = title ? String(title[inh] || '') : '';
        props.onReset = () => onPatch(resetPatch(rec, c), 'Use the title’s ' + c.label.toLowerCase());
      }
      if (c.type === 'months') return html`<${Field} ...${props}><${MonthsPicker} rec=${rec} style=${style} disabled=${readOnly || st.na} onPatch=${onPatch} /></${Field}>`;
      return html`<${Field} ...${props} />`;
    }
    return html`<div class="issue-form">${S.ISSUE_GROUPS.map(g => {
      const fields = IENT.groupFields(g.id).map(field);
      if (g.id === 'title') return html`<details class="card group collapsible" open=${overridden > 0}>
        <summary><span class="group-title">${g.label}</span> <span class="group-note">${overridden
          ? plural(overridden, 'field') + ' set for this issue; the rest come from the title'
          : 'all ' + Object.keys(S.INHERIT).length + ' fields come from the title record'}</span></summary>
        <div class="grid">${fields}</div></details>`;
      return html`<fieldset class="card group"><legend>${g.label}</legend>
        ${extra && extra[g.id]}
        <div class="grid">${fields}</div></fieldset>`;
    })}</div>`;
  }

  // ── Drafts of new issues ──────────────────────────────────────────────
  // Kept per title for the session, so a half-entered issue survives a look at another stage.
  const drafts = new Map();
  let pendingBase = null, draftEpoch = 0;
  function startDraft(titleID, baseID) {
    pendingBase = { titleID, baseID: baseID || null };
    draftEpoch++;
    const href = routeHref({ panel: 'issues', titleID, issueID: 'new' });
    if (location.hash === href) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else navigate({ panel: 'issues', titleID, issueID: 'new' });
  }

  const SETTINGS = { volume: false, issue: true, number: true, date: 'auto' };
  function loadSettings(tid) {
    try { return Object.assign({}, SETTINGS, JSON.parse(localStorage.getItem('sc3.advance.' + tid) || '{}')); } catch (e) { return Object.assign({}, SETTINGS); }
  }
  function saveSettings(tid, s) { try { localStorage.setItem('sc3.advance.' + tid, JSON.stringify(s)); } catch (e) { /* a convenience only */ } }

  function blankIssue(titleID) {
    const r = { issueID: '', titleID, spec: [], na: [], overrides: [], speculative: false };
    IENT.fields.forEach(c => { r[c.key] = c.type === 'bool' ? false : ''; });
    r.dateType = 'Months'; r.yearCalendar = 'CE';
    return r;
  }
  const isRegular = i => !i.specialIssue && !i.supplement;
  const nameVals = x => ({ volume: x.volume, issue: x.issue, number: x.number, months: x.months, year: x.year });
  // An issue's short name with its Roman numerals separated, or null: worked out once for each issue
  // record (a record is never changed in place, only replaced), not again for every issue of a long run
  // each time anything changes while the run is shown.
  const fixCache = new WeakMap();
  const shortNameFix = i => { if (!fixCache.has(i)) fixCache.set(i, N.fixShortName(i.shortname, nameVals(i))); return fixCache.get(i); };
  function autoShort(rec, title, from) {
    const t = R.effective(rec, title, 'title') || (title && title.canonicalTitle) || '';
    return from && from.shortname ? N.nextShortName(from.shortname, nameVals(from), nameVals(rec), t) : N.defaultShortName(t, nameVals(rec));
  }
  const advanceOpts = (s, cadence) => ({ volume: s.volume, issue: s.issue, number: s.number, date: s.date === 'auto' ? cadence : s.date });

  // A new draft following base (an issue of this title), or the last issue of the run.
  // Numbers and date move on from the last regular issue at or before base, not from a supplement or special issue.
  function makeDraft(store, title, titleID, baseID, settings) {
    const issues = store.issuesOfTitle(titleID);
    const base = (baseID && store.state.issues.get(baseID)) || issues[issues.length - 1] || null;
    const rec = blankIssue(titleID);
    const d = { rec, baseID: base ? base.issueID : '', fromID: '', cadence: 'run', shortAuto: true, touched: false };
    if (!base) { rec.shortname = autoShort(rec, title, null); return d; }
    let at = issues.indexOf(base), from = base;
    for (let j = at; j >= 0; j--) if (isRegular(issues[j])) { from = issues[j]; at = j; break; }
    let prev = null;
    for (let j = at - 1; j >= 0; j--) if (isRegular(issues[j])) { prev = issues[j]; break; }
    IENT.fields.forEach(c => { if (c.sticky) rec[c.key] = from[c.key]; });
    (from.overrides || []).forEach(k => { rec[k] = from[k]; });
    rec.overrides = (from.overrides || []).slice();
    rec.na = (from.na || []).slice();
    d.fromID = from.issueID;
    d.cadence = N.inferCadence(prev, from);
    Object.assign(rec, N.nextIssue(from, advanceOpts(settings, d.cadence), N.periodStyle(issues.map(i => i.months))));
    rec.shortname = autoShort(rec, title, from);
    return d;
  }
  // A change to the draft; the short name follows the numbers until the person types their own.
  function patchDraft(d, patch, title, from, touched) {
    const rec = Object.assign({}, d.rec, patch);
    let shortAuto = d.shortAuto;
    if ('shortname' in patch) {
      const auto = autoShort(rec, title, from);
      shortAuto = !patch.shortname || patch.shortname === auto;
      if (shortAuto) rec.shortname = auto;
    } else if (shortAuto) rec.shortname = autoShort(rec, title, from);
    return Object.assign({}, d, { rec, shortAuto, touched: d.touched || !!touched });
  }

  // Where the run may turn to a new volume: the previous volume ended at a lower number.
  function volumeHint(issues, rec) {
    const v = N.numberOf(rec.volume), n = N.numberOf(rec.issue);
    if (isNaN(v) || isNaN(n) || v < 2) return null;
    const nums = issues.filter(i => isRegular(i) && N.numberOf(i.volume) === v - 1).map(i => N.numberOf(i.issue)).filter(x => !isNaN(x));
    if (!nums.length) return null;
    const last = Math.max.apply(null, nums);
    return n > last ? { prev: v - 1, last } : null;
  }

  function IssueDraft({ titleID, title, issues }) {
    const store = useStore();
    const [settings, setSettings] = useState(() => loadSettings(titleID));
    const [d, setD0] = useState(() => {
      const want = pendingBase && pendingBase.titleID === titleID ? pendingBase.baseID : null;
      pendingBase = null;
      const have = drafts.get(titleID);
      if (have && (!want || want === have.baseID)) return have;
      if (have && have.touched) return Object.assign({}, have, { offer: want });
      return makeDraft(store, title, titleID, want, settings);
    });
    const dref = useRef(d);
    const [formKey, setFormKey] = useState(0);
    const setD = nd => { dref.current = nd; drafts.set(titleID, nd); setD0(nd); };
    useEffect(() => { drafts.set(titleID, dref.current); }, []);
    const style = useMemo(() => N.periodStyle(issues.map(i => i.months)), [titleID, issues.length]);
    const fromRec = () => (dref.current.fromID && store.state.issues.get(dref.current.fromID)) || null;
    const rec = d.rec;
    const base = d.baseID ? store.state.issues.get(d.baseID) : null;
    const from = fromRec();

    const onPatch = (patch) => setD(patchDraft(dref.current, patch, title, fromRec(), true));
    // Returns false when the person declines, so the Follows list can show again the issue the
    // draft still follows (the browser had already moved the list to the one chosen).
    function rebase(baseID) {
      if (dref.current.touched && !confirm('Start the new issue again, following another issue? What you have entered in it will be cleared.')) return false;
      setD(makeDraft(store, title, titleID, baseID, settings));
      setFormKey(k => k + 1);
      return true;
    }
    // Change how numbers move on; the draft's own numbers follow at once.
    function setOption(name, value) {
      const s = Object.assign({}, settings, { [name]: value });
      setSettings(s); saveSettings(titleID, s);
      const f = fromRec();
      if (!f) return;
      const nx = N.nextIssue(f, advanceOpts(s, dref.current.cadence), style);
      const keys = { volume: ['volume'], issue: ['issue', 'seriesNumber'], number: ['number'], date: ['months', 'day', 'year', 'yearEnd'] }[name];
      const patch = {};
      keys.forEach(k => { patch[k] = nx[k]; });
      setD(patchDraft(dref.current, patch, title, f, false));
      setFormKey(k => k + 1);
    }
    function nextVolume() {
      const r = dref.current.rec;
      setD(patchDraft(dref.current, { volume: N.incrementString(r.volume), issue: N.firstOf(r.issue) }, title, fromRec(), true));
      setFormKey(k => k + 1);
    }

    function record() {
      const el = document.activeElement;
      if (el && el.blur && el !== document.body) el.blur();            // commit whatever is being typed
      const cur = dref.current;
      if (!identifies(cur.rec)) { SC.session.say('warn', 'Give the issue a number, a date or a short name before recording it.'); return; }
      // The new issue goes into the file of the issue it follows, right after it, so it is next to that
      // issue in the run however the title's issues are spread over Issues files (DF-20). With nothing
      // to follow (the title's first issue, or the issue the draft followed was undone) it goes at the
      // end of the run: into the file of the run's last issue, else the title's file for new issues.
      const after = cur.baseID && store.state.issues.get(cur.baseID);
      const run = store.issuesOfTitle(titleID);
      const file = after ? after._src : run.length ? run[run.length - 1]._src : store.fileForNew('issue', titleID);
      const why = store.blocked(file); if (why) { SC.session.say('error', why); return; }
      const id = ids.newIssueID(titleID, x => store.state.issues.has(x));
      const label = issueLabel(cur.rec);
      store.batch('Record issue ' + label, () => {
        let entryOrder;
        if (after) {
          // Keep the run in order: the new issue goes right after the one it follows, and the issues
          // after it in that file move down one. No other file is touched.
          entryOrder = (after.entryOrder || 0) + 1;
          Array.from(store.state.issues.values()).filter(i => i._src === file && i.entryOrder >= entryOrder)
            .sort((a, b) => b.entryOrder - a.entryOrder)
            .forEach(i => store.put('issue', Object.assign({}, i, { entryOrder: i.entryOrder + 1 })));
        } else entryOrder = store.nextEntryOrder(file, 'issue');
        store.put('issue', Object.assign({}, cur.rec, { issueID: id, titleID, _src: file, entryOrder }));
      });
      setD(makeDraft(store, title, titleID, id, settings));
      setFormKey(k => k + 1);
      SC.session.say('ok', 'Recorded ' + label + '. The next issue is ready.');
    }
    const recordRef = useRef(record);
    recordRef.current = record;
    useEffect(() => {
      const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); recordRef.current(); } };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);
    // After recording, start typing in the first field of the new draft.
    const first = useRef(true);
    useEffect(() => {
      if (first.current) { first.current = false; return; }
      const el = document.querySelector('.issue-form input[type=text]:not([disabled])');
      window.scrollTo(0, 0);
      if (el) el.focus({ preventScroll: true });
    }, [formKey]);

    const dups = duplicatesOf(rec, issues);
    const hint = volumeHint(issues, rec);
    const unaddressed = unaddressedCount(rec);
    const cadenceName = (N.DATE_MODES.find(m => m[0] === d.cadence) || ['', ''])[1];
    const tools = html`<div class="advance-bar">
      <label class="ctx">Follows
        <select value=${d.baseID} onChange=${e => { if (!rebase(e.target.value)) e.target.value = dref.current.baseID; }}>
          <option value="">nothing: a blank issue</option>
          ${issues.map(i => html`<option value=${i.issueID}>${issueLabel(i)}${issueDate(i) ? ' — ' + issueDate(i) : ''}</option>`)}
        </select></label>
      <span class="adv-opts">Moves on:
        ${[['volume', 'Volume'], ['issue', 'Issue / no.'], ['number', 'Whole no.']].map(([k, l]) =>
          html`<label class="check"><input type="checkbox" checked=${settings[k]} onChange=${e => setOption(k, e.target.checked)} /> ${l}</label>`)}
        <label class="ctx">Date
          <select value=${settings.date} onChange=${e => setOption('date', e.target.value)}>
            <option value="auto">as last time (${cadenceName})</option>
            ${N.DATE_MODES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
          </select></label></span>
      <button type="button" class="btn small" onClick=${nextVolume} title="Volume +1 and issue number back to 1">Start next volume</button>
    </div>
    ${hint && html`<p class="hint-line">Volume ${hint.prev} ended with no. ${hint.last}, so this may be the first issue of a new volume.
      <button type="button" class="link" onClick=${nextVolume}>Make it vol. ${N.incrementString(rec.volume)}, no. ${N.firstOf(rec.issue) || '1'}</button></p>`}`;

    return html`<section class="editor">
      <h1 class="vh">New issue of ${title ? title.canonicalTitle : titleID}</h1>
      ${d.offer && html`<div class="message warn" role="status"><span>The new issue you started earlier is kept below, not yet recorded.</span>
        <span><button class="btn small" onClick=${() => setD(Object.assign({}, dref.current, { offer: null }))}>Keep it</button>
        <button class="btn small quiet" onClick=${() => { const w = d.offer; setD(Object.assign({}, dref.current, { touched: false, offer: null })); rebase(w); }}>Start again after ${issueLabel(store.state.issues.get(d.offer) || {})}</button></span></div>`}
      <div class="card entry-card draft-card">
        <p class="draft-tag">New issue${base ? html`, after <a href=${routeHref({ panel: 'issues', titleID, issueID: base.issueID })}>${issueLabel(base)}</a>` : ''}</p>
        <${IssueEntry} rec=${rec} title=${title} idText="IssueID assigned when recorded" />
        <div class="entry-facts">
          <${UnaddressedCount} n=${unaddressed} />
          ${from && from !== base && html`<span>Numbers follow ${issueLabel(from)}, the last regular issue</span>`}
        </div>
      </div>
      <${IssueForm} key=${formKey} rec=${rec} title=${title} onPatch=${onPatch} style=${style} extra=${{ numbering: tools }} />
      <div class="actions sticky-actions">
        <button class="btn primary" onClick=${record} title="Ctrl+Enter or ⌘+Enter">Record issue</button>
        <button class="btn quiet" onClick=${() => rebase(d.baseID)}>Start over</button>
        ${dups.length > 0 && html`<span class="warn-text">Already in the run: ${dups.slice(0, 3).map((i, k) => html`${k ? ', ' : ''}<a href=${routeHref({ panel: 'issues', titleID, issueID: i.issueID })}>${issueLabel(i)}</a>`)}. Record it anyway if this is another copy or state.</span>`}
        ${!dups.length && html`<span class="hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> records. Nothing is written to your files until you save.</span>`}
      </div>
    </section>`;
  }

  // ── An existing issue ─────────────────────────────────────────────────
  function IssueEditor({ issue, title, issues }) {
    const store = useStore();
    const style = useMemo(() => N.periodStyle(issues.map(i => i.months)), [issue.titleID, issues.length]);
    const n = store.contentsOfIssue(issue.issueID).length;
    const readOnly = !title;
    const pos = issues.indexOf(issue);
    const onPatch = (patch, label) => store.put('issue', Object.assign({}, issue, patch), label + ' (' + issueLabel(issue) + ')');
    const unaddressed = unaddressedCount(issue);
    const contentsHref = routeHref({ panel: 'contents', titleID: issue.titleID, issueID: issue.issueID });
    function remove() {
      const items = store.contentsOfIssue(issue.issueID);
      if (!confirm('Delete ' + issueLabel(issue) + (items.length ? ' and its ' + plural(items.length, 'contents item') : '') + '? You can undo this until you close the app.')) return;
      const next = issues[pos + 1] || issues[pos - 1];
      store.batch('Delete issue ' + issueLabel(issue), () => {
        items.forEach(c => store.remove('content', c.contentID));
        store.remove('issue', issue.issueID);
      });
      navigate({ panel: 'issues', titleID: issue.titleID, issueID: next ? next.issueID : '' }, true);
    }
    return html`<section class="editor">
      <h1 class="vh">Issue: ${issueLabel(issue)}</h1>
      <div class="card entry-card">
        <${IssueEntry} rec=${issue} title=${title} />
        <div class="entry-facts">
          <span>${pos + 1} of ${issues.length} in the run</span>
          <a href=${contentsHref}>${n ? plural(n, 'contents item') : 'No contents yet'}</a>
          <${UnaddressedCount} n=${unaddressed} />
        </div>
      </div>
      ${readOnly && html`<p class="phase-note">This title is not in the Titles file, so its issues can be read here but not changed. Add the title in Library to edit them.</p>`}
      <${IssueForm} rec=${issue} title=${title} onPatch=${onPatch} readOnly=${readOnly} style=${style} />
      <div class="actions sticky-actions">
        ${!readOnly && html`<button class="btn primary" onClick=${() => startDraft(issue.titleID, issue.issueID)}>New issue after this</button>`}
        <a class="btn" href=${contentsHref}>Contents</a>
        ${!readOnly && html`<button class="btn quiet danger" onClick=${remove}>Delete issue</button>`}
        <span class="hint">Changes are kept as you go. Save writes them to your files.</span>
      </div>
    </section>`;
  }

  // Where numbers are missing: the gap before each issue, judged against the regular issue before it.
  const gapsOf = issues => N.runGaps(issues);
  const gapTotal = gaps => Array.from(gaps.values()).reduce((n, g) => n + g.count, 0);

  // The words every short name in the run starts with (usually the title), so the narrow run
  // list can show what tells the issues apart. A numbering word ("No.", "Vol.") stays visible.
  function sharedStart(issues) {
    const names = issues.map(i => i.shortname).filter(Boolean);
    if (names.length < 2) return '';
    let p = names[0];
    names.forEach(n => { while (p && n.indexOf(p) !== 0) p = p.slice(0, -1); });
    const words = p.slice(0, p.lastIndexOf(' ') + 1).split(' ').filter(Boolean);
    while (words.length && /^(no|nos|nr|vol|v|n|i|issue|number|#)\.?$/i.test(words[words.length - 1])) words.pop();
    return words.length ? words.join(' ') + ' ' : '';
  }

  // ── The run ───────────────────────────────────────────────────────────
  function RunList({ titleID, issues, current, canAdd }) {
    const store = useStore();
    const [q, setQ] = useState('');
    const listRef = useRef(null);
    useEffect(() => {
      const el = listRef.current && listRef.current.querySelector('.run-item.on');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }, [current, issues.length]);
    const needle = q.trim().toLowerCase();
    const shown = needle ? issues.filter(i => (issueLabel(i) + ' ' + issueDate(i) + ' ' + i.issueID).toLowerCase().indexOf(needle) !== -1) : issues;
    const draft = current === 'new' ? drafts.get(titleID) : null;
    const gaps = useMemo(() => gapsOf(issues), [issues]);
    const start = useMemo(() => sharedStart(issues), [issues]);
    const short = i => { const l = issueLabel(i); return start && l.indexOf(start) === 0 && l.length > start.length ? l.slice(start.length) : l; };
    // One stop for Tab: the issue open (or the new one), else the first; the arrow keys move along the run.
    const tabStop = current && (current === 'new' || shown.some(i => i.issueID === current)) ? current : shown.length ? shown[0].issueID : 'new';
    const draftItem = html`<li key="draft" class="run-item draft on"><a href=${routeHref({ panel: 'issues', titleID, issueID: 'new' })} title=${draft ? issueLabel(draft.rec) : ''} tabIndex=${tabStop === 'new' ? 0 : -1}>
      <span class="ri-name">${draft ? short(draft.rec) : 'New issue'}</span><span class="ri-date">not yet recorded</span></a></li>`;
    const items = [];
    shown.forEach(i => {
      const n = store.contentsOfIssue(i.issueID).length;
      const g = !needle && gaps.get(i.issueID);
      if (g) items.push(html`<li key=${'gap-' + i.issueID} class="run-gap" title="Not in the run">${g.label} missing</li>`);
      items.push(html`<li key=${i.issueID} class=${cls('run-item', i.issueID === current && 'on')}>
        <a href=${routeHref({ panel: 'issues', titleID, issueID: i.issueID })} title=${issueLabel(i)} tabIndex=${i.issueID === tabStop ? 0 : -1}>
          <span class=${cls('ri-name', i.speculative && 'spec')}>${short(i)}</span>
          <span class="ri-date">${issueDate(i)}${i.supplement ? ' · supplement' : ''}${i.specialIssue ? ' · special' : ''}</span>
          <span class=${cls('ri-n', !n && 'zero')} title=${plural(n, 'contents item')}>${n || '—'}</span></a></li>`);
      if (draft && draft.baseID === i.issueID && !needle) items.push(draftItem);
    });
    if (current === 'new' && (!draft || !draft.baseID || needle)) items.push(draftItem);
    return html`<aside class="run" aria-label="Issues of this title">
      <div class="run-head">
        ${start && html`<div class="run-title" title="Every short name in this run begins with this">${start.trim()} …</div>`}
        <div class="run-top"><span class="run-count">${plural(issues.length, 'issue')}${gaps.size ? html`<span class="run-gaps">${plural(gapTotal(gaps), 'number')} missing</span>` : ''}</span>
          ${canAdd && html`<button class="btn primary small" disabled=${current === 'new'} onClick=${() => startDraft(titleID, current)}>New issue</button>`}</div>
        <input type="search" placeholder="Find an issue" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Find an issue" />
      </div>
      <ol class="run-list" ref=${listRef} title="The arrow keys move from issue to issue" onKeyDown=${e => rovingKeys(e)}>${items}</ol>
    </aside>`;
  }

  // ── All issues of a title ─────────────────────────────────────────────
  function IssueOverview({ titleID, title, issues }) {
    const store = useStore();
    const gaps = useMemo(() => gapsOf(issues), [issues]);
    const missing = gapTotal(gaps);
    // Short names that run a Roman numeral into a letter ("VXIIIN2"), as the Beta builder wrote them.
    const fixes = useMemo(() => title ? issues.map(i => [i, shortNameFix(i)]).filter(x => x[1]) : [], [issues, !!title]);
    function fixAll() {
      store.batch('Separate Roman numerals in ' + plural(fixes.length, 'short name'), () =>
        fixes.forEach(([i, name]) => store.put('issue', Object.assign({}, i, { shortname: name }))));
      SC.session.say('ok', 'Rewrote ' + plural(fixes.length, 'short name') + '. Undo puts them back.');
    }
    const col = h => IENT.byHeader.get(h);
    const shown = (i, h, value) => {
      const c = col(h), st = fieldState(i, c);
      if (st.na) return html`<span class="na">n/a</span>`;
      if (value === '' || value == null) return html`<span class="blank">—</span>`;
      return st.spec ? uncertain(value) : value;
    };
    return html`<section>
      <div class="panel-head">
        <h1 class="panel-title">Issues of <cite>${title ? title.canonicalTitle : titleID}</cite></h1>
        ${title && html`<button class="btn primary" onClick=${() => startDraft(titleID, null)}>${issues.length ? 'New issue' : 'Record the first issue'}</button>`}
      </div>
      ${!title && html`<p class="phase-note">This title is not in the Titles file, so its issues can be read here but not changed.</p>`}
      ${fixes.length > 0 && html`<div class="message warn" role="status">
        <span>${plural(fixes.length, 'short name')} run a Roman numeral into the letters beside it, as in <code>${fixes[0][0].shortname}</code>, so the numbers can't be read back.</span>
        <button class="btn small" onClick=${fixAll}>Rewrite ${fixes.length === 1 ? 'it' : 'them'}: <code>${fixes[0][1]}</code>${fixes.length > 1 ? ', …' : ''}</button></div>`}
      <p class="summary">${plural(issues.length, 'issue')}${title && title.knownIssues ? ' of ' + title.knownIssues + ' known' : ''}, in the order of the run${missing ? html`; the numbering suggests <span class="warn-text">${plural(missing, 'issue')} not yet recorded</span>` : ''}.</p>
      ${SC.views.RunStrip && html`<${SC.views.RunStrip} titleID=${titleID} target="issues" />`}
      <div class="table-wrap"><table class="list">
        <thead><tr><th class="num">#</th><th>Short name</th><th class="num">Vol.</th><th class="num">No.</th><th class="num">Whole no.</th><th>Date</th><th class="num">Pages</th><th>Evidence</th><th class="num">Contents</th></tr></thead>
        <tbody>${issues.map((i, n) => html`${gaps.has(i.issueID) && html`<tr key=${'gap-' + i.issueID} class="gap-row"><td></td><td colspan="8">${gaps.get(i.issueID).label} missing</td></tr>`}
          <tr key=${i.issueID} class="row-link" onClick=${e => { if (!e.target.closest('a')) navigate({ panel: 'issues', titleID, issueID: i.issueID }); }}>
          <td class="num dim">${n + 1}</td>
          <td><a class="row-main" href=${routeHref({ panel: 'issues', titleID, issueID: i.issueID })} aria-label=${i.shortname ? undefined : issueLabel(i)}>${shown(i, 'Short Name', i.shortname)}</a>${i.issueDesignation && html` <span class="tag">${i.issueDesignation}</span>`}${i.supplement && html` <span class="tag">Supplement${i.supplementLabel ? ': ' + i.supplementLabel : ''}</span>`}</td>
          <td class="num">${shown(i, 'Volume', i.volume)}</td>
          <td class="num">${shown(i, 'Issue', i.issue)}</td>
          <td class="num">${shown(i, 'Whole No.', i.number)}</td>
          <td>${issueDate(i) || html`<span class="blank">—</span>`}</td>
          <td class="num">${shown(i, 'Pages', i.pages)}</td>
          <td>${i.evidence || ''}</td>
          <td class="num">${store.contentsOfIssue(i.issueID).length || ''}</td>
        </tr>`)}</tbody>
      </table>${!issues.length && html`<p class="empty">No issues recorded for this title yet.</p>`}</div>
    </section>`;
  }

  function IssuesPanel({ route }) {
    const store = useStore();
    const tid = route.titleID;
    if (!tid) return html`<section><h1 class="panel-title">Issues</h1><p class="empty">Choose a title above.</p></section>`;
    const title = store.state.titles.get(tid);
    const issues = store.issuesOfTitle(tid);
    if (!title && !issues.length) return html`<section><h1 class="panel-title">Issues</h1><p class="empty">No title ${tid} in this library.</p></section>`;
    const iid = route.issueID;
    if (!iid) return html`<${IssueOverview} titleID=${tid} title=${title} issues=${issues} />`;
    const isNew = iid === 'new';
    const issue = isNew ? null : store.state.issues.get(iid);
    let main;
    if (isNew && !title) main = html`<p class="phase-note">This title is not in the Titles file. Add it in Library before recording issues.</p>`;
    else if (isNew) main = html`<${IssueDraft} key=${'draft-' + tid + '-' + draftEpoch} titleID=${tid} title=${title} issues=${issues} />`;
    else if (!issue) main = html`<p class="empty">No issue ${iid} in this title.</p>`;
    else main = html`<${IssueEditor} key=${iid} issue=${issue} title=${title} issues=${issues} />`;
    return html`<div class="issues-layout">
      <${RunList} titleID=${tid} issues=${issues} current=${iid} canAdd=${!!title} />
      <div class="issue-main">${main}</div>
    </div>`;
  }

  // ── Drafts that hold something of the person's (K-D1) ─────────────────
  // A draft lives in memory only, for the session. It holds something to lose when the person has
  // changed it (a value entered, a ? or N/A, Start next volume) and it now differs from the draft the
  // app would make afresh for the same base and settings. A draft only opened (made by New issue, or
  // ready after Record), or changed back to what the app proposed, holds nothing, and leaving it asks
  // nothing. "Moves on" settings are kept per title in this browser, so they hold nothing either.
  function draftChanged(store, titleID, d) {
    if (!d || !d.touched) return false;
    const fresh = makeDraft(store, store.state.titles.get(titleID) || null, titleID, d.baseID, loadSettings(titleID)).rec;
    const v = x => String(x == null ? '' : x);
    const list = x => JSON.stringify((x || []).slice().sort());
    return IENT.fields.some(c => v(d.rec[c.key]) !== v(fresh[c.key])) ||
      ['spec', 'na', 'overrides'].some(k => list(d.rec[k]) !== list(fresh[k])) || !!d.rec.speculative !== !!fresh.speculative;
  }
  SC.drafts = {
    // The titles of this library with a changed draft: [{ titleID, name }], in catalog order.
    changed() {
      const store = SC.session && SC.session.store;
      if (!store) return [];
      const st = store.state;
      const tids = Array.from(drafts.keys()).filter(t => (st.titles.has(t) || store.issuesOfTitle(t).length) && draftChanged(store, t, drafts.get(t)));
      return SC.catalog.titleOrder(st, tids).map(t => ({ titleID: t, name: (st.titles.get(t) && st.titles.get(t).canonicalTitle) || t }));
    },
    // Every draft goes: another library is opened, or this one closed (after the person agreed).
    discard() { drafts.clear(); pendingBase = null; draftEpoch++; }
  };

  SC.views = Object.assign(SC.views || {}, { IssuesPanel, IssueEntry });
})(globalThis.SC = globalThis.SC || {});
