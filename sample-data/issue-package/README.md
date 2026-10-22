# The invented issue packages

Two invented issues in the issue-package format (`docs/ISSUE-PACKAGE.md`), for the issue-package tools and tests. Every name, place and word in them is made up.

| Folder | What it is |
|---|---|
| `staging/` | **The twin,** as the ingestion process hands packages over today (below) |
| `native/` | **The twin,** converted to the native format (below) |
| `booklet/` | **The booklet:** a leaflet scanned as two-up spreads, out of reading order, whose catalog identity is not yet resolved (below) |

## The twin

The twin is issue EXAGAZEX-1872-KRNYWA2 of the sample library: The Example Gazette, vol. IV, no. 1, May 1, 1875. That is an eight-page issue with no contents yet in `../3.0/example-library/`.

It appears in two forms:

| Folder | What it is |
|---|---|
| `staging/` | The package as the ingestion process hands packages over today. This is the provisional `draft-0.1` layout: `MANIFEST.json`, `fulltext.json`, `transcription.md`, candidate Contents rows, a crosswalk, a deep index, rights, a review queue, the cover, the source PDF, QA files. |
| `native/` | What `tools/convert-staging.js` makes of it: format `slaughter-cataloger-issue` 1.0, with every staging file kept under `provenance/staging/`. |

### The traps it holds

The package has the structural traps that real packages have, so the tests can exercise them:

- **Pages.**
  - Page 1 has no printed folio; its catalog page number (1) is inferred.
  - Page 8 is blank: all of it is one unassigned span.
- **Continuations and divided items.**
  - Item 8 (a report) is on page 2 and continues on page 6. Pages 3–5 are not part of it.
  - Item 3 (a department) has children 4, 6 and 7. Item 5, at the top level, sits between them. Item 3's own text is in three pieces, so its text never repeats its children's.
  - Item 18 is split into four segments by separators.
  - Item 9 is split around an engraving's supplied description.
- **Titles and markup.**
  - Supplied titles: items 5, 12, 16 and 17.
  - `[supplied: …]`, `[illegible]` and `[unclear: …]`.
  - Printed square brackets (`[Communicated.]`), which are not editorial marks.
  - A fenced block, list items and backslash escapes.
- **Characters.**
  - A masthead in blackletter letters outside the Basic Multilingual Plane, so code-point offsets differ from JavaScript string indexes.
  - A combining accent (`Cafe` + U+0301), stored as typed.
- **Mentions, rights and review.**
  - Mentions without offsets.
  - Rights that are private or under review, with nothing approved.
  - A superseded working IssueID.
  - An open review queue.
- **Unknown material.** A field (`producer_extension`) and a file (`evidence/extra/UNREFERENCED.txt`) that no converter knows about. Both must survive conversion.
- **Canary strings,** for later leak tests: `canary-item-text-01`, `canary-page-text-02`, `canary-contact-03`, `canary-mention-04`, `canary-cover-05` (a JPEG comment), `canary-source-06` (in the PDF).

## The booklet

*The Placeholder Leaflet,* No. 3, Spring: an eight-page leaflet printed as a folded booklet and scanned as four two-up spreads. It exists only in native form (`tools/lib/booklet-fixture.js` writes it directly). It is not part of the sample library, and it has no TitleID or IssueID.

| PDF page | Left half | Right half |
|---|---|---|
| 1 | logical page 8 | logical page 1 |
| 2 | 2 | 7 |
| 3 | 6 | 3 |
| 4 | 4 | 5 |

- **Rotation.** Each PDF page is stored portrait with `/Rotate 90`, so it reads as a landscape spread once turned. Left and right are only meaningful upright.
- **Locations.** Every page has one. Pages 1, 4, 5 and 8 also give an exact box; the others give a region only. The cover is cut from the right half of PDF page 1.
- **Folios.** Page 1 has none printed (1 inferred). Pages 2 and 3 are printed. Page 4's is illegible (4 inferred). Pages 5–7 are not yet checked (`unverified`, numbers inferred). Page 8 has none (8 inferred).
- **Anchors.** Every page is enclosed in `LOGICAL_PAGE_N_START`/`END` anchors. Page 7 also has `<!-- PDF_PAGE: 2 -->`, its PDF page.
- **Items.** Pages 1–4 are divided into segments; pages 5–8 are not yet (`segmented: false`).
  - Item 2 runs from page 2 to page 3, across two PDF pages.
  - Item 5 runs from page 4 to page 5, across the centre spread (its row says so; page 5 is not yet divided, so its only segment is on page 4).
  - Item 4 is a child of item 3.
- **Markup.** A printed bracket that looks editorial, escaped as `\[Note: …\]`.
- **Identity.** `unresolved`. The rows have empty TitleID, IssueID and ContentID. The provisional key is `leaflet-specimen-0003`, and a retired key, `leaflet-specimen-draft`, is in the history.
- **Review.** One blocking review question.

It validates with no errors and no warnings.

## Regenerating

```sh
node tools/make-issue-fixture.js     # rewrites staging/, native/ and booklet/ here
```

The output is the same bytes every time. `run-tests.sh` checks that all three folders are exactly what the generator writes. To change the package, change the generator; never edit these files by hand.
