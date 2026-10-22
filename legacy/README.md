# Beta 2 (legacy)

The Beta 2 apps, kept for reference. They read and write schema 2.0 CSVs; Slaughter Cataloger 3.0
reads only 3.0 files. To move a Beta 2 library to 3.0, convert it once with
`node tools/convert-to-3.js <beta 2 folder> --out <new folder>` (see the main README).

- `beta-2.5/`, `beta-2.6/`: the four-app suite (Titles, Issues, Contents, Compiler) and its overview page.
- `beta-2.7/`: the same apps combined into one file.
- `README-beta-2.6.md`: the README as it was for Beta 2.6.

These copies are the Beta 2 apps with their example text made neutral: sample titles, codes, IDs,
library names and other placeholder values were replaced with generic ones, the feedback line
now points to the project's issue page, and the credit line names the author only. Nothing else
in them was changed. The original Beta releases, as they were first published, are kept
separately and are not part of this repository.
