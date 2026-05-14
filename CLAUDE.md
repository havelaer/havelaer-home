# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build      # compile content → build/
pnpm dev        # build + watch mode (rebuilds on file changes)
pnpm check      # lint with Biome (only targets lib/**)
pnpm serve      # serve the build/ directory locally
```

No test suite is configured.

## Architecture

This is a minimal static site generator for a personal homepage. The entire build pipeline lives in `lib/build.ts` and works as follows:

1. **Content** (`content/*.md`) — Markdown files with YAML front matter. Each file maps to a route: `content/index.md` → `/`, `content/foo/bar.md` → `/foo/bar/`. Front matter supports a `meta` key with `title` and `description`.

2. **Template** (`templates/layout.hbs`) — A single Handlebars layout receives `{ meta, content, route, source }` and wraps the rendered HTML. `{{{content}}}` is the compiled Markdown body (triple braces — unescaped).

3. **Static assets** (`public/`) — Copied verbatim into `build/` after each build. Contains `styles.css` and favicon assets.

4. **Output** (`build/`) — Generated on every build; do not edit files here directly.

## Tooling

- **Biome** for linting and formatting (`lib/**` only). Single quotes, 2-space indent, 100-char line width, trailing commas.
- **tsx** runs `lib/build.ts` directly — no separate compile step needed.
- **gray-matter** parses front matter, **marked** converts Markdown to HTML, **Handlebars** renders the layout template.
