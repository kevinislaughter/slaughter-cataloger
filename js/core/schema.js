/* Slaughter Cataloger 3 — the schema.
   Every column of every CSV is defined exactly once, here. Forms, tables, the
   CSV reader/writer, the unaddressed check, Speculative/N/A lists and the
   Compiler all derive from these definitions.

   Column properties
     header        canonical CSV header (3.0). Also the name used in Speculative / N/A lists.
     key           property name on the record (absent for pure metadata columns)
     meta          metadata column handled by records.js (tool, schema, library, derived values)
     aliases       other CSV headers accepted on read (older files)
     labelAliases  other names accepted inside 2.x Speculative / N/A lists
     label, tip    form label and tooltip
     type          text | long | enum | bool | int | months
     group, span   form grouping and width (of 4 columns)
     states        '?' and N/A toggles allowed (default true for user fields)
     noNA          '?' allowed but N/A not allowed
     required      must be filled to record
     inherit       (issues) title field this issue field inherits from
     sticky        (issues) value carries forward to the next new issue
     advance       (issues) value moves on for the next new issue (see numbering.js)
     form          position within its form group when it differs from CSV order
*/
(function (SC) {
  'use strict';

  const VERSION = '3.0';
  const LEGACY_VERSIONS = ['2.0'];        // read only by tools/convert-to-3.js
  // Spreadsheets turn "2.0" into "2"; treat any numeric spelling as the same version.
  function normalizeVersion(v) {
    const t = String(v == null ? '' : v).trim();
    const n = parseFloat(t);
    return /^\d+(\.\d+)?$/.test(t) && !isNaN(n) ? n.toFixed(1) : t;
  }

  const CATALOGING_STATUS = ['Not started', 'Issues in progress', 'Issues complete',
    'Contents in progress', 'Contents complete', 'Fully cataloged', 'On hold'];

  // ── Titles ────────────────────────────────────────────────────────────
  const TITLE = [
    { header: 'Slaughter Cataloger Tool', meta: 'tool' },
    { header: 'Schema Version', meta: 'schema' },
    { header: 'Title Library Slug', meta: 'librarySlug' },
    { header: 'Title Library Name', meta: 'libraryName' },
    { header: 'Title Library Note', meta: 'libraryNote' },
    { header: 'TitleID', key: 'titleID', type: 'id', states: false },
    { header: 'Title Code', key: 'titleCode', label: 'Title code', group: 'identity', form: 1, required: true, states: false,
      tip: 'Eight characters: a seven-letter stem from the title plus a discriminator (X, or 1–9 if taken). Forms the first half of TitleID; fixed once issues exist.' },
    { header: 'First Year of Publication (CE)', key: 'firstYear', label: 'First year (CE)', group: 'identity', form: 2, required: true, noNA: true,
      tip: 'First known or inferred year of the run, in CE terms even if the publication used another calendar. YYYY, YYYX, YYXX or XXXX. Mark ? if inferred.' },
    { header: 'First Year Note', key: 'firstYearNote', label: 'First year note', group: 'identity', form: 3, span: 2,
      tip: 'How the first year was established, e.g. "Inferred from first surviving issue."' },
    { header: 'First Year Speculative', meta: 'firstYearSpeculative' },
    { header: 'Canonical Title', key: 'canonicalTitle', label: 'Canonical title', group: 'identity', form: 0, span: 4, required: true, noNA: true,
      tip: 'The title as it should be cited across the whole run.' },
    { header: 'Original / First Published Title', key: 'originalTitle', label: 'Original title', group: 'titles', span: 2,
      tip: 'The title under which the run began, if different from the canonical title.' },
    { header: 'Subtitle', key: 'subtitle', label: 'Subtitle', group: 'titles', span: 2 },
    { header: 'Former Title(s)', key: 'formerTitles', label: 'Former titles', group: 'titles', span: 2, tip: 'Semicolon-separated.' },
    { header: 'Later Title(s)', key: 'laterTitles', label: 'Later titles', group: 'titles', span: 2, tip: 'Semicolon-separated.' },
    { header: 'Related Title(s)', key: 'relatedTitles', label: 'Related titles', group: 'titles', span: 4, tip: 'Semicolon-separated.' },
    { header: 'Publisher', key: 'publisher', label: 'Publisher', group: 'publication', span: 2 },
    { header: 'Editor(s)', key: 'editors', label: 'Editors', group: 'publication', span: 2, tip: 'Semicolon-separated.' },
    { header: 'City', key: 'city', label: 'City', group: 'publication' },
    { header: 'State / Province', key: 'state', label: 'State / province', group: 'publication', labelAliases: ['State/Province', 'State'] },
    { header: 'Country', key: 'country', label: 'Country', group: 'publication' },
    { header: 'Language', key: 'language', label: 'Language', group: 'publication' },
    { header: 'Frequency', key: 'frequency', label: 'Frequency', group: 'publication', span: 2 },
    { header: 'ISSN', key: 'issn', label: 'ISSN', group: 'publication' },
    { header: 'Publication History Note', key: 'pubHistory', label: 'Publication history', type: 'long', group: 'notes', span: 4 },
    { header: 'Mission Statement / Prospectus', key: 'mission', label: 'Mission statement / prospectus', type: 'long', group: 'notes', span: 4, labelAliases: ['Mission Statement'] },
    { header: 'Introduction / Editorial Statement', key: 'editorial', label: 'Introduction / editorial statement', type: 'long', group: 'notes', span: 4 },
    { header: 'Bibliographic Note', key: 'biblioNote', label: 'Bibliographic note', type: 'long', group: 'notes', span: 4 },
    { header: 'Cataloging Status', key: 'catalogingStatus', label: 'Cataloging status', type: 'enum', options: CATALOGING_STATUS, group: 'status', span: 2, states: false },
    { header: 'Total Known Issues', key: 'knownIssues', label: 'Total known issues', type: 'int', group: 'status',
      tip: 'How many issues are known to exist. Used to measure progress and find gaps.' },
    { header: 'Expected Issues Filename', meta: 'expectedIssuesFile' },
    { header: 'Expected Contents Filename', meta: 'expectedContentsFile' },
    { header: 'General Notes', key: 'generalNotes', label: 'General notes', type: 'long', group: 'notes', span: 4 },
    { header: 'Speculative', meta: 'speculative' },
    { header: 'Speculative Fields', meta: 'spec' },
    { header: 'N/A Fields', meta: 'na' },
    { header: 'Entry Order', meta: 'entryOrder' }
  ];

  const TITLE_GROUPS = [
    { id: 'identity', label: 'Identity' },
    { id: 'titles', label: 'Title history' },
    { id: 'publication', label: 'Publication' },
    { id: 'notes', label: 'Notes' },
    { id: 'status', label: 'Cataloging' }
  ];

  // ── Issues ────────────────────────────────────────────────────────────
  const ISSUE = [
    { header: 'Slaughter Cataloger Tool', meta: 'tool' },
    { header: 'Schema Version', meta: 'schema' },
    { header: 'Title Library Slug', meta: 'librarySlug' },
    { header: 'Title Library Name', meta: 'libraryName' },
    { header: 'Entry Order', meta: 'entryOrder' },
    { header: 'IssueID', key: 'issueID', type: 'id', states: false },
    { header: 'TitleID', key: 'titleID', type: 'id', states: false },
    { header: 'Title Code', meta: 'titleCode' },
    { header: 'First Year of Publication (CE)', meta: 'firstYear' },
    { header: 'Title', key: 'title', label: 'Title', group: 'title', span: 2, inherit: 'canonicalTitle',
      tip: 'The title as it appears on this issue.' },
    { header: 'Subtitle', key: 'subtitle', label: 'Subtitle', group: 'title', span: 2, inherit: 'subtitle' },
    { header: 'Former Title(s)', key: 'formerTitle', label: 'Former titles', group: 'title', span: 2, inherit: 'formerTitles' },
    { header: 'Later Title(s)', key: 'laterTitle', label: 'Later titles', group: 'title', span: 2, inherit: 'laterTitles' },
    { header: 'Publisher', key: 'publisher', label: 'Publisher', group: 'title', span: 2, inherit: 'publisher' },
    { header: 'Editor(s)', key: 'editors', label: 'Editors', group: 'title', span: 2, inherit: 'editors',
      tip: 'Masthead editors for the run. Guest or issue-specific editors belong in Contributors.' },
    { header: 'Contributors', key: 'contributors', label: 'Contributors', group: 'issue', span: 4, form: 3,
      tip: 'People credited on this issue but not on the regular masthead. Semicolon-separated.' },
    { header: 'Printer', key: 'printer', label: 'Printer', group: 'physical', span: 2, sticky: true, form: 5 },
    { header: 'Printer Location', key: 'printerLocation', label: 'Printer location', group: 'physical', span: 2, sticky: true, form: 6 },
    { header: 'ISSN', key: 'issn', label: 'ISSN', group: 'title', inherit: 'issn' },
    { header: 'Language', key: 'language', label: 'Language', group: 'title', inherit: 'language' },
    { header: 'Frequency', key: 'frequency', label: 'Frequency', group: 'title', span: 2, inherit: 'frequency' },
    { header: 'Series', key: 'series', label: 'Series', group: 'numbering', sticky: true, form: 5,
      tip: 'A named series such as "New Series". Not the same as volume numbering.' },
    { header: 'Series Number', key: 'seriesNumber', label: 'Series no.', group: 'numbering', form: 6, labelAliases: ['Series No.'],
      tip: 'Number within a named series. Advances with Issue / no.' },
    { header: 'City', key: 'city', label: 'City', group: 'title', inherit: 'city' },
    { header: 'State', key: 'state', label: 'State / province', group: 'title', inherit: 'state', labelAliases: ['State/Province', 'State / Province'] },
    { header: 'Country', key: 'country', label: 'Country', group: 'title', inherit: 'country' },
    { header: 'Short Name', key: 'shortname', label: 'Short name', group: 'issue', span: 2, form: 1,
      tip: 'Compact label for lists and contents. A new issue follows the pattern of the one before it until you type your own.' },
    { header: 'Edition', key: 'edition', label: 'Edition', group: 'issue', span: 2, form: 2, sticky: true,
      tip: 'Distinguishes simultaneous editions of the same issue, e.g. City vs National.' },
    { header: 'Volume', key: 'volume', label: 'Volume', group: 'numbering', form: 1, advance: true },
    { header: 'Issue', key: 'issue', label: 'Issue / no.', group: 'numbering', form: 2, advance: true, labelAliases: ['Issue / No.'],
      tip: 'Number within the volume.' },
    { header: 'Whole No.', key: 'number', label: 'Whole no.', group: 'numbering', form: 3, advance: true, aliases: ['Number'],
      tip: 'Running count of issues from the first issue, across volumes.' },
    { header: 'Special Issue', key: 'specialIssue', label: 'Special issue', type: 'bool', group: 'numbering', form: 4, states: false },
    { header: 'Issue Designation', key: 'issueDesignation', label: 'Designation', group: 'numbering', form: 7, span: 2,
      tip: 'e.g. Special Poetry Issue, Double Issue, Anniversary Number.' },
    { header: 'Month(s)', key: 'months', label: 'Months', type: 'months', group: 'date', span: 2, form: 1, advance: true,
      tip: 'Type them, or click the months below: Mar–Apr, Dec–Jan, Autumn.' },
    { header: 'Date Type', key: 'dateType', label: 'Date type', type: 'enum', options: ['Months', 'Season'], group: 'date', form: 2, states: false, sticky: true },
    { header: 'Day', key: 'day', label: 'Day', group: 'date', form: 3, tip: 'For daily or weekly titles: 14, Tuesday, Christmas.' },
    { header: 'Date as Printed', key: 'datePrinted', label: 'Date as printed', group: 'date', span: 2, form: 6,
      tip: 'Transcribed exactly as it appears on the issue.' },
    { header: 'Year', key: 'year', label: 'Year', group: 'date', form: 4 },
    { header: 'End Year', key: 'yearEnd', label: 'End year', group: 'date', form: 5, states: false,
      tip: 'For an issue spanning a year boundary, e.g. Dec. 1964 – Jan. 1965.' },
    { header: 'Year Calendar', key: 'yearCalendar', label: 'Calendar', type: 'enum', options: ['CE', 'Non-CE'], group: 'date', form: 7, states: false, sticky: true },
    { header: 'Calendar Note', key: 'calendarNote', label: 'Calendar note', group: 'date', span: 2, form: 8, states: false, sticky: true },
    { header: 'Price', key: 'price', label: 'Price', group: 'physical', form: 4, sticky: true, tip: 'The cover price as printed.' },
    { header: 'Pages', key: 'pages', label: 'Pages', group: 'physical', form: 1, sticky: true },
    { header: 'Size', key: 'size', label: 'Size', group: 'physical', form: 2, sticky: true, tip: 'Width × height.' },
    { header: 'Size Unit', key: 'sizeUnit', label: 'Unit', type: 'enum', options: ['in', 'cm'], group: 'physical', form: 3, states: false, sticky: true },
    { header: 'Supplement', key: 'supplement', label: 'Supplement', type: 'bool', group: 'numbering', form: 8, states: false },
    { header: 'Supplement Label', key: 'supplementLabel', label: 'Supplement label', group: 'numbering', form: 9, span: 3 },
    { header: 'Notes on Issue', key: 'notes', label: 'Notes on issue', type: 'long', group: 'issue', span: 4, form: 4,
      tip: 'About the issue as published — true of every copy. Not about your copy.' },
    { header: 'Evidence Basis', key: 'evidence', label: 'Evidence', type: 'enum', options: ['Examined', 'Reported'], group: 'evidence', form: 1, states: false, sticky: true, aliases: ['Basis of Record'] },
    { header: 'Evidence Note', key: 'evidenceNote', label: 'Evidence note', group: 'evidence', span: 3, form: 2, states: false, sticky: true, aliases: ['Examined Source'] },
    { header: 'Speculative', meta: 'speculative' },
    { header: 'Speculative Fields', meta: 'spec' },
    { header: 'N/A Fields', meta: 'na' },
    { header: 'Overridden Fields', meta: 'overrides' }
  ];

  // ── Contents ──────────────────────────────────────────────────────────
  const CONTENT = [
    { header: 'Slaughter Cataloger Tool', meta: 'tool' },
    { header: 'Schema Version', meta: 'schema' },
    { header: 'Title Library Slug', meta: 'librarySlug' },
    { header: 'TitleID', meta: 'titleID' },
    { header: 'Entry Order', meta: 'entryOrder' },
    { header: 'ContentID', key: 'contentID', type: 'id', states: false },
    { header: 'IssueID', key: 'issueID', type: 'id', states: false },
    { header: 'Issue Reference', meta: 'issueRef' },
    { header: 'Sequence', key: 'sequence', label: 'Seq', required: true, noNA: true },
    { header: 'Item Title', key: 'itemTitle', label: 'Item title', required: true, noNA: true,
      tip: 'As printed. Supply a bracketed title for untitled items, e.g. [Advertisement], and mark it ?.' },
    { header: 'Author / Credit', key: 'author', label: 'Author / credit', aliases: ['Author'] },
    { header: 'Content Type', key: 'contentType', label: 'Type' },
    { header: 'Parent Item', key: 'parentItem', label: 'Parent' },
    { header: 'Parent ContentID', meta: 'parentID' },
    { header: 'Start Page', key: 'startPage', label: 'Start pg' },
    { header: 'End Page', key: 'endPage', label: 'End pg' },
    { header: 'Notes', key: 'notes', label: 'Notes' },
    { header: 'Speculative', meta: 'speculative' },
    { header: 'Speculative Fields', meta: 'spec' },
    { header: 'N/A Fields', meta: 'na' }
  ];

  // ── Name authorities ──────────────────────────────────────────────────
  // One file per library. Contents keep each credit as printed; a heading gathers the
  // forms a name is credited under. Columns are a superset of the earlier
  // AUTHORITY_<TitleID>.csv lists (AuthorizedForm, Type, VariantForms, Roles, Honorifics, Notes, Status).
  const NAME_TYPES = ['Person', 'Corporate body', 'Pseudonym', 'Unknown'];
  const NAME_STATUS = ['Needs review', 'Confirmed'];
  const AUTHORITY = [
    { header: 'Slaughter Cataloger Tool', meta: 'tool' },
    { header: 'Schema Version', meta: 'schema' },
    { header: 'Title Library Slug', meta: 'librarySlug' },
    { header: 'Entry Order', meta: 'entryOrder' },
    { header: 'AuthorityID', key: 'authorityID', type: 'id', states: false },
    { header: 'Authorized Form', states: false, key: 'name', label: 'Heading', span: 2, required: true, noNA: true, aliases: ['AuthorizedForm'], group: 'name', form: 1,
      tip: 'The form the name files under in an index, usually surname first: "Public, John Q."' },
    { header: 'Type', key: 'nameType', label: 'Type', type: 'enum', options: NAME_TYPES, states: false, group: 'name', form: 2 },
    { header: 'Dates', states: false, key: 'dates', label: 'Dates', group: 'name', form: 3, tip: 'Life dates or years of activity: 1840–1910, fl. 1890s.' },
    { header: 'Variant Forms', states: false, key: 'variants', label: 'Forms found', type: 'long', span: 4, aliases: ['VariantForms'], group: 'forms',
      tip: 'The ways the name is credited in the contents, separated by " | ".' },
    { header: 'See Also', states: false, key: 'seeAlso', label: 'See also', span: 2, group: 'name', form: 4,
      tip: 'Another heading for the same person or body, such as the real name behind a pseudonym.' },
    { header: 'Roles', states: false, key: 'roles', label: 'Roles', span: 2, group: 'more' },
    { header: 'Honorifics', states: false, key: 'honorifics', label: 'Honorifics', span: 2, group: 'more', tip: 'Titles credited with the name: Rev., Dr., Prof.' },
    { header: 'Sources', states: false, key: 'sources', label: 'Sources', type: 'long', span: 4, group: 'more', tip: 'Where the heading comes from: LC, VIAF, Wikidata, a biography.' },
    { header: 'Notes', states: false, key: 'notes', label: 'Notes', type: 'long', span: 4, group: 'more' },
    { header: 'Status', key: 'status', label: 'Status', type: 'enum', options: NAME_STATUS, states: false, group: 'name', form: 5 },
    { header: 'Speculative', meta: 'speculative' },
    { header: 'Speculative Fields', meta: 'spec' },
    { header: 'N/A Fields', meta: 'na' }
  ];

  function prepare(tool, cols) {
    cols.forEach((c, i) => {
      c.order = i;
      if (!c.meta) {
        if (c.states === undefined) c.states = c.type !== 'bool' && c.type !== 'enum' && c.type !== 'id';
        if (!c.type) c.type = 'text';
        if (!c.span) c.span = 1;
      }
      Object.freeze(c);
    });
    const byHeader = new Map(), byKey = new Map(), byLabelAlias = new Map();
    cols.forEach(c => {
      byHeader.set(c.header, c);
      (c.aliases || []).forEach(a => byHeader.has(a) || byHeader.set(a, c));
      if (c.key) byKey.set(c.key, c);
      byLabelAlias.set(c.header, c.header);
      if (c.key && !byLabelAlias.has(c.key)) byLabelAlias.set(c.key, c.header);   // internal names, e.g. "firstYear"
      (c.labelAliases || []).forEach(a => byLabelAlias.has(a) || byLabelAlias.set(a, c.header));
    });
    const formOrder = c => (c.form != null ? c.form : 100 + c.order);
    return Object.freeze({
      // Fields of one form group, in the order a person fills them in.
      groupFields: g => cols.filter(c => c.key && c.type !== 'id' && c.group === g).sort((a, b) => formOrder(a) - formOrder(b)),
      tool, columns: Object.freeze(cols.slice()), headers: cols.map(c => c.header),
      fields: cols.filter(c => c.key && c.type !== 'id'),
      byHeader, byKey,
      // Normalize a name found in a Speculative / N/A list to its canonical header.
      canonicalState: name => byLabelAlias.get(name) || name
    });
  }

  const entities = {
    title: prepare('Titles', TITLE),
    issue: prepare('Issues', ISSUE),
    content: prepare('Contents', CONTENT),
    authority: prepare('Authorities', AUTHORITY)
  };
  const kindOfTool = { Titles: 'title', Issues: 'issue', Contents: 'content', Authorities: 'authority' };

  // Issue field key -> title field key, for the twelve inherited fields.
  const INHERIT = {};
  entities.issue.fields.forEach(f => { if (f.inherit) INHERIT[f.key] = f.inherit; });

  SC.schema = Object.freeze({
    VERSION, LEGACY_VERSIONS, normalizeVersion, CATALOGING_STATUS, TITLE_GROUPS, NAME_TYPES, NAME_STATUS, entities, kindOfTool, INHERIT,
    // In the order a person works through an issue in hand; title-level fields last.
    ISSUE_GROUPS: [
      { id: 'numbering', label: 'Numbering' },
      { id: 'date', label: 'Date' },
      { id: 'issue', label: 'Issue' },
      { id: 'physical', label: 'Physical' },
      { id: 'evidence', label: 'Evidence' },
      { id: 'title', label: 'Title level', note: 'inherited from the title unless this issue says otherwise' }
    ]
  });
})(globalThis.SC = globalThis.SC || {});
