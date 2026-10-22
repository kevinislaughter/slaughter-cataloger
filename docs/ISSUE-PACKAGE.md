# Issue packages: format `slaughter-cataloger-issue` 1.0

**Status:** specification, version 1.0, **frozen** on 2026-10-14 after independent review. Drafted and amended (§17) the same day. Any further change is a new version, under the rules of §2.
**Implemented by:**
- `js/core/issuepkg.js` (reading and validation);
- `js/core/zipread.js` (archives);
- `tools/validate-issue.js`;
- `tools/convert-staging.js`.

**Examples,** both invented and written by `tools/make-issue-fixture.js`:
- `sample-data/issue-package/native/`: an issue converted from a staging package;
- `sample-data/issue-package/booklet/`: a leaflet scanned as two-up spreads, with page locations and an unresolved catalog identity.

An issue package holds what the CSV catalog does not:
- the page-by-page transcription of one issue;
- how that text divides into the issue's contents items;
- a private index of mentions;
- the cover and the source file;
- where it all came from;
- the publication decisions for each part.

It never replaces the catalog. Titles, Issues, Contents and Authorities stay in their 3.0 CSV files, unchanged. A catalog works the same with or without packages.

This document is for programmers who write or read packages. The keywords **must**, **must not** and **may** are used in their ordinary sense.

---

## 1. Scope and principles

1. **One package, one issue.** A package belongs to exactly one issue. Once its catalog identity is resolved, that is one IssueID of one TitleID. Until then, it says so and carries no made-up ID (§4).
2. **The CSV schema does not change.** The candidate Contents rows a package carries use the exact 3.0 Contents headers. Once imported, they live in the title's Contents CSV like any other row; the package keeps only the text, the assets and the link between them.
3. **One authority for the text.** The text of each page is stored once. An item's text is never stored: it is put together from the page text by offsets (§5). So is the whole transcription.
4. **Offsets count Unicode code points.**
   - They are not bytes, and not UTF-16 units. JavaScript readers convert with `cpIndex()`.
   - They are not grapheme clusters: `e` followed by U+0301 is two code points.
5. **Strict.** A reader refuses a package it cannot vouch for and says why (§14). It never repairs, guesses or silently drops anything.
6. **Nothing is lost.**
   - Fields a reader does not know are kept and reported (§2, §11).
   - A package converted from another format keeps every original file byte for byte (§11, §12).
7. **Deny by default.** Nothing in a package may be published unless a person has recorded an `allow` for that resource and purpose (§9).

---

## 2. Versions and compatibility

**Version numbers.** `issue.json` carries `"format": "slaughter-cataloger-issue"` and `"format_version": "MAJOR.MINOR"`, now `"1.0"`. Each JSON part (`text.json`, `items.json`, `mentions.json`, `rights.json`) carries its own `format_version`.

**Reading an unknown version:**
- A reader **must refuse** a package whose `format` is different, or whose MAJOR version it does not know. This also applies to any part.
- A reader **must accept** a newer MINOR version of a major it knows (1.1 when it knows 1.0). It reports the fields it does not know, but does not refuse them.

**Unknown fields:**
- Fields this version does not define are allowed in any object, and **must be kept** by every reader and writer.
- `validate()` lists each one as an `unknown-field` warning. A writer adding producer-specific data should prefer `origin` (§11).

**Versions are independent.** The issue-package version is separate from the CSV schema version (3.0) and from the public-bundle format of later phases.

---

## 3. Layout and file roles

A package is a folder, or a ZIP archive of one. The layout is the same in both, and the same once installed in a library under `_issues/<TitleID>/<IssueID>/`. The 3.0 app reads only the top-level `*.csv` files of a library folder, so it ignores installed packages.

| Path | Role | Required | Holds |
|---|---|---|---|
| `issue.json` | (descriptor) | yes | format, identity, content map, cover, sources, review, provenance, file inventory (§4) |
| `text.json` | `text` | no | pages, segments, unassigned spans (§5) |
| `items.json` | `items` | while any item has no ContentID | candidate Contents rows (§7) |
| `mentions.json` | `mentions` | no | entities and subjects mentioned in the text (§8) |
| `rights.json` | `rights` | **yes** | rights status, publication decisions, withheld spans (§9) |
| `cover.jpg` or `cover.png` | `cover` | no | the cover image, as received (§10) |
| `source/…` | `source` | no | source files, such as the scanned PDF (§10) |
| `provenance/…` | `provenance` | no | original files and the conversion report (§11) |

