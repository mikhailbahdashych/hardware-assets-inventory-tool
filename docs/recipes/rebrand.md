# Rebrand it

Your own name, colours and fonts. Roughly twenty minutes, and every step is one file.

**Two things are already yours without touching code.** The organization name comes from first-run setup and shows in the sidebar, the login screen and every email — change it in Admin → Settings. The rest of this is about the product's own identity: the word "Inventory", the accent colour and the typefaces.

---

## 1. The name in the UI

The wordmark is the second line under your organization's name in the sidebar, and it appears in a handful of strings:

```bash
rg -n 'Inventory' apps/web/src apps/api/src packages/shared/src --glob '!*.test.*'
```

The ones that matter:

- `apps/web/src/components/app/Sidebar.tsx` — the wordmark itself.
- `apps/web/index.html` — `<title>`, which is the browser tab.
- `apps/web/src/features/auth/*.tsx` — "Sign in to Inventory", "Set up Inventory".
- `apps/api/src/services/mail-templates.ts` — the header and footer of every message.

## 2. The colours — `apps/web/src/styles/tokens.css`

One file, both themes. The accent is what carries a brand:

```css
:root {
  --accent: #7c66dc; /* buttons, links, the active nav item */
  --acc: #6d55d4; /* the hover shade */
  --acc-bg: rgba(124, 102, 220, 0.12); /* pills, selected rows */
}
[data-theme='dark'] {
  --accent: #8d78ec;
  --acc: #a292f0;
  --acc-bg: rgba(141, 120, 236, 0.16);
}
```

**Change `--accent`, `--acc` and `--acc-bg` in both blocks and stop.** Everything accent-coloured in the app resolves through those three, so there is nothing to hunt for. Keep `--acc-bg` light enough that `--accent` text on it stays readable — that pairing is used by every accent pill.

The semantic colours (`--ok`, `--warn`, `--err`, `--info`, `--neut` and their `-bg` twins) are meaning rather than brand: green is available, amber is a warning, red is a problem. Retint them if your palette demands it, but do not swap what they mean.

Two colours live outside this file, on purpose:

- `apps/web/src/lib/avatar.ts` — the nine-colour palette avatars hash into.
- `apps/api/src/services/mail-templates.ts` — email clients do not read CSS variables, so the constants at the top of that file are literal. It is the one place in the repo a colour is written out.

## 3. The fonts

Self-hosted through `@fontsource`, because the app runs on-prem and must not call a CDN.

```bash
npm install @fontsource/<your-ui-font> @fontsource/<your-mono-font> -w apps/web
npm uninstall @fontsource/instrument-sans @fontsource/jetbrains-mono -w apps/web
```

Then the imports at the top of `apps/web/src/main.tsx` — one line per weight, and the app uses 400/500/600/700 for the UI font and 400/500 for the mono — and the two variables in `tokens.css`:

```css
--font-sans: 'Your Font', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'Your Mono', ui-monospace, monospace;
```

Mono is not decoration — it marks identifiers: asset tags, serial numbers, hostnames, keyboard hints, log timestamps. Whatever you choose has to make `0`/`O` and `1`/`l` distinguishable, because people read serial numbers off these screens and type them into other ones.

## 4. The logo

`apps/web/src/components/app/Sidebar.tsx` holds a 24px tile with a cube glyph from `components/ui/Icon.tsx`. Replace the `<Icon name="cube" />` with your own inline SVG at the same size, or add a path to the icon inventory in the same Feather style (stroke 1.7) and name it.

The favicon is `apps/web/public/favicon.svg`, referenced from `index.html`.

## 5. The repository

`package.json` `name` fields, the image name in `docker-compose.yml` and `.github/workflows/release.yml`, and the title of this README. `LICENSE` is MIT — keep the original copyright line and add your own.

## 6. Check it

```bash
npm run dev
```

Open `http://localhost:5173/kitchen-sink` — every primitive on one page — and compare against `docs/design-handoff/` in **both themes and both densities**. That page exists for exactly this: a brand change that looks right on the dashboard and wrong on a disabled button is the normal outcome of changing colours without looking at all of them at once.

## The step people forget

**The dark theme.** `tokens.css` defines the light palette on `:root` and overrides it under `[data-theme='dark']`. Changing only the first gives you a beautiful light mode and an accent in dark mode that is either invisible or shouting. Toggle the theme in the topbar before you call it done.
