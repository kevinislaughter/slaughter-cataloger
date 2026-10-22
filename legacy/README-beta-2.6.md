# Slaughter Cataloger

**A suite of local-first browser tools for documenting serial publications.**

Build a structured, exportable bibliography of periodicals — newsletters, magazines, journals, newspapers, zines, bulletins, and any other publication issued in numbered installments. Runs entirely in your browser. No account, no server, no data leaves your machine.

## Getting Started

Download all five HTML files into the same folder and open `slaughter-cataloger-beta2.6.html` in any modern browser. No installation, no server, no internet connection required.

Each app is a self-contained HTML file. Open them directly from disk (`File → Open`) or, if your browser restricts local file access, serve the folder with any lightweight local server:

```
python3 -m http.server
```

Then visit `http://localhost:8000/slaughter-cataloger-beta2.6.html`.

Work through the apps in order: **Titles → Issues → Contents → Compiler**.

## The Suite

- **Titles** (`slaughter-01titles-beta2.6.html`) — manages title-level metadata: canonical title, publication history, publisher, editors, frequency, ISSN. Creates TitleID, the upstream key for the entire suite.
- **Issues** (`slaughter-02issues-beta2.6.html`) — canonical issue list: volume, issue number, whole number, date, printer, pages, size, notes, and more. Requires a Titles CSV.
- **Contents** (`slaughter-03contents-beta2.6.html`) — records what appears inside each issue: articles, poems, editorials, authors, page ranges, content types. Requires an Issues CSV.
- **Compiler** (`slaughter-04compiler-beta2.6.html`) — produces formatted outputs from assembled title data. Current: Checklist, RIS for Zotero, Proofing Catalog, and WordPress Catalog. Future: bibliography and contents listing.

All tools are linked by **IssueID**, a permanent machine key (`TITLECOD-FIRSTYEAR-KXXXXXX`) that survives renaming, reordering, and editing. Every CSV includes schema metadata (`Slaughter Cataloger Tool` + `Schema Version`) for validation on import.

### IssueID format

```
EXAGAZEX-1872-K7M4Q2
```

| Segment | Length | Source | Example |
|---|---|---|---|
| `TITLECOD` | 8 chars | Auto-derived from title, editable | `EXAGAZEX` |
| `FIRSTYEAR` | 4 chars | First year of publication (CE); use `X` for unknown digits | `1872`, `187X`, `XXXX` |
| `KXXXXXX` | 7 chars | Randomly generated token; never sequential | `K7M4Q2` |

The `KXXXXXX` token uses a curated safe alphabet — digits `2–9` and uppercase letters, with `I`, `O`, `L`, `X`, and `1` removed to avoid visual ambiguity. Each token is 6 characters after the `K`, giving approximately 30^6 (729 million) possible values per TitleID. Tokens are checked for uniqueness against all existing entries before being assigned. **IssueID is generated once on first Record and never regenerated** — editing, renaming, or reordering does not change it.

---

## How It Works

The suite follows a locked dependency chain:

1. **Titles** — create title records, export Titles CSV
2. **Issues** — load Titles CSV, select a title, catalog issues, export Issues CSV
3. **Contents** — load Issues CSV, select an issue, record contents, export Contents CSV
4. **Compiler** — load Issues CSV (and optionally Titles CSV), generate formatted output

Each tool validates that loaded files have the correct schema and matching Title Library Slug.

---

## How to Use It

1. Download all `.html` files into the same folder
2. Start with `slaughter-01titles-beta2.6.html` — create your title records
3. Export Titles CSV, then open `slaughter-02issues-beta2.6.html` (Issues)
4. Load your Titles CSV, select a title, catalog issues
5. Export Issues CSV, then open `slaughter-03contents-beta2.6.html` (Contents)
6. Load your Issues CSV, select an issue, record contents
7. Open `slaughter-04compiler-beta2.6.html` to generate outputs

No installation, no dependencies, no internet connection required. See `slaughter-cataloger-beta2.6.html` for full documentation.

---

## Filename Policy

Working CSV files use stable, undated filenames. Schema version is stored inside each CSV row, not in the filename. Apps validate schema from CSV contents.

| File | Format |
|---|---|
| Titles CSV | `SCAT_[SLUG]_TITLES.csv` |
| Issues CSV | `SCAT_[SLUG]_[TITLEID]_ISSUES.csv` |
| Contents CSV | `SCAT_[SLUG]_[TITLEID]_CONTENTS.csv` |
| Compiler output | `SCATOUT_[SLUG]_[TITLEID]_[TYPE]_[DATE].[EXT]` |
| Compiler (library-wide) | `SCATOUT_[SLUG]_[TYPE]_[DATE].[EXT]` |

Backup/autosave files are explicitly labeled: `SCAT_[SLUG]_[TITLEID]_ISSUES_BACKUP_[DATE].csv`

## Key Features

- **Locked workflow** — each tool depends on its upstream data; no orphaned records
- **IssueID** — permanent machine key across the suite, never changes
- **Four field states** — Filled, Speculative (?), N/A, Unaddressed (orange underline)
- **Title Library Slug** — machine-friendly identifier for themed collections
- **Schema metadata** — every CSV row identifies its tool and version
- **Structured filenames** — `SCAT_` for source data, `SCATOUT_` for compiled outputs
- **Formula injection protection** — CSV exports prefix dangerous cell values
- **Session persistence** — localStorage autosave with restore banner
- **Import validation** — schema checking, Replace/Append/Cancel, duplicate reporting
- **Checklist compiler** — three styles (Plain, Bibliographic, Technical), twelve options, four export formats (HTML, Markdown, plain text, clipboard)
- **RIS for Zotero** — exports Contents items as citeable RIS records with full title/issue metadata
- **No backward compatibility** — 2.0 CSVs only; clean break from pre-release formats

---

## Documentation

See `slaughter-cataloger-beta2.6.html` for a full description of the suite architecture, IssueID system, field states, features, and release history.

---

## Status

**Beta 2.6** — released July 2026.

---

## Release History

**Beta 2.6** — July 2026. Titles dashboard for loading a library’s Titles, Issues, and Contents files together and viewing cataloging progress across all titles.

**Beta 2.5** — July 2026. New Compiler output modes: WordPress Catalog (native Gutenberg blocks), Proofing Catalog (print-optimised verification document), Full Catalog HTML. Volume/year grouping in all catalog outputs. Scope panel for filtering by volume or year group. Active titles filter — outputs only include titles with loaded issues. Compiler: unified readiness function, full RIS cross-validation, string-safe escape helpers, blank key validation, context-sensitive options panel, full title metadata in Titles manifest.

**Beta 2.0** — July 2026. Suite architecture: four apps (Titles, Issues, Contents, Compiler). IssueID permanent key system. Locked workflow. Checklist and RIS outputs. Schema metadata in every CSV. Structured filenames. Formula injection protection.

**Beta 1.1** — July 8, 2026. Printer/Printer Location fields. Supplement/Special fixes. N/A and Speculative mutually exclusive. Import Replace/Append/Cancel. 45-column Issues CSV.

**Beta 1.0** — July 6, 2026. Initial release. 43-column Issues CSV.

---