**Rules:**
- Every file except `issue.json` **must** be listed in `issue.json › files` with its role, size and SHA-256. An unlisted file, or a listed file that is missing, is refused.
- The four part files have fixed names. Source files live under `source/`, provenance files under `provenance/`. The cover's path is the one `issue.json › cover.path` names.
- There are no other places. Anything else a producer wants to keep goes under `provenance/`.
- **Where `issue.json` sits.** In an archive or folder, it is at the top or inside exactly one top-level folder that holds everything. Archive tools often add such a folder; readers strip it.
- **Operating-system leftovers** (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*` files, a `__MACOSX/` folder) are not part of any package. Readers skip them with an `os-file` warning, and the converter leaves them out and says so in its report.
- **Encoding.** JSON files are UTF-8 without a byte-order mark. The package's own writers use a 2-space indent and a final newline (`issuepkg.serialize`), so reading and writing a file gives back the same bytes.

---

## 4. `issue.json`: identity, content map, inventory

```json
{
  "format": "slaughter-cataloger-issue",
  "format_version": "1.0",
  "package_id": "example-gazette-v4n1-1875-provisional-import-candidate",
  "state": "candidate",
  "identity": {
    "library_slug": "EXAMPLE-LIBRARY",
    "title_id": "EXAGAZEX-1872",
    "issue_id": null,
    "working_issue_id": "EXAGAZEX-1872-KRNYWA2",
    "designation": "The Example Gazette, Vol. IV, No. 1, May 1, 1875",
    "identity_history": [
      { "id": "EXAGAZEX-1872-KQ7RW4M", "status": "superseded", "note": "superseded staging-only reference, not active" }
    ]
  },
  "content_map": { "gazette-v4n1-item-0001": null, "gazette-v4n1-item-0002": null },
  "cover": { "path": "cover.jpg", "media_type": "image/jpeg", "width": 156, "height": 200, "source_page": 1 },
  "sources": [ { "path": "source/example-gazette-v4n1.pdf", "media_type": "application/pdf", "original_name": "example-gazette-v4n1.pdf", "pages": 8 } ],
  "review": [ { "id": "Q-01", "status": "blocking", "label": "…", "summary": "…", "blocks": ["local_import"] } ],
  "provenance": { "…": "§11" },
  "files": [ { "path": "cover.jpg", "role": "cover", "bytes": 2244, "sha256": "546fffac…" } ],
  "inventory_sha256": "d5935dcc…"
}
```

### Fields

| Field | Rule |
|---|---|
| `package_id` | 1–128 characters: letters, digits, `.`, `_`, `-`, starting with a letter or digit. It is package-local, never a catalog ID, and **must not** be shaped like one. A package converted from a staging package keeps the staging package's id. |
| `state` | `candidate`: not yet imported; items may have no ContentID. `installed`: imported; then the identity is `resolved`, and `identity.issue_id` and every ContentID in `content_map` **must** be set. |
| `identity.status` | `resolved` (the default when absent), `title-resolved` or `unresolved`. See *Unresolved identity* below. |
| `identity.title_id` | A TitleID (`TITLECOD-YYYY`), or `null` while `unresolved` |
| `identity.issue_id` | The settled IssueID, or `null` while it is still being checked against the live catalog |
| `identity.working_issue_id` | The IssueID used while staging, or `null` |
| `identity.provisional_key` | Required while anything is unresolved; absent once `resolved`. Package-local: same characters as `package_id`, and **never shaped like a catalog ID**. |
| `identity.library_slug`, `designation` | Optional. The slug of the library, and the issue as a person would cite it. |
| `identity.identity_history` | What this issue was once known by: typed entries (below) |
| `content_map` | Every package-local item key, mapped to its ContentID, or `null` until the importer assigns one (Phase 4). |
| `files` | Every file but `issue.json`, each with `path`, `role`, `bytes` and `sha256` (64 lowercase hex digits). |
| `inventory_sha256` | The hash over `files` (below). |

### Identity rules (checked)

- **The active IssueID** of a `resolved` package is `issue_id`, or `working_issue_id` if there is no `issue_id`. At least one is required. If both are given they **must** be equal: once an IssueID is settled, a different working ID belongs in `identity_history`.
- **Same title.** Every IssueID and ContentID **must** start with the package's TitleID. Older ID patterns are accepted, with a warning.
- **Superseded IDs** **must not** be the active IssueID, and **must not** appear in any candidate row.
- **ContentIDs** in `content_map` are unique. Keys are exactly the item keys of `items.json` when it is present.

### Unresolved identity

An ingestion package may arrive before anyone has checked it against the live catalog. Its title may not even be in the catalog yet. **The format never asks for a made-up catalog ID to fill the gap.** The identity says what is settled instead:

| `identity.status` | `title_id` | `issue_id`, `working_issue_id` | `provisional_key` | Candidate rows |
|---|---|---|---|---|
| `resolved` (default) | a TitleID | at least one, as above | absent | TitleID and IssueID as above |
| `title-resolved` (a known title; this issue not yet matched) | a TitleID | both `null` | required | TitleID as `title_id`; **IssueID empty** |
| `unresolved` (neither matched) | `null` | both `null` | required | **TitleID and IssueID empty** |

**Rules:**
- While anything is unresolved, every `content_map` value is `null` and every row's `ContentID` is empty.
- The package can only be a `candidate`. It cannot be `installed`, because it has no `_issues/<TitleID>/<IssueID>/` to go to.
- **No placeholders.** No field may hold a value shaped like a TitleID, IssueID, ContentID or AuthorityID that is not a real one. In particular, a `provisional_key`, a `package_id` or a retired key shaped like one is refused, in any letter case: a lookalike could be pasted into a CSV and taken for real.

**Resolving** is the first step of the import plan (Phase 4). The plan matches the issue against the live catalog, or proposes new IDs for a person to approve. The resolved package is then written out as a new copy:
- the IDs are filled in;
- `status` becomes `resolved`;
- the provisional key moves into `identity_history`.

```json
"identity": {
  "status": "unresolved",
  "library_slug": null, "title_id": null, "issue_id": null, "working_issue_id": null,
  "provisional_key": "leaflet-specimen-0003",
  "designation": "The Placeholder Leaflet, No. 3, Spring",
  "identity_history": [
    { "kind": "provisional_key", "key": "leaflet-specimen-draft", "status": "retired", "note": "An earlier staging key." }
  ]
}
```

### Identity history: typed entries

Each entry has a `kind`. A provisional key is never put in the field that holds IssueIDs.

| `kind` | Holds | Field | `status` | Rules |
|---|---|---|---|---|
| `issue_id` (the default when `kind` is absent, as in every earlier package) | a former IssueID | `id` | `superseded` | IssueID-shaped, same title, not the active IssueID, no `key` field |
| `provisional_key` | a retired provisional key | `key` | `retired` | key characters, not catalog-shaped, not the current `provisional_key`, no `id` field |

Each may have a `note`. An entry of another kind is refused. So is the same id or key twice.

### Inventory hash

1. Take one line per file, `<sha256>␣␣<path>\n`.
2. Sort the lines by path (by UTF-16 code unit, as JavaScript sorts).
3. Hash them with SHA-256, in UTF-8.

It identifies the package's content however it is zipped. A later importer (Phase 4/5) uses it to recognise a package it has already installed.

---

## 5. `text.json`: pages, segments, unassigned spans

```json
{
  "format_version": "1.0",
  "offset_unit": "codepoint",
  "apparatus": "# Transcription — …\n\n## Transcription apparatus (not source text)\n\n…",
  "pages": [
    { "page": 2, "folio": "2", "folio_status": "printed", "review_status": "REVIEWED_ONCE", "segmented": true,
      "length": 783, "sha256": "5e3a6c8e…", "text": "<!-- PDF_PAGE: 2 -->\n## PDF page 2 — printed page 2\n\n…" }
  ],
  "segments": [
    { "id": "p002-s0008-01", "item": "gazette-v4n1-item-0008", "page": 2, "start": 573, "end": 783, "order": 1, "basis": "report opening; …" },
    { "id": "p006-s0008-02", "item": "gazette-v4n1-item-0008", "page": 6, "start": 300, "end": 494, "order": 2, "basis": "report continuation …" }
  ],
  "unassigned": [
    { "id": "p001-u01", "page": 1, "start": 0, "end": 61, "reason": "page_anchor_and_layout_apparatus" }
  ],
  "notes": [ { "id": "B02", "page": 6, "item": "gazette-v4n1-item-0008", "status": "…", "note": "…" } ]
}
```

### 5.1 Pages

- `pages` lists every **logical page** of the issue **in publication reading order**, numbered `1, 2, 3 …` with no gaps. This is the order a reader turns the pages, not the printed number, and not necessarily the order of the source file.
  - A folded booklet scanned as spreads has two logical pages on each PDF page, out of order. A scan may also split one page over two PDF pages.
  - Where each page is in the source is given by its `locations` (§5.3). Without locations, logical page N is the whole of PDF page N.
- `text` is the page's transcription, **exactly as made**: it is never normalized (no Unicode normalization, no whitespace changes).
  - Lines end with `\n`; a carriage return is refused.
  - Strings must be valid Unicode: an unpaired surrogate is refused.
- `length` is the text's length in code points, and `sha256` the SHA-256 of its UTF-8 bytes. Both are checked; they catch a reader or writer that counts in the wrong unit.
- **Folios.** `folio_status` is one of:

  | `folio_status` | Meaning | `folio` |
  |---|---|---|
  | `printed` | a page number is printed, and has been checked | the number, as text |
  | `absent` | checked: no page number is printed | `null` |
  | `illegible` | a page number is printed but cannot be read | `null` |
  | `unverified` | nobody has checked yet whether a number is printed | `null` |

  `inferred_folio` may give the number used to cite a page without a printed one: the first page, an illegible number, a page reconstructed from a booklet's imposition. It is always marked as inferred and never mistaken for a printed one.
- `review_status` is the producer's own note on how the page was checked. It is kept as given.
- `segmented` (optional, default `true`): `false` marks a page whose text has not yet been divided. Such a page **must** have no segments or spans.
- **`apparatus`** is the editorial preface that comes before the first page in the full transcription. It may be `null`. The whole transcription is always `apparatus + page 1 text + page 2 text + …`, with nothing in between (`issuepkg.transcription()`).

### 5.2 Segments and unassigned spans

- **Segments.** A segment is a stretch of one page that belongs to one contents item. An item's text may come in several segments:
  - on one page, around its children or around an illustration;
  - or on pages that are not next to each other, as when an article continues from page 2 to page 6.

  `order` gives the reading order within the item: `1, 2, 3 …`, without gaps or repeats.
- **Unassigned spans.** An unassigned span is a stretch that belongs to no item: a page anchor, a running head, a masthead, a separator, a supplied description, a blank page. It needs a `reason` (free text).
- **Shared rules for both:**
  - `id`s are unique across segments and spans, 1–128 letters, digits, `.`, `_` or `-`.
  - `page` exists.
  - `0 ≤ start < end ≤ length`, so there are no empty spans.
- **Coverage.** On every segmented page, segments and unassigned spans **together cover every code point exactly once**. A character that belongs to nothing is a `gap`; one that belongs to two spans is an `overlap`. Both are refused. Because of this, a parent's segments can never repeat its children's text.
- **Item text** is the item's segments, in `order`, joined with nothing between them (`issuepkg.itemText()`; `itemParts()` gives them one by one, with their pages). A reader shows a change of page between parts as a continuation. It never injects the text of the pages in between.
- **`notes`** (optional): remarks on boundaries. Each has a `note`, and may have an `id`, a `page`, an `item` and a `status`.

### 5.3 Locations: where each page is in the source

A page's optional `locations` say where its text was read: which source file, which PDF page, which part of it. It is a list, normally of one location. A page read across two PDF pages has two, in reading order.

```json
{ "page": 1, "folio": null, "folio_status": "absent", "inferred_folio": "1",
  "locations": [ { "source": "source/specimen-leaflet.pdf", "pdf_page": 1, "region": "right", "rotation": 90,
                   "size": [1080, 720], "box": [540, 0, 1080, 720] } ], "…": "…" }
{ "page": 2, "…": "…", "locations": [ { "pdf_page": 2, "region": "left", "rotation": 90 } ] }
```

| Field | Rule |
|---|---|
| `source` | The path of a file in `issue.json › sources`. It may be left out when the package has exactly one source. |
| `pdf_page` | The page's index in that file, from 1, as a PDF viewer counts. It is no more than the source's `pages` when that is given. |
| `rotation` | `0`, `90`, `180` or `270`: how many degrees clockwise the PDF page as stored must be turned to read this logical page upright. It is usually the PDF page's `/Rotate` value, but may differ (a scan placed sideways, or one half of a head-to-head sheet). |
| `region` | `full`, `left`, `right`, `top` or `bottom`: the part of the **upright** page this logical page occupies (the left half, the top half …) |
| `size` | Optional `[width, height]` of the upright page, in points |
| `box` | Optional `[x0, y0, x1, y1]`: the exact part, in upright coordinates. Needs `size`. `0 ≤ x0 < x1 ≤ width` and `0 ≤ y0 < y1 ≤ height`, and the box lies within its `region`. |

**Without locations:**
- Locations are given for **every page or for none**.
- With none, logical page N is the whole of PDF page N of the only source, unrotated. That is what every package without locations means. Its PDF page count should then equal its page count, or a `source` warning says it does not.

#### The coordinate system (normative)

1. **The visible box.** Start from the PDF page's visible box as stored: its CropBox, or its MediaBox when it has none. Call it `[bx, by, bx + w, by + h]` in PDF user space (points, origin at the bottom left, y up).
2. **The upright page** is that box turned `rotation` degrees clockwise. Its size is `[w, h]` at 0° and 180°, and `[h, w]` at 90° and 270°.
3. **Upright coordinates** are points with the origin at the **top left** of the upright page, x to the right, **y downward**: the way the page is read and an image of it is drawn. `region`, `size` and `box` are all measured this way.
4. **Converting** an upright point (X, Y) to PDF user space (x, y) (`issuepkg.uprightToPDF`; `pdfToUpright` is its inverse):

   | `rotation` | x | y |
   |---|---|---|
   | 0 | bx + X | by + h − Y |
   | 90 | bx + Y | by + X |
   | 180 | bx + w − X | by + Y |
   | 270 | bx + w − Y | by + h − X |

   For example, at 90° the right half of an upright spread (X from w′/2 to w′) is the upper half of the page as stored. A renderer that honours `/Rotate` (tested with Poppler on the booklet fixture) draws it on the right.
5. **Regions,** as fractions of the upright page `[x0, y0, x1, y1]`:

   | `region` | Fractions |
   |---|---|
   | `full` | `[0, 0, 1, 1]` |
   | `left` | `[0, 0, ½, 1]` |
   | `right` | `[½, 0, 1, 1]` |
   | `top` | `[0, 0, 1, ½]` |
   | `bottom` | `[0, ½, 1, 1]` |

#### Rules (checked)

**One page or many.** A PDF page may hold several logical pages, and a logical page may be spread over several PDF pages. Neither is assumed to be one to one.

**Each location:**
- `source` must be listed. When there are several sources, `source` must be named.
- `pdf_page` must be in range.
- `region` and `rotation` must be in their vocabularies.
- A `box` needs `size`, must lie on the page, and must lie within its `region`.

**No part of a PDF page belongs to two locations.**
- Every location is mapped back onto the PDF page **as stored** (normalized to its visible box), and no two may overlap.
- Comparing in stored terms makes the check true whatever the rotations. Two pages that are both "top" when read upright, one turned 180°, sit on different halves of a head-to-head sheet and are accepted. "Top" at 0° and "right" at 90° are the same half of the stored page and are refused.
- The same applies to one page listing the same place twice.

**Sizes agree.** Two locations on the same PDF page that give `size` must agree once their rotations are undone.

**Unused PDF pages.** A PDF page of a source with a known page count that no logical page uses (a blank leaf, a page left out) is reported as a `location` warning.

**What is not checked.** The validator does not open the PDF. It does not check `rotation` against the PDF's `/Rotate`, or `size` against its boxes. Those are the producer's quality checks.

---

## 6. Transcription markup

Page text may use a **small, closed set** of markup. Everything else is literal text: a reader shows it exactly as typed and **never** interprets it as HTML. There is no raw HTML in a transcription, and readers render through a tree, never through `innerHTML`.

### The set

| Markup | Meaning |
|---|---|
| A line `<!-- PDF_PAGE: N -->` | a source anchor: the text that follows comes from PDF page N. N **must** be one of this page's PDF pages (§5.3; without locations, the page's own number), each at most once. |
| A line `<!-- LOGICAL_PAGE_N_START -->` … a line `<!-- LOGICAL_PAGE_N_END -->` | logical page anchors enclosing the page's text. N **must** be the page's own number. There is one START and one END, START first. Both are optional, but never one without the other. |
| `# …` to `###### …` at the start of a line | headings |
| `- …`, `* …`, `+ …` at the start of a line | list items |
| A line ` ``` ` (optionally ` ```text `) … a line ` ``` ` | a fenced block, shown as typed (tables of figures, layouts) |
| A line of `---`, `***` or `___` | a horizontal rule |
| `*text*`, `**text**` | emphasis, strong emphasis |
| `\*`, `\[`, `\]`, `\#`, `\-`, `\+`, `` \` ``, `\_`, `\\` | a literal character |
| `[supplied: …]` | **editorial**: words not printed in the source (a description of an image, a layout note, a supplied word) |
| `[unclear: …]` | **editorial**: a reading the transcriber is unsure of |
| `[illegible]` | **editorial**: printed text that cannot be read |

