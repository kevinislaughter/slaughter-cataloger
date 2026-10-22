/* Slaughter Cataloger 3 — names: credits, headings and the name index.
   Contents keep each credit exactly as printed ("J.Q.P.", "Jno. Q. Public"). A name
   heading (an authority record) gathers the forms one person or body is credited under,
   and is the form an index files them under ("Public, John Q.").
   Credits are matched to headings by a key that ignores case, spacing, punctuation and
   accents, so "J. Q. Public", "J.Q. Public" and "j q public" are one form. A heading
   matches its listed forms, its own form and that form in direct order.
   Pure; testable in Node. */
(function (SC) {
  'use strict';
  const str = v => (v == null ? '' : String(v));

  // One Author / Credit value may name several: separated by semicolons, by "&", or by a slash
  // between names ("A.N. Other/Public", a letter and its reply) but not between numbers ("1872/73").
  const splitCredits = v => str(v).split(/\s*;\s*|\s+&\s+|(?<=[^\d\s])\s*\/\s*(?=[^\d\s])/).map(s => s.trim()).filter(Boolean);
  // Forms listed on a heading are separated by " | " (as in the earlier authority lists); ";" is accepted too.
  const splitForms = v => str(v).split(/\s*[|;]\s*/).map(s => s.trim()).filter(Boolean);
  const joinForms = list => Array.from(new Set(list.map(s => s.trim()).filter(Boolean))).join(' | ');
  function nameKey(s) {
    return str(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }
  // Filing order is word by word, as in a printed index: "Public, J." < "Public, J. Q." < "Public, Joan" < "Public, John Q.".
  const sortKey = s => str(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // ── Reading a name ────────────────────────────────────────────────────
  const HONORIFICS = new Set(['rev', 'reverend', 'revd', 'dr', 'mr', 'mrs', 'ms', 'miss', 'mme', 'mlle', 'prof', 'professor', 'magister', 'magistra', 'deacon',
    'colonel', 'col', 'capt', 'captain', 'sir', 'dame', 'lord', 'lady', 'irrev', 'father', 'fr', 'brother', 'sister', 'comrade', 'citizen', 'gen', 'general',
    'maj', 'major', 'lt', 'sgt', 'hon', 'herr', 'frau', 'signor', 'señor', 'monsieur', 'madame']);
  const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'esq']);
  const PARTICLES = new Set(['von', 'van', 'de', 'del', 'della', 'der', 'den', 'du', 'la', 'le', 'da', 'di', 'dos', 'das', 'ten', 'ter', 'vom', 'zu', 'zur', 'af', 'y']);
  // Words that mark a body, a group or a description rather than a person's name.
  const CORPORATE = /(^|\s)(the|of|for|and|&|society|association|group|committee|press|club|league|union|institute|centre|center|order|temple|church|inc\.?|co\.|company|publishing|publishers|editors|editorial|staff|board|council|federation|party|movement|foundation|library|university|college|station|records|magazine|journal|newspaper|post|times|tribune|review|herald|gazette|news|weekly|monthly|quarterly|daily|bulletin|chronicle|observer|courier|express|mirror|spectator|various|anonymous|anon\.?|unknown|others)(\s|$)/i;
  // A credit may begin with what the person did: "translated by Jane Roe", "quoted by J. Doe".
  const ROLE = /^((?:translated|trans\.?|tr\.|edited|ed\.|compiled|selected|introduced|introduction|illustrated|drawn|written|quoted|reported|interviewed|reviewed|signed|letter|poem|verse|music|words|adapted|abridged)(?:\s+and\s+\w+)?\s+(?:by|from)\s+|by\s+)/i;
  const bare = t => t.replace(/[.,]/g, '').toLowerCase();
  // Old written abbreviations of forenames, so "Wm. Smith" can be matched with "William Smith".
  const ABBR = { wm: 'william', geo: 'george', chas: 'charles', jas: 'james', thos: 'thomas', jno: 'john', edw: 'edward', robt: 'robert',
    saml: 'samuel', benj: 'benjamin', jos: 'joseph', alex: 'alexander', fredk: 'frederick', richd: 'richard', danl: 'daniel', hy: 'henry' };
  const givenKey = t => { const k = nameKey(t); return ABBR[k] || k; };
  const isInitialism = s => /^([A-Z]\.\s?){2,5}$/.test(s.trim());
  const isInitial = t => /^[A-Za-z]\.?$/.test(t) || /^([A-Za-z]\.){2,}$/.test(t);

  /* "translated by Rev. John Smith [signed J.S.]" ->
     { role: 'translated by', honorifics: ['Rev.'], rest: 'John Smith', note: 'signed J.S.' } */
  function stripHonorifics(s) {
    let t = str(s).trim();
    let note = '';
    t = t.replace(/\s*\[([^\]]*)\]\s*$/, (m, x) => { note = x; return ''; }).trim();
    const rm = ROLE.exec(t);
    let role = rm ? rm[1].trim() : '';
    if (rm && t.length > rm[0].length) t = t.slice(rm[0].length).trim();
    // ... or end with it: "John Q. Public, editor".
    t = t.replace(/,\s*(editor|eds?\.|translator|trans\.|compiler|comp\.|illustrator|publisher|author)\s*$/i, (m, x) => { role = role || x; return ''; }).trim();
    const toks = t.split(/\s+/);
    const hon = [];
    while (toks.length > 1 && HONORIFICS.has(bare(toks[0]))) hon.push(toks.shift());
    return { role, honorifics: hon, rest: toks.join(' '), note };
  }
  /* The parts of a personal name, either order:
     { surname, given: [tokens], particles: [tokens], suffix, initials: ['b','r'] } or null for
     a body, a single word or an initialism. */
  function parse(raw) {
    let s = stripHonorifics(raw).rest;
    if (!s || CORPORATE.test(' ' + s + ' ') || /\d/.test(s) || isInitialism(s)) return null;
    let suffix = '';
    const sm = /,\s*(jr\.?|sr\.?|ii|iii|iv|esq\.?)\s*$/i.exec(s);
    if (sm) { suffix = sm[1]; s = s.slice(0, sm.index).trim(); }
    let surname, given, particles = [];
    if (s.indexOf(',') !== -1) {                                    // "Public, John Q." / "Mustermann, Max von"
      const [a, b] = [s.slice(0, s.indexOf(',')).trim(), s.slice(s.indexOf(',') + 1).trim()];
      surname = a;
      given = b.split(/\s+/).filter(Boolean);
      while (given.length && PARTICLES.has(given[given.length - 1].toLowerCase())) particles.unshift(given.pop());
    } else {
      const toks = s.split(/\s+/).filter(Boolean);
      if (toks.length < 2) return null;
      if (!suffix && SUFFIXES.has(bare(toks[toks.length - 1])) && toks.length > 2) suffix = toks.pop();
      surname = toks.pop();
      // A capitalized particle belongs to the surname (La Croix, Van Dijk); a lower-case one follows the forenames (Mustermann, Max von).
      while (toks.length > 1 && PARTICLES.has(toks[toks.length - 1].toLowerCase())) {
        const t = toks.pop();
        if (/^[A-Z]/.test(t) && !particles.length) surname = t + ' ' + surname; else particles.unshift(t);
      }
      given = toks;
    }
    if (!surname || !given.length) return null;
    const initials = [];
    given.forEach(t => { if (/^([A-Za-z]\.){2,}$/.test(t)) t.replace(/\./g, '').split('').forEach(c => initials.push(c.toLowerCase())); else initials.push(t.charAt(0).toLowerCase()); });
    return { surname, given, particles, suffix, initials, sk: nameKey(surname), gk: given.map(t => (isInitial(t) ? '' : givenKey(t))) };
  }

  /* A heading to suggest for a credit, in the form an index files it:
     "John Q. Public" -> "Public, John Q."; "Max von Mustermann" -> "Mustermann, Max von";
     "John Henry Doe, Jr." -> "Doe, John Henry, Jr."; bodies, single words and initialisms stay as given.
     Returns { name, nameType, honorifics, roles }. */
  function suggestHeading(raw) {
    const t = str(raw).trim();
    const h = stripHonorifics(t);
    const p = parse(t);
    const extra = { honorifics: h.honorifics.join(' '), roles: h.role };
    if (!p) {
      const corporate = CORPORATE.test(' ' + h.rest + ' ');
      return Object.assign({ name: h.rest || t, nameType: corporate ? 'Corporate body' : h.rest.split(/\s+/).length === 1 || isInitialism(h.rest) ? 'Unknown' : 'Person' }, extra);
    }
    const name = p.surname + ', ' + p.given.join(' ') + (p.particles.length ? ' ' + p.particles.join(' ') : '') + (p.suffix ? ', ' + p.suffix : '');
    return Object.assign({ name, nameType: 'Person' }, extra);
  }
  // "Public, John Q." -> "John Q. Public" (so a heading matches credits in direct order).
  function directOrder(heading) {
    const p = str(heading).indexOf(',') !== -1 ? parse(heading) : null;
    if (!p) return '';
    return p.given.concat(p.particles, [p.surname]).join(' ') + (p.suffix ? ', ' + p.suffix : '');
  }
  const headingKeys = a => Array.from(new Set([nameKey(a.name), nameKey(directOrder(a.name))].concat(splitForms(a.variants).map(nameKey)).filter(Boolean)));

  // ── The names of a library ────────────────────────────────────────────
  /* index(state) -> {
       forms: Map<key, { key, forms: Map<raw, count>, count, items: [contentID] }>   every credited form
       headingOfKey: Map<key, authorityID>,
       entries: [{ id, kind: 'heading'|'name', label, sort, keys, forms: [{raw, count}], count, authority? }]  alphabetical
       conflicts: [{ key, authorityIDs }]  a form claimed by two headings
     } */
  function index(state) {
    const forms = new Map();
    state.contents.forEach(c => splitCredits(c.author).forEach(raw => {
      const key = nameKey(raw);
      if (!key) return;
      if (!forms.has(key)) forms.set(key, { key, forms: new Map(), count: 0, items: [] });
      const f = forms.get(key);
      f.forms.set(raw, (f.forms.get(raw) || 0) + 1);
      f.count++;
      f.items.push(c.contentID);
    }));
    const headingOfKey = new Map(), conflicts = [];
    const auths = Array.from((state.authorities || new Map()).values()).sort((a, b) => (a.entryOrder || 1e9) - (b.entryOrder || 1e9));
    auths.forEach(a => headingKeys(a).forEach(k => {
      if (!headingOfKey.has(k)) headingOfKey.set(k, a.authorityID);
      else if (headingOfKey.get(k) !== a.authorityID) conflicts.push({ key: k, authorityIDs: [headingOfKey.get(k), a.authorityID] });
    }));
    // Each heading's forms in one pass over the forms, in the forms' order (DF-14: looking them up by
    // scanning every form for every heading grew with headings × forms, about 2 s at 2,000 headings
    // and 10,000 items in the browser). The result is the same, entry for entry (tools/test-search.js).
    const keysOf = new Map();
    forms.forEach((f, k) => { const id = headingOfKey.get(k); if (id) (keysOf.get(id) || keysOf.set(id, []).get(id)).push(k); });
    const formList = f => Array.from(f.forms.entries()).map(([raw, count]) => ({ raw, count })).sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
    const entries = [];
    auths.forEach(a => {
      const keys = keysOf.get(a.authorityID) || [];
      const fl = [].concat.apply([], keys.map(k => formList(forms.get(k))));
      entries.push({ id: a.authorityID, kind: 'heading', label: a.name || '(no heading)', sort: sortKey(a.name), keys, forms: fl,
        count: keys.reduce((n, k) => n + forms.get(k).count, 0), authority: a });
    });
    forms.forEach(f => {
      if (headingOfKey.has(f.key)) return;
      const fl = formList(f);
      entries.push({ id: 'k:' + f.key, kind: 'name', label: fl[0].raw, sort: sortKey(suggestHeading(fl[0].raw).name), keys: [f.key], forms: fl, count: f.count });
    });
    entries.sort((a, b) => a.sort.localeCompare(b.sort) || a.label.localeCompare(b.label));
    return { forms, headingOfKey, entries, conflicts };
  }
  // The heading a credit files under, or null.
  function headingFor(state, ix, raw) {
    const id = ix.headingOfKey.get(nameKey(raw));
    return id ? state.authorities.get(id) || null : null;
  }

  // ── Forms that are probably the same person ───────────────────────────
  // Same surname; initials that agree as far as both go; spelled-out names that agree as far as both go.
  function compatible(a, b) {
    if (a.sk !== b.sk) return false;
    const n = Math.min(a.initials.length, b.initials.length);
    for (let i = 0; i < n; i++) {
      if (a.initials[i] !== b.initials[i]) return false;
      const kx = a.gk[i], ky = b.gk[i];
      if (kx && ky && kx.indexOf(ky) !== 0 && ky.indexOf(kx) !== 0) return false;     // "Wm" ~ "William", not "Walter"
    }
    return true;
  }
  const weight = p => p.given.filter(t => !isInitial(t)).length * 10 + p.initials.length;
  // How many initials two forms share from the start.
  const shared = (a, b) => { let n = 0; while (n < a.initials.length && n < b.initials.length && a.initials[n] === b.initials[n]) n++; return n; };
  /* Groups of unheaded forms (two or more keys) that may be one person, largest first:
     [{ keys, forms: [{raw, count}], count, suggestion }]. Short forms that could belong to two
     groups ("J. Public" with "John Public" and "Joan Public") are left out. */
  function suggestGroups(ix) {
    const names = [];
    ix.entries.forEach(e => { if (e.kind === 'name') { const p = parse(e.label); names.push({ e, p }); } });
    const people = names.filter(x => x.p).sort((a, b) => weight(b.p) - weight(a.p) || b.e.count - a.e.count);
    const groups = [], bySurname = new Map();
    people.forEach(x => {
      const same = bySurname.get(x.p.sk) || [];
      let fits = same.filter(g => g.members.every(m => compatible(m.p, x.p)));
      // Where a form fits several, the group that agrees on more initials wins ("J. Q. Public": John Q., not Joan).
      if (fits.length > 1) {
        const score = g => Math.max.apply(null, g.members.map(m => shared(m.p, x.p)));
        const best = Math.max.apply(null, fits.map(score));
        fits = fits.filter(g => score(g) === best);
      }
      if (fits.length === 1) fits[0].members.push(x);
      else if (!fits.length) { const g = { members: [x] }; groups.push(g); same.push(g); bySurname.set(x.p.sk, same); }
    });
    // Initialisms ("J.Q.P.") join the one group whose initials and surname they spell.
    names.filter(x => !x.p && isInitialism(x.e.label)).forEach(x => {
      const letters = x.e.label.replace(/[^A-Za-z]/g, '').toLowerCase();
      const fits = groups.filter(g => g.members.some(m => m.p && m.p.initials.join('') + nameKey(m.p.surname).charAt(0) === letters));
      if (fits.length === 1) fits[0].members.push(x);
    });
    return groups.filter(g => g.members.length > 1).map(g => {
      // The fullest form leads: most spelled-out forenames, then the longest, then the most credited.
      const letters = p => p.given.filter(t => !isInitial(t)).join('').replace(/\./g, '').length;
      const lead = g.members.filter(m => m.p).sort((a, b) => weight(b.p) - weight(a.p) || letters(b.p) - letters(a.p) || b.e.count - a.e.count)[0];
      return {
        keys: g.members.map(m => m.e.keys[0]),
        forms: [].concat.apply([], g.members.map(m => m.e.forms)).sort((a, b) => b.count - a.count),
        count: g.members.reduce((n, m) => n + m.e.count, 0),
        suggestion: suggestHeading(lead.e.label).name
      };
    }).sort((a, b) => b.count - a.count);
  }

  // A credit without what surrounds the name: { name: 'Jane Roe', role: 'translated by', honorifics, note }.
  function cleanCredit(raw) { const h = stripHonorifics(raw); return { name: h.rest, role: h.role, honorifics: h.honorifics.join(' '), note: h.note }; }

  SC.names = { cleanCredit, splitCredits, splitForms, joinForms, nameKey, sortKey, parse, suggestHeading, directOrder, headingKeys, index, headingFor, compatible, suggestGroups, isInitialism };
})(globalThis.SC = globalThis.SC || {});
