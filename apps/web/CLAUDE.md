# apps/web — React SPA

React 19 + Vite + TypeScript, react-router (declarative `BrowserRouter` mode). No Tailwind, no component libraries: the design handoff is token-based and primitives are hand-rolled for pixel fidelity.

## Design system rules

- `src/styles/tokens.css` defines all 25 CSS custom properties for both themes plus density. It mirrors `docs/design-handoff/` **exactly** — never invent or tweak token values.
- Theme/density ride on `<html data-theme data-density>`. An inline script in `index.html` applies them from localStorage before first paint (no flash). `ThemeProvider` owns changes and mirrors them to localStorage (server persistence per member arrives with auth).
- **Density**: `--rp` is table-row vertical padding (12px ↔ 7px). Only data-table row types consume it — nothing else changes with density.
- **Semantic colors**: components take an `sv` key (`ok|acc|warn|err|info|neut`) from `@inventory/shared` maps and style via `var(--{sv})` / `var(--{sv}-bg)`. `Pill` shows the pattern.
- Typography: UI font Instrument Sans, mono JetBrains Mono (`var(--font-sans)` / `var(--font-mono)`), self-hosted via @fontsource — never add a font CDN (the app runs on-prem). Mono is for identifiers: asset tags, serials, hostnames, kbd hints, log timestamps.
- Icons: `components/ui/Icon.tsx` holds the design's Feather-style path inventory (stroke 1.7). Add new icons there in the same style; don't add an icon library.

## Structure

- `components/ui/` — primitives (Button, Pill, DataTable, Modal, …), one component + one CSS module each, exported from `index.ts`. Interactive primitives have behavior tests in `primitives.test.tsx`.
- `components/app/` — app chrome (shell, sidebar, topbar, palette) — arrives with the shell PR.
- `features/<area>/` — pages and feature modals per area (auth, dashboard, assets, employees, members, admin, import).
- `providers/` — ThemeProvider, ToastProvider (and later ModalProvider). Hooks are exported next to their provider.
- `lib/` — `format.ts` (dates, relative time, durations, currency, initials) and `avatar.ts` (stable hash → 9-color palette). Reuse these; never re-implement formatting inline.

## Reviewing visual work

Run `npm run dev` and open `http://localhost:5173/kitchen-sink` (dev-only route, excluded from production builds). Compare against the prototype in `docs/design-handoff/` side-by-side, in **both themes and both densities**, before calling UI work done.

## Testing

Vitest + Testing Library (jsdom). `vitest.setup.ts` registers cleanup and a localStorage shim (Node's experimental global shadows jsdom's). Write the failing test first. Components assert behavior via roles/attributes (`data-variant`, `aria-checked`), not CSS classes.

## Adding a primitive

1. Check the prototype for exact styles (inline `style="…"` attributes are the spec).
2. Test first for any behavior; static markup is covered by the kitchen sink.
3. Component + CSS module in `components/ui/`, export from `index.ts`, add a kitchen-sink section.