### Rules

- **Square brackets are source text unless they open an editorial mark.** `[Communicated.]` in a newspaper is printed text, and stays text.
- **Editorial-looking brackets are never passed silently.** A bracket that reads like editorial matter but is not one of the three marks would be shown as printed text, so it is always reported as a `markup` warning. Such a bracket is either:
  - a label of up to 80 characters followed by a colon and a space or the end of the line (`[Note: …`, `[Editorial description: …`), or
  - one that opens with a whole word transcribers use for their own notes, in any case: *editorial, editor, editors, editor's, ed., note, notes, footnote, endnote, sic, illustration, illustrations, image, photo, photograph, picture, figure, fig., caption, description, decorative, decoration, ornament, vignette, transcriber, transcriber's, transcription, printed, separate, supplied, unclear, illegible, blank, missing, torn, damaged*.

  What to do about one:
  - **Editorial matter** belongs in `[supplied: …]`, `[unclear: …]` or `[illegible]`.
  - **A printed bracket that happens to match** is escaped, `\[Note: …\]`, which also silences the warning.

  `[See also …]`, `[by …]` and `[10:30]` are not reported.

  These warnings never make a package invalid. **Before any full-text public export is approved, a person must have reviewed every one** (§17).
- **Editorial marks don't nest,** and each closes on its own line.
- **Headings such as `## PDF page 2 — printed page 2`** are the transcriber's apparatus. They belong in an unassigned span, never in an item's segment.
- **The validator lists anything that looks like markup outside the set,** as `markup` warnings: an HTML comment that is not an anchor, an HTML-like tag, an editorial-looking bracket (above), an unclosed mark, a Markdown link or image, an unclosed fence. These are shown literally; the warning is so a person can see that.

