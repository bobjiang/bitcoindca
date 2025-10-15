# BitcoinDCA Documentation Site

The official documentation for BitcoinDCA is built with [Docusaurus 3](https://docusaurus.io/) and lives in this package. It is designed to serve two audiences:

- **End users** who want to create and manage automated DCA strategies.
- **Developers** who integrate, extend, or monitor the protocol.

## Prerequisites

- Node.js 20+
- `pnpm` v8+
- Access to the root `bitcoindca` repository (this package relies on shared configs)

Install dependencies from the repository root:

```bash
pnpm install
```

## Local Development

Start a local docs server with hot reload:

```bash
pnpm -F docs start
```

The site runs at [http://localhost:3000](http://localhost:3000). Edits to Markdown/MDX, sidebar configuration, or theme files will reload automatically.

## Build & Preview

Generate a production build:

```bash
pnpm -F docs build
```

Preview the built assets locally:

```bash
pnpm -F docs serve
```

## Writing Content

- Documentation lives in `docs/docs/` and is organised by audience (Overview, Core Concepts, User Guides, Developer Guides, Reference, Operations).
- Every page uses Markdown or MDX. Use the front matter `sidebar_position` to influence ordering inside categories.
- Add new pages to `docs/sidebars.ts` to expose them in the navigation tree.
- Code snippets should compile or run against the current repository whenever possible. Prefer snippets lifted from the integration and security test suites (`contracts/test`).

## Search

The site uses the [`@easyops-cn/docusaurus-search-local`](https://github.com/easyops-cn/docusaurus-search-local) plugin. Search indices are generated at build time—no external services or API keys are required.

## Deployment

The build output in `docs/build/` is static and can be hosted on any CDN or object storage. The site is configured with `baseUrl: /docs/`, so upload the contents to serve from the `/docs` path of your host (for GitHub Pages, use the `docs` folder setting or a reverse proxy).

For GitHub Pages, point the deployment pipeline at this package and reuse the standard Docusaurus deployment command:

```bash
pnpm -F docs deploy
```

Set the `GIT_USER` environment variable or enable SSH (`USE_SSH=true`) to push to `gh-pages`.

## Contributing

1. Open an issue for structural changes or large content rewrites.
2. Keep the docs versioned alongside protocol changes. If you update on-chain APIs or user flows, update the reference and user guide pages in the same PR.
3. Run `pnpm -F docs build` before submitting a PR to ensure broken links and Markdown warnings are caught locally.

Please see `AGENTS.md` and `architecture.md` at the repository root for broader contribution guidelines.

## Integrating with the Next.js frontend

- Run `pnpm docs:sync` from the repo root to build the docs and copy the output into `frontend/public/docs`.  
- The Next.js app rewrites `/docs` requests to the bundled static files, so the documentation is available from the main site without a separate server.  
- Remember to rerun `pnpm docs:sync` whenever documentation content changes.
