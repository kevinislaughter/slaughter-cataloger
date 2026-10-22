/* Slaughter Cataloger 3 — identifiers.
   TitleID   TITLECOD-YYYY            (Title Code + First Year of Publication (CE))
   IssueID   TITLECOD-YYYY-Kxxxxxx    (permanent, never regenerated on edit)
   ContentID TITLECOD-YYYY-Cxxxxxx    (new in 3.0; permanent key for a contents item)
   AuthorityID AU-xxxxxx              (a name heading; library-wide) */
(function (SC) {
  'use strict';

  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWYZ';   // no I O 0 1 L X
  const WEAK_WORDS = ['THE', 'A', 'AN', 'AND', 'OF', 'FOR', 'IN', 'ON', 'AT', 'TO', 'BY'];

  const RE = {
    slug: /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
    titleCode: /^[A-Z0-9]{8}$/,
    firstYear: /^(\d{4}|\d{3}X|\d{2}XX|XXXX)$/,
    titleID: /^[A-Z0-9]{8}-(\d{4}|\d{3}X|\d{2}XX|XXXX)$/,
    issueID: /^[A-Z0-9]{8}-(\d{4}|\d{3}X|\d{2}XX|XXXX)-K[23456789ABCDEFGHJKMNPQRSTUVWYZ]{6}$/,
    contentID: /^[A-Z0-9]{8}-(\d{4}|\d{3}X|\d{2}XX|XXXX)-C[23456789ABCDEFGHJKMNPQRSTUVWYZ]{6}$/,
    authorityID: /^AU-[23456789ABCDEFGHJKMNPQRSTUVWYZ]{6}$/
  };

  function titleStem(title) {
    const words = String(title || '').toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    let sig = words.filter(w => WEAK_WORDS.indexOf(w) === -1);
    if (!sig.length) sig = words;
    if (!sig.length) return 'XXXXXXX';
    let stem;
    if (sig.length === 1) stem = sig[0].slice(0, 7);
    else if (sig.length === 2) stem = sig[0].slice(0, 3) + sig[1].slice(0, 4);
    else if (sig.length === 3) stem = sig[0].slice(0, 3) + sig[1].slice(0, 2) + sig[2].slice(0, 2);
    else stem = sig[0].slice(0, 2) + sig[1].slice(0, 2) + sig[2].slice(0, 2) + sig[3].slice(0, 1);
    return (stem + 'XXXXXXX').slice(0, 7);
  }

  // Suggest a Title Code; if the default (stem + X) is taken, use 1..9 as the discriminator.
  function suggestTitleCode(title, takenCodes) {
    const stem = titleStem(title);
    const taken = takenCodes || new Set();
    const candidates = ['X', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (const d of candidates) if (!taken.has(stem + d)) return stem + d;
    return stem + 'X';
  }

  function token(len) {
    let s = '';
    const buf = new Uint32Array(len);
    (globalThis.crypto && crypto.getRandomValues) ? crypto.getRandomValues(buf) : buf.forEach((_, i) => { buf[i] = Math.floor(Math.random() * 4294967296); });
    for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
    return s;
  }

  function uniqueID(prefix, exists) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const id = prefix + token(6);
      if (!exists(id)) return id;
    }
    throw new Error('Could not generate a unique ID for ' + prefix);
  }

  const newIssueID = (titleID, exists) => uniqueID(titleID + '-K', exists);
  const newContentID = (titleID, exists) => uniqueID(titleID + '-C', exists);
  // A name heading belongs to the library, not to a title: AU-7M4Q2B.
  const newAuthorityID = exists => uniqueID('AU-', exists);
  const titleIDOf = (code, year) => (RE.titleCode.test(code) && RE.firstYear.test(year)) ? code + '-' + year : '';
  // The TitleID an IssueID or ContentID starts with (older IDs may use a different code after it).
  const titleIDFromChild = id => { const m = /^([A-Z0-9]{8}-(?:\d{4}|\d{3}X|\d{2}XX|XXXX))-/.exec(id || ''); return m ? m[1] : ''; };

  function safeFilePart(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9._-]/g, '');
  }

  SC.ids = { RE, ALPHABET, titleStem, suggestTitleCode, newIssueID, newContentID, newAuthorityID, titleIDOf, titleIDFromChild, safeFilePart };
})(globalThis.SC = globalThis.SC || {});