This grammar is fixed for 1.0. Producers (the ingestion process) should write to it; anything else will show as plain text.

---

## 7. `items.json`: candidate Contents rows

```json
{
  "format_version": "1.0",
  "schema": "3.0",
  "headers": ["Slaughter Cataloger Tool", "Schema Version", "Title Library Slug", "TitleID", "Entry Order", "ContentID", "IssueID", "…"],
  "items": [
    { "key": "gazette-v4n1-item-0004", "sequence": 4, "parent": "gazette-v4n1-item-0003", "title_origin": "printed",
      "row": { "Slaughter Cataloger Tool": "Contents", "Schema Version": "3.0", "TitleID": "EXAGAZEX-1872", "ContentID": "",
               "IssueID": "EXAGAZEX-1872-KRNYWA2", "Sequence": "4", "Item Title": "Eastfield", "Parent Item": "Around the County",
               "Parent ContentID": "", "…": "…" } }
  ]
}
```

These are the rows an importer will write into the title's Contents CSV. The package does not hold a second catalog: after import, the CSV is the record and the package keeps only `content_map`.

### Rules (all checked)

- **Headers.**
  - `schema` is `"3.0"`.
  - `headers` is exactly the 3.0 Contents headers, in order (`SC.schema.entities.content.headers`).
  - Every row has every header. A column the schema does not define is kept and reported (it would become an extra CSV column, which the 3.0 reader keeps).
- **Values.** Every value is text; an empty cell is `""`.
  - `Slaughter Cataloger Tool` is `Contents` and `Schema Version` is `3.0`.
  - `TitleID` and `IssueID` are the package's: the active IssueID, never a superseded one.
  - **While the identity is not resolved (§4),** what is unresolved is left empty, never guessed. A `title-resolved` package's rows have the TitleID and an empty `IssueID`. An `unresolved` package's rows have both empty. `ContentID` and `Parent ContentID` are empty in either case.
  - `Title Library Slug` matches `identity.library_slug` when that is given.
- **Keys.** `key` is the package-local item key: unique, 1–128 letters, digits, `.`, `_` or `-`. It is never the title text or a page number. Keys stay as the producer gave them.
- **Sequence.** `sequence` is a whole number from 1, unique within the issue, and equals the row's `Sequence`.
- **Parents.** `parent`, if set, is another item of the package.
  - It comes **earlier** in sequence: it is never the item itself and never forms a loop.
  - The row's `Parent Item` **must** equal the parent's `Item Title`, because the 3.0 reader links a parent by that text when no `Parent ContentID` is set.
  - An item without a parent has an empty `Parent Item` and `Parent ContentID`.
  - Children need not be next to each other: item 3's children may be 4, 6 and 7, with item 5 between them.
- **ContentIDs.** `ContentID` and `Parent ContentID` are empty, or agree with `content_map`.
- **Optional fields.** `title_origin` is `printed` or `supplied` (a title the cataloger supplied, in brackets in `Item Title`). `notes` is an optional list of editorial notes.

---

## 8. `mentions.json`: the deep index

```json
{
  "format_version": "1.0",
  "entities": [
    { "id": "e007", "type": "person", "form": "JANE DOE", "normalized": null, "item": "gazette-v4n1-item-0004",
      "pages": [1], "context": "signature", "status": "Verified", "note": "…", "precision": "item" }
  ],
  "subjects": [
    { "id": "s005", "term": "Local news", "item": null, "pages": [1, 2], "status": "Verified", "precision": "page" }
  ]
}
```

