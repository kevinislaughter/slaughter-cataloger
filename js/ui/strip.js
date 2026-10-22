/* Slaughter Cataloger 3 — the run strip.
   A title's run at a glance: a row per volume (or per year when the run has no volumes),
   a square per issue in run order. Filled: contents recorded. Open: no contents yet.
   Hatched: a number missing from the run. Ochre: the issue is marked speculative.
   Round: a supplement or special issue. Each square opens its issue. */
(function (SC) {
  'use strict';
  const { html, useMemo, useStore, routeHref, plural, cls, issueLabel, issueDate, rovingKeys } = SC.ui;
  const N = SC.numbering;
  const MAX_GAP_CELLS = 12;

  // Rows of cells for one title. Pure apart from the store queries.
  function runRows(store, titleID) {
    const issues = store.issuesOfTitle(titleID);
    const gaps = N.runGaps(issues);
    const byVol = issues.some(i => String(i.volume || '').trim());
    const rows = [], index = new Map();
    let withContents = 0, missing = 0;
    issues.forEach(i => {
      const key = byVol ? (String(i.volume || '').trim() || '—') : ((/\d{4}/.exec(String(i.year || '')) || ['—'])[0]);
      if (!index.has(key)) {
        const r = { key, label: byVol ? (key === '—' ? 'no vol.' : 'v. ' + key) : (key === '—' ? 'undated' : key), cells: [] };
        index.set(key, r); rows.push(r);
      }
      const r = index.get(key);
      const g = gaps.get(i.issueID);
      if (g) {
        missing += g.count;
        for (let k = 0; k < Math.min(g.count, MAX_GAP_CELLS); k++) r.cells.push({ kind: 'gap', label: g.label + ' missing' });
        if (g.count > MAX_GAP_CELLS) r.cells.push({ kind: 'more', label: g.label + ' missing', n: g.count - MAX_GAP_CELLS });
      }
      const n = store.contentsOfIssue(i.issueID).length;
      if (n) withContents++;
      r.cells.push({ kind: 'issue', issue: i, n });
    });
    // Years in order; volumes in numeric order when every volume is a number (Arabic or Roman).
    // Within a row the squares keep the order of the run.
    const num = r => (byVol ? N.numberOf(r.key) : parseInt(r.key, 10));
    const odd = rows.filter(r => isNaN(num(r)));
    if (odd.length === 0 || (odd.length === 1 && odd[0].key === '—')) {
      rows.sort((a, b) => (isNaN(num(a)) ? 1e9 : num(a)) - (isNaN(num(b)) ? 1e9 : num(b)));    // undated / no volume last
    }
    return { rows, byVol, total: issues.length, withContents, missing };
  }

  /* props: titleID, current (issueID), target ('issues' | 'contents'): where a square leads. */
  function RunStrip({ titleID, current, target }) {
    const store = useStore();
    const run = useMemo(() => runRows(store, titleID), [store.version, titleID]);
    if (run.total < 2) return null;
    const panel = target || 'issues';
    // One stop for Tab: the current issue's square, or the first; the arrow keys move from square to square.
    const all = run.rows.reduce((a, r) => a.concat(r.cells.filter(c => c.kind === 'issue').map(c => c.issue.issueID)), []);
    const tabStop = all.indexOf(current) !== -1 ? current : all[0];
    const cell = (c, k) => {
      if (c.kind === 'gap') return html`<span key=${k} class="sc gap" title=${c.label}></span>`;
      if (c.kind === 'more') return html`<span key=${k} class="sc more" title=${c.label}>+${c.n}</span>`;
      const i = c.issue;
      const tip = issueLabel(i) + (issueDate(i) ? ' — ' + issueDate(i) : '') + ' — ' + (c.n ? plural(c.n, 'contents item') : 'no contents yet') + (i.speculative ? ' — speculative' : '');
      return html`<a key=${i.issueID} href=${routeHref({ panel, titleID, issueID: i.issueID })} title=${tip} aria-label=${tip} tabIndex=${i.issueID === tabStop ? 0 : -1}
        class=${cls('sc', c.n ? 'has' : 'none', i.speculative && 'spec', (i.supplement || i.specialIssue) && 'extra', i.issueID === current && 'on')}></a>`;
    };
    return html`<div class="strip" role="group" aria-label="The run" title="The arrow keys move from issue to issue" onKeyDown=${e => rovingKeys(e, '.strip-row')}>
      <div class="strip-head">
        <span>${plural(run.total, 'issue')} · ${run.withContents.toLocaleString('en-US')} with contents${run.missing ? html` · <span class="warn-text">${run.missing.toLocaleString('en-US')} missing</span>` : ''}</span>
        <span class="strip-legend"><span class="sc has"></span> contents <span class="sc none"></span> none yet <span class="sc gap"></span> missing <span class="sc none spec"></span> speculative <span class="sc none extra"></span> supplement or special</span>
      </div>
      <div class="strip-rows">${run.rows.map(r => html`<div class="strip-row" key=${r.key}>
        <span class="strip-label">${r.label}</span><span class="strip-cells">${r.cells.map(cell)}</span></div>`)}</div>
    </div>`;
  }

  SC.views = Object.assign(SC.views || {}, { RunStrip });
  SC.strip = { runRows };
})(globalThis.SC = globalThis.SC || {});
