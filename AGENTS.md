# Agent instructions

## Documentation is part of the feature

`docs/documentation/` in this repository is the single source of truth for public, user-facing
Osade documentation. The landing page reads only these Markdown files directly; never copy or
mirror them into the landing-page repository. Other files under `docs/` are internal specs,
architecture notes, and working documents and do not appear on the documentation site.

Whenever you add or materially change an important or user-facing feature, update the relevant
Markdown file in `docs/documentation/` in the same change. Create a focused new guide there when
no existing page is a good home. Documentation must describe the behavior that actually ships,
including important setup, controls, constraints, and failure modes.

Markdown files may start with frontmatter containing `title` and `description`. Both fields are
optional because the documentation site derives sensible values from the first heading and body
when they are absent.