A private index of what the text **mentions**: people, places, bodies and so on. It is kept apart from credited names. It never feeds the Authorities file or the Names view; turning a mention into a heading is a deliberate later step (Phase 6).

### Fields

- **Common to both.** `id`s are unique. `item`, if set, is an item of the package; `null` means the mention is about the issue as a whole.
- **Entities.** `form` (the words as printed) is required. `type` is the producer's own vocabulary, as text; 1.0 does not fix a list.
- **Subjects.** `term` is required.
- **Precision.** `precision` says how exactly the mention is located:

  | `precision` | Located by |
  |---|---|
  | `issue` | nothing more |
  | `page` | `pages` (required) |
  | `item` | `item` (required) |
  | `paragraph`, `exact`, `exact-derived` | `anchors` (required) |

- **Anchors.** Each anchor is `{ "page", "start", "end", "precision" }`, in code points, within its page.
  - An `exact-derived` anchor (one found by searching the text) **must** point at exactly the `form`.
  - An `exact` anchor that does not point at the form is reported as a warning (a word broken across lines, say), and so is an anchor outside its item's segments.
  - No anchor is ever invented: a mention without offsets stays at `item`, `page` or `issue` precision.

---

## 9. `rights.json`: rights status and publication decisions

```json
{
  "format_version": "1.0",
  "rights_status": { "value": "undetermined", "statement": "…" },
  "decisions": [
    { "id": "d001", "resource": { "kind": "page_text" }, "purpose": "public_web", "value": "deny",
      "by": "staging package", "at": "2026-10-01", "basis": "…" }
  ],
  "withheld": [
    { "id": "w001", "page": 5, "start": 322, "end": 340, "reason": "contact details of a private person", "by": "…", "at": "2026-10-14" }
  ]
}
```

**`rights.json` is required.** Publication decisions must be explicit, even when there are none.

### The rights status

`rights_status.value` is the legal analysis: `undetermined`, `in-copyright`, `public-domain`, `licensed` or `own-work`, with an optional `statement`. It is kept **separate** from the publication decisions, which are project policy. No rights status grants anything by itself.

### Decisions

Each decision has an `id`, a `resource`, a `purpose`, a `value`, and optionally `by`, `at`, `basis` and `review_by`.

- **`resource.kind`** is one of `metadata`, `cover`, `page_text`, `item_text`, `mentions`, `source`.
  - `metadata`, `item_text` and `mentions` may name an `item`.
  - `page_text` may name a `page`.
- **`purpose`** is one of `local_view`, `private_epub`, `public_web`, `public_search`, `public_download`, `public_epub`.
- **`value`** is `undecided`, `deny` or `allow`.
  - An **`allow` must say who decided (`by`), when (`at`, a date) and on what basis (`basis`).**
  - Two decisions for the same resource and purpose are refused.
- **Withheld spans.** A `withheld` span hides a stretch of page text (contact details of a living person, say) even inside an item cleared for publication. It needs a `reason`, `by` and `at`.

### How decisions are read

The public export applies these rules (Phase 7). The validator checks the structure now.

- **No decision means `undecided`, and `undecided` means deny.**
- **The one exception is `local_view`.** Viewing one's own archive is allowed unless denied.
- **No grant is inherited downward.** An `allow` for the issue's metadata does not open its items, its text or its cover.
- **A restriction always applies downward.** An item `deny` or a withheld span wins over any broader `allow`.

---

## 10. Cover, source files, review queue

### Cover

- **Shape.** `issue.cover` is `{ path, media_type, width, height, source_page?, location?, derivation?, origin? }`.
- **Format and size.**
  - The file is a JPEG or PNG, listed with role `cover`.
  - Its real dimensions **must** equal `width` and `height`.
  - It is kept **byte for byte as received**: viewers make display thumbnails in memory and never store them.
- **Edits are documented.** `derivation` may describe cropping or tonal changes made by the producer.
- **Where it was cut from.** `location` (optional) is one location (§5.3): the PDF page and the part of it the cover image shows. It is checked like a page's location, and is reported with code `cover`. When the cover's `source_page` has locations and none is on that PDF page, a `cover` warning is given. A cover location may overlap the pages' locations; it usually does.
- **One cover.** A file with role `cover` that is not `issue.cover` is refused.

### Source files

- **Shape.** `issue.sources` lists `{ path, media_type, original_name?, pages?, origin? }`. Each file is under `source/` with role `source`.
- **PDFs.** A PDF must begin `%PDF-`. In a package without locations, a `source` warning is given when `pages` differs from the number of transcribed pages. With locations, logical pages and PDF pages need not match in number; a PDF page that holds no logical page gets a `location` warning instead (§5.3).
- **One list.** A file with role `source` must be listed in `sources`.

### Review queue

`issue.review` lists questions the producer left open. Each entry has:
- `id`, `status` and `blocks`;
- optionally a `label` and a `summary`.

`status` is one of `open`, `blocking`, `deferred` or `resolved`. `blocks` lists the steps the question holds up (`local_import`, `public_release` …). The importer (Phase 4) will show every unresolved entry that blocks `local_import` as a blocker.

---

## 11. Provenance, `origin` and unknown fields

### `issue.provenance`

`issue.provenance` records where the package came from:

```json
"provenance": {
  "converted_from": { "format": "draft-0.1/provisional-consolidation", "package_id": "…", "archive": { "name": "….zip", "bytes": 123, "sha256": "…" } },
  "converter": "tools/convert-staging.js 1.0",
  "report": "provenance/CONVERSION.json",
  "files": [
    { "path": "fulltext.json", "bytes": 58369, "sha256": "ddf1c854…", "kept_as": "provenance/staging/fulltext.json", "re_expressed_in": "text.json" },
    { "path": "MANIFEST.json", "bytes": 6976, "sha256": "67fcade7…", "kept_as": "provenance/staging/MANIFEST.json", "mapped_into": "issue.json" },
    { "path": "cover.jpg", "bytes": 2244, "sha256": "546fffac…", "kept_as": "cover.jpg" }
  ]
}
```

Each original file appears once, with its own size and SHA-256 and the package file that holds it (`kept_as`). The validator checks that the file kept there is that file, **byte for byte**. A file that is also a native file (the cover, the source PDF) is stored once, not twice. `re_expressed_in` and `mapped_into` say which native file carries its content.

### `origin`

Any record may carry an `origin`: data carried over unchanged from the package it was converted from, for which 1.0 has no field of its own.
- It is an object keyed by the original file's name. Each value is an object of that file's fields for this record.
- Readers keep it, and otherwise leave it alone.
- Nothing in 1.0 depends on it.

So a staging field that 1.0 does not define is never dropped. For example, a page's original folio status, a segment's line numbers, an item's uncertainty notes.

### Unknown fields

Fields this version does not define are kept by every reader and writer, and reported as warnings (§2). Reading a file and writing it again with `issuepkg.serialize` gives back the same bytes.

---

## 12. Converting a staging package (`draft-0.1`)

`tools/convert-staging.js <staging .zip or folder> --out <new folder>` converts the layout the ingestion process hands over today into a native package. It also writes `provenance/CONVERSION.json`, which lists every check and how each file was treated.

That layout is called "provisional", `package_spec_version` `draft-0.1…`. It has:
- `MANIFEST.json`;
- `fulltext.json` and `transcription.md`;
- candidate Contents rows and a crosswalk;
- a deep index;
- `RIGHTS_AND_ACCESS.json` and `REVIEW_QUEUE.json`;
- the cover, the source PDF, and QA evidence.

### Guarantees

1. **The staging package is only read.** It is never changed, moved or written into. The output folder must not exist and may not be inside the staging folder. The result is assembled in a temporary sibling folder and renamed into place only when complete.
2. **Every staging file is kept byte for byte**, under `provenance/staging/<its path>`, or as the native cover or source file when it is that file.
3. **Identifiers are kept** as the producer gave them:
   - the IssueID (working or settled), the superseded IDs, the TitleID;
   - every local item key, segment id and span id;
   - the package id.

   ContentIDs that the staging package leaves unresolved stay unresolved (`null` in `content_map`). The converter never mints IDs; that is the importer's job, in its plan (Phase 4).
4. **The three files the native format re-expresses rebuild exactly.** These are the full text, the candidate rows and the deep index, and each is rebuilt from the native package alone (`staging.reconstruct()`) with every field and value equal. The converter checks this before writing anything; the tests check it again on the twin, and on a real package in the private run.
5. **Nothing is dropped except derived copies of text,** and each is checked equal before it is dropped:
   - a segment's or unassigned span's stored text, which **must** equal the page text between its offsets;
   - an item's stored text, which **must** equal its segments joined;
   - `transcription.md`, which **must** equal the apparatus followed by every page, byte for byte.

   Every other staging field is either mapped to a 1.0 field or kept in `origin`. A field mapped through a vocabulary (a folio status, a title origin, a review status) is also kept verbatim in `origin`.
6. **The result is validated** (§14) before it is written.

### Mapping

| Staging | Native |
|---|---|
| `MANIFEST.json`: `title_id`, `issue_id`, `working_issue_id`, `identity_history`, `issue_designation`, `package_id` | `issue.json › identity`, `package_id`; history status mapped to `superseded` |
| `MANIFEST.json`: `cover`, `source_files`, `pages[]` | `issue.json › cover`, `sources`; page `segmented`, other page fields in the page's `origin` |
| `MANIFEST.json`: everything else | `issue.json › origin` |
| `fulltext.json`: `pages[]` (`source_page`, `printed_page`, `printed_page_status`, `text`, `page_char_length`, `page_text_sha256`, `review_status`) | `text.json › pages[]` (`page`, `folio`, `folio_status` + `inferred_folio`, `text`, `length`, `sha256`, `review_status`) |
| `fulltext.json`: `items[].segments[]` (`segment_id`, `local_item_key`, `source_page`, `page_char_start`, `page_char_end`, `boundary_basis`) | `text.json › segments[]` (`id`, `item`, `page`, `start`, `end`, `basis`); `order` from the segment's position in its item |
| `fulltext.json`: `unassigned_page_spans[].spans[]` | `text.json › unassigned[]` |
| `fulltext.json`: `transcription_apparatus`, `boundary_notes` | `text.json › apparatus`, `notes` |
| `fulltext.json`: `items[]` (`editorial_notes`, other fields) | the item's `notes`; the rest in the item's `origin` |
| candidate rows: `local_item_key`, `parent_local_item_key`, `source_sequence`, `item_title_origin`, `cataloger_3_0_fields` | `items.json › items[]` (`key`, `parent`, `sequence`, `title_origin`, `row`). A `null` cell becomes `""` in `row`, and the `null` is kept in `origin`. |
| deep index: `entities[]`, `subjects[]`, `research_log` | `mentions.json`. Ids `e001…`, `s001…` in order; `content_item_sequence` becomes the item's key; `precision` is `item`, `page` or `issue`. |
| `RIGHTS_AND_ACCESS.json` | `rights.json`. `UNKNOWN`/`UNDETERMINED` becomes `undetermined`. A `PRIVATE` resource becomes an explicit `deny` for each public purpose. `REVIEW_REQUIRED` and `PRIVATE_STAGING` stay undecided (also a deny). |
| `REVIEW_QUEUE.json › issues[]` | `issue.json › review[]` |
| `transcription.md`, the item-to-page mapping, the crosswalk CSV, `CHECKSUMS.sha256`, `MANIFEST.json › active_assets` | cross-checked, and kept in `provenance/staging/` |
| everything else (QA, evidence, reports, files the manifest does not name) | kept in `provenance/staging/` |

### Refusals

The converter refuses, listing every problem and writing nothing, when:
- the manifest declares a staging format other than `draft-0.1`, or none (below);
- a checksum or stated hash or size does not match;
- a page length is not its code-point count;
- an offset is out of range;
- a stored segment or span text is not its page slice;
- the full text and the candidate rows disagree (keys, order, sequences, parents);
- the crosswalk or the item-to-page mapping disagrees;
- `transcription.md` is not derivable from the pages;
- a staging file names another title, or a superseded IssueID;
- a vocabulary value is unknown (a folio status, a title origin, an access status, a review status);
- **the staging package claims any approval.** Approvals are never carried over: an `allow` is recorded natively, by a person, after conversion;
- the package is already native.

### What a `draft-0.1` conversion does not produce

A `draft-0.1` package has one PDF page per logical page and a settled TitleID, so its conversion writes no `locations` and no `identity.status`: the identity is `resolved` by default, and each page is the whole of the PDF page with its number (§5.3). The converter's output is the same, byte for byte, as before the amendments of §17.

### Other staging layouts

This converter reads only the `draft-0.1` layout. The ingestion process has others, which declare themselves with `manifest_schema` in `MANIFEST.json` instead of `package_spec_version`. They may carry two-up spreads, an unresolved identity or pages not yet divided, all of which 1.0 can now hold (§4, §5.3).

**No converter for any other layout exists.** Writing one is a separate decision, not part of 1.0. Until then:
- `tools/convert-staging.js` refuses such a package **by name**, saying which field declares which format, and writes nothing.
- `tools/validate-issue.js` says it is a staging package of that format, for which no converter exists yet.

---

## 13. Archives, folders and paths

`js/core/zipread.js` reads ZIP archives. Decompression is supplied by the caller (Node's `zlib`; a browser's `DecompressionStream` later), so the module stays pure. It refuses anything it cannot be sure of.

### Path rules (archives and folders alike)

A path is relative, uses `/` between folders, and is valid UTF-8 with no control characters. It contains none of:
- `\`;
- a leading `/` or a drive letter;
- empty, `.` or `..` segments;
- `< > : " | ? *`;
- a name ending in a dot or space;
- a reserved device name (`con`, `nul`, `com1` …).

It is at most 240 characters and 16 folders deep. Two names that differ only in letter case or Unicode form (NFC/NFD) collide, and so does a name used as both a file and a folder. Folders are read without following links: a symbolic link or special file is refused.

### Archive rules

| Refused | Code |
|---|---|
| not a ZIP; data after the end record; a damaged directory | `zip` |
| split (multi-disk) archives; ZIP64 (records or extra fields) | `zip`, `zip64` |
| encrypted entries; compression other than stored or deflate | `encrypted`, `method` |
| an unsafe path; a name that is not UTF-8; a second (Unicode) name that disagrees | `path` |
| symbolic links; special files | `symlink`, `special` |
| the same name twice; names that collide | `duplicate`, `collision` |
| a local header that disagrees with the directory | `mismatch` |
| data before the first entry; entries running into the directory; bytes the directory doesn't account for | `layout` |
| two entries sharing bytes (overlapping-file bombs) | `overlap` |
| a CRC or size that doesn't match; inflation past the stated size | `crc`, `size` |
| more than 2,000 entries; a file over 512 MB; more than 2 GB in all | `limit` |
| a file of 1 MB or more expanding over 200 times | `ratio` |

Limits can be lowered by the caller. A lying size cannot be used to fill memory: inflation stops at the stated size plus one byte.

---

## 14. Validation: rejection codes

`SC.issuepkg.validate(files, { sha256 })` returns `{ ok, errors, warnings, pkg, summary }`. Each error and warning has a `code`, a `file`, a `where` (a path inside the file) and a plain-English `message`. A package is valid when there are no errors. Warnings never make a package invalid; they are things a person may want to look at.

| Code | Refused because |
|---|---|
| `layout` | there is no `issue.json` at the top, or inside one top-level folder |
| `format`, `version` | another format; an unknown major version, here or in a part |
| `encoding` | not UTF-8; a byte-order mark; an unpaired surrogate |
| `json` | invalid JSON; a key given twice in one object; nested over 100 levels |
| `path`, `duplicate`, `collision` | unsafe or colliding names (§13) |
| `inventory`, `unlisted-file`, `missing-file`, `size`, `hash`, `role` | the file list is incomplete, a file differs from it, a file has the wrong role or place, the inventory hash is wrong, `rights.json` or a needed `items.json` is missing |
| `id`, `wrong-title`, `wrong-issue`, `history`, `state` | identity rules (§4): IssueIDs, identity status, provisional keys, catalog-shaped placeholders, typed history, rows while unresolved |
| `content-map`, `duplicate-id` | the content map disagrees with the items; an id used twice |
| `items`, `schema`, `headers`, `row`, `sequence`, `parent`, `cycle`, `parent-order`, `parent-text` | candidate row rules (§7) |
| `offset-unit`, `page`, `text`, `length`, `offset`, `gap`, `overlap`, `coverage`, `order`, `segment`, `span`, `unknown-item`, `anchor`, `note` | text rules (§5, §6), including page and logical-page anchors |
| `location` | page locations (§5.3): an unknown source or PDF page, a region or rotation outside its vocabulary, a box off its page or outside its region, locations on some pages only, two locations claiming the same part of a PDF page, sizes that disagree |
| `mention`, `vocabulary` | mention rules (§8); a value outside a fixed vocabulary |
| `rights` | rights rules (§9) |
| `cover`, `source`, `review` | §10, including the cover's `location` |
| `provenance`, `origin` | §11 |

| Warning | Meaning |
|---|---|
| `unknown-field` | a field this version does not define (kept) |
| `os-file` | operating-system leftovers skipped (§3) |
| `markup` | something that looks like markup outside the set, including an editorial-looking bracket that is not one of the three marks (§6); shown literally |
| `row-extra` | a Contents column the 3.0 schema does not define (kept as an extra column) |
| `id` | an older IssueID pattern (accepted) |
| `anchor` | an `exact` anchor not at its form, or outside its item's text |
| `source` | in a package without locations, a source file's page count differs from the transcription's |
| `location` | a PDF page that holds no logical page (§5.3) |
| `cover` | the cover's location is not on a PDF page of its source page (§10) |

---

## 15. Tools and tests

```sh
node tools/validate-issue.js <package folder or .zip> [--json]       # exit 0 valid, 1 refused, 2 usage
node tools/convert-staging.js <staging .zip or folder> --out <new>   # exit 0 converted, 1 refused, 2 usage
node tools/make-issue-fixture.js [--out <new folder>]                # the invented examples: the twin (staging, native) and the booklet
python3 -I tools/check-offsets.py <native package folder>            # an independent reading of every offset
node tools/test-issuepkg.js                                          # the test suite (run by run-tests.sh)
node tools/test-issuepkg.js --private <real staging package>         # private acceptance; prints counts only
```

### The invented twin

The twin (`sample-data/issue-package/`) is one invented eight-page issue. It has the traps real packages have:
- **Pages.** An unnumbered first page with an inferred folio, and a blank last page.
- **Item structure.**
  - An article continued from page 2 to page 6.
  - A department whose children are not next to each other, with its own text in three pieces.
  - An item in four segments, and one split around an engraving.
- **Titles and markup.** Supplied titles and descriptions, `[illegible]`, `[unclear: …]`, printed square brackets, a fenced block, list items and escapes.
- **Characters.** A blackletter masthead outside the Basic Multilingual Plane, and a combining accent.
- **Package contents.**
  - Mentions without offsets.
  - Rights all private or under review.
  - A superseded IssueID.
  - An open review queue.
  - A field and a file no converter knows about.
- **Canary strings** (`canary-…`) in item text, page text, a contact line, a mention, the cover and the source PDF, for the leak tests of later phases.

### The invented booklet

The booklet (`sample-data/issue-package/booklet/`) is a native package written directly, with no staging form. It is an invented eight-page leaflet, printed as a folded booklet and scanned as four two-up spreads:

| PDF page | Left half | Right half |
|---|---|---|
| 1 | logical page 8 | logical page 1 |
| 2 | 2 | 7 |
| 3 | 6 | 3 |
| 4 | 4 | 5 |

- **Rotation.** Each PDF page is stored portrait with `/Rotate 90`, so "left" and "right" only mean something once it is turned upright. Rendered with Poppler, each spread reads as the table says.
- **Locations.** Some pages are located by region alone, others by region and an exact box. The cover is cut from the right half of PDF page 1.
- **Folios.** Every folio status appears: `printed`, `absent` (with an inferred number), `illegible` and `unverified`.
- **Anchors.** `LOGICAL_PAGE_N_START`/`END` on every page. A `PDF_PAGE` anchor on page 7 names PDF page 2, the one it sits on.
- **Items.** Pages 1–4 are divided into segments; pages 5–8 are not yet (`segmented: false`). One article runs across two PDF pages (logical 2 → 3), one across the centre spread (4 → 5).
- **Markup.** An escaped printed bracket, `\[Note: …\]`.
- **Identity.** `unresolved`: no TitleID or IssueID anywhere, a provisional key, and a retired provisional key in the history.

It validates with no errors and no warnings.

### What the tests prove

`tools/test-issuepkg.js` (344 checks) shows:
- **The twin itself.** It validates. It converts to exactly the committed native package, from a folder or a ZIP. Its staging form is never changed.
- **The booklet.** It validates cleanly, and is exactly what the generator writes.
- **Lossless conversion.**
  - Its three re-expressed files rebuild exactly.
  - Every segment and span reads back exactly.
  - JavaScript and Python agree on every offset.
- **Refusals.** Every defect in §13 and §14 is refused with its own code, and every refusal in §12 stops conversion.
- **Locations.** The upright-to-PDF mapping and its inverse at every rotation. Many logical pages on one PDF page, one logical page on two. Overlaps found in stored terms whatever the rotations, and pages head to head accepted.
- **Identity.** Each identity status, accepted and refused; catalog-shaped placeholders refused in any case; typed history entries kept apart.
- **Markup.** Which brackets are reported as editorial-looking and which are not; logical-page anchors.
- **The amendment cases** T1–T17 (§17), each by name.

The real packages are never in the repository. `SC_PRIVATE_FIXTURE=<path> sh run-tests.sh` runs the private acceptance on one, in a temporary folder outside the repository.

---

## 16. Not in 1.0

These belong to later phases, or to separate decisions, and are deliberately absent here:
- **Import** into a library: the plan, ContentID minting, copy-on-write install (Phases 4–5).
- **Reading packages in the app** (Phase 3).
- **Full-text search** (Phase 6).
- **Resolving the publication policy and the public export** (Phase 7).
- **EPUB** (Phases 9–10).
- **A converter for any staging layout other than `draft-0.1`** (§12). Writing one is a separate decision.
- **Opening the PDF.** Rendering page images, and checking a location's `rotation` or `size` against the PDF itself (§5.3).
- **Locations finer than a page.** A location says where a logical page is. It does not say where a line or an offset is on the scan.

Nothing in the app, its CSV schema or its single-file build changes with this format. `js/core/issuepkg.js` and `js/core/zipread.js` are used by the tools now, and are not yet loaded by the app.

---

## 17. Changes before 1.0 was frozen

1.0 was drafted on 2026-10-14. Later that day, before it was frozen, it was amended so that it can hold two kinds of material real packages bring: booklets scanned out of reading order, and issues not yet matched against the catalog. It is still version 1.0, because 1.0 had not yet been frozen or published.

| Change | § |
|---|---|
| Pages are **logical pages in publication reading order**. Optional `locations` give each page's source, PDF page, region, rotation and exact box. Neither direction is assumed to be one to one. | §5.1, §5.3 |
| A defined coordinate system for regions and boxes, and the meaning of rotation | §5.3 |
| `folio_status` `unverified`, apart from `absent` and `illegible` | §5.1 |
| `identity.status` (`resolved`, `title-resolved`, `unresolved`) and `provisional_key`. Null IDs while unresolved, and empty IDs in the rows. Values shaped like catalog IDs refused as placeholders. | §4, §7 |
| Typed identity history: a provisional key is never stored as an IssueID | §4 |
| `LOGICAL_PAGE_N_START`/`END` anchors checked; `PDF_PAGE` anchors follow the locations | §6 |
| Editorial-looking brackets outside the three marks are always reported | §6 |
| `cover.location` | §10 |
| Other staging layouts refused by name; a second converter left to a separate decision | §12 |
| The invented booklet | §15 |

### Compatibility with the first draft

The amendment adds; it does not change what any existing field means. When a new field is absent, the meaning is the draft's:
- no `identity.status` means `resolved`;
- an identity-history entry without `kind` is an `issue_id` entry;
- a package without `locations` has one whole, unrotated PDF page per logical page.

**Unchanged:** the invented twin, byte for byte, still valid with no warnings. The `draft-0.1` converter's output, byte for byte, here and in the private acceptance run on a real package.

**Newly checked.** A package valid under the draft stays valid unless it has one of these, which the draft let through:
- a `package_id` shaped like a catalog ID (now refused);
- a `<!-- LOGICAL_PAGE_N_START -->` or `_END -->` comment that is not a correct pair for its own page (the draft warned; now refused);
- a field the draft did not define but 1.0 now does (`locations`, `status`, `provisional_key`, `kind`, `key`, `location`), used in another way (the draft warned; now checked).

It may also get new `markup` warnings, for editorial-looking brackets. A warning never makes a package invalid.

### The regression cases

`tools/test-issuepkg.js` names each case.

| Case | What it shows |
|---|---|
| T1 | The draft's twin still validates with no warnings |
| T2 | The booklet, eight logical pages on four PDF pages, validates with no warnings |
| T3 | Pages are numbered in reading order, which differs from PDF order |
| T4 | Impossible locations are refused: PDF page 0 or past the end, an unknown source, region or rotation, an inverted box |
| T5 | Two logical pages claiming one part of a PDF page are refused |
| T6 | A `PDF_PAGE` anchor names the page's PDF page, not its logical number |
| T7 | `LOGICAL_PAGE` anchors with the wrong number, unpaired, out of order or repeated are refused |
| T8 | A folio given with `unverified` (or `absent`) is refused |
| T9 | A PDF page that holds no logical page is a warning |
| T10 | The cover's location is checked |
| T11 | An unresolved package has no TitleID, IssueID or ContentID anywhere, and has a provisional key |
| T12 | Provisional keys shaped like a TitleID, IssueID or AuthorityID are refused, in any letter case |
| T13 | IDs in the rows of an unresolved package are refused |
| T14 | An unresolved package cannot be `installed` |
| T15 | A title-resolved package has its TitleID, and its IssueID is still empty |
| T16 | Editorial-looking brackets are reported; escaped ones and the three marks are not |
| T17 | The `draft-0.1` converter still writes the twin byte for byte |

The suite also covers the coordinate mapping at every rotation, ambiguous source locations, typed identity history, and which brackets count as editorial-looking.

### Frozen

Format 1.0, with the changes above, was frozen on 2026-10-14 after independent review. These decisions were recorded with it:

1. **Logical pages and source locations stay separate.** Pages are logical publication pages in reading order. Where each one is in the source is said by its `locations`, never by its number (§5.1, §5.3).
2. **Unresolved identities need no made-up IDs.** `unresolved` and `title-resolved` packages are supported without manufactured canonical IDs (§4).
3. **Provisional keys keep their own history.** Retired provisional keys are typed history entries, apart from superseded IssueIDs (§4).
4. **Editorial-looking brackets stay warnings.** An editorial-looking bracket outside the three marks remains a validator warning. Each one must be reviewed explicitly before any full-text public export is approved (§6).
5. **No converter for other staging layouts yet.** A converter for the other staging layout (the one that declares `manifest_schema`) is not implemented, and needs its own authorization (§12).
