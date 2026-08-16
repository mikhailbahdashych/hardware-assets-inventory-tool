# Handoff: Hardware Asset Inventory

Self-hosted, open-source hardware asset inventory for IT teams — track devices, who holds them, and full ownership history. Desktop-only web app, light + dark modes.

## About the Design Files

The files in this bundle are **design references created in HTML** (a single interactive prototype, `Asset Inventory.dc.html`). They show intended look and behavior — they are NOT production code to copy directly. The task is to **recreate these designs in the target codebase's environment** (e.g. React/Vue + your backend of choice) using its established patterns, or to pick an appropriate stack if none exists yet.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and interactions are final intent. Recreate pixel-close using the exact tokens below.

## Design Language

Linear-adjacent: quiet, dense, professional. Subtle 1px borders instead of heavy shadows, one violet accent, muted grays, small type (13–13.5px base), monospace for identifiers (asset tags, serials, timestamps). No gradients, no emoji.

## Design Tokens

### Typography

- UI font: **Instrument Sans** (Google Fonts), weights 400/500/600/700; fallback `system-ui, sans-serif`
- Mono font: **JetBrains Mono** 400/500 — asset tags, serials, hostnames, kbd hints, log timestamps
- Base size 13.5px, line-height 1.45
- Scale: 11px (footnotes/kbd) · 11.5px (badges, secondary cell text) · 12–12.5px (labels, helper text, table cells) · 13px (nav, body, buttons) · 14px (modal titles, semibold) · 17–18px (page titles, semibold 600) · 20px (KPI numbers, 600)
- Weights: 400 body · 500 labels/cell emphasis · 600 titles, buttons, badges

### Colors — light theme

| Token        | Value                   | Use                                                  |
| ------------ | ----------------------- | ---------------------------------------------------- |
| bg           | `#fafaf9`               | app background, input backgrounds                    |
| surface      | `#ffffff`               | cards, tables, modals, topbar                        |
| side         | `#f4f4f2`               | sidebar background                                   |
| border       | `rgba(22,22,28,.1)`     | all 1px borders, dividers                            |
| text         | `#1c1c21`               | primary text                                         |
| muted        | `#6f6f78`               | secondary text, labels, inactive nav                 |
| faint        | `#a3a3ab`               | placeholders, footnotes, kbd                         |
| hover        | `rgba(22,22,28,.045)`   | row/button hover, active nav bg                      |
| thead        | `rgba(22,22,28,.025)`   | table header row bg                                  |
| accent       | `#7c66dc`               | primary buttons, links, active states, focus borders |
| accent-hover | `#6d55d4`               | primary button hover                                 |
| accent-soft  | `rgba(124,102,220,.12)` | selected chips, "Assigned" badge bg, logo tile       |

### Colors — dark theme

| Token   | Value                                                     |
| ------- | --------------------------------------------------------- |
| bg      | `#0e0e11`                                                 |
| surface | `#16161a`                                                 |
| side    | `#121216`                                                 |
| border  | `rgba(255,255,255,.09)`                                   |
| text    | `#e8e8ec`                                                 |
| muted   | `#8f8f98`                                                 |
| faint   | `#5d5d66`                                                 |
| hover   | `rgba(255,255,255,.05)`                                   |
| thead   | `rgba(255,255,255,.03)`                                   |
| accent  | `#8d78ec` (hover `#a292f0`, soft `rgba(141,120,236,.16)`) |

### Semantic / status colors (fg + pill bg)

| Status               | Light     | Light bg                | Dark      | Dark bg                 |
| -------------------- | --------- | ----------------------- | --------- | ----------------------- |
| Available / success  | `#15803d` | `rgba(22,163,74,.11)`   | `#4ade80` | `rgba(74,222,128,.13)`  |
| Assigned             | accent    | accent-soft             | accent    | accent-soft             |
| In repair / warning  | `#b45309` | `rgba(217,119,6,.12)`   | `#fbbf24` | `rgba(251,191,36,.13)`  |
| Lost/Stolen / danger | `#dc2626` | `rgba(220,38,38,.1)`    | `#f87171` | `rgba(248,113,113,.13)` |
| Ordered / info       | `#2563eb` | `rgba(37,99,235,.1)`    | `#60a5fa` | `rgba(96,165,250,.13)`  |
| Retired / neutral    | `#71717a` | `rgba(113,113,122,.12)` | `#9f9fa8` | `rgba(159,159,168,.14)` |

Avatar palette (initials circles, assigned by index): `#7c66dc #0d9488 #d97706 #2563eb #db2777 #059669 #dc2626 #6366f1 #b45309`, white text.

### Spacing & geometry

- Page padding: 24px top / 28px sides; content max-width 1160px (lists), 1060px (details), 960px (members)
- Card gap: 14px; page section gap 14–20px; form field gap 12–13px
- Radius: 6px inputs/buttons · 8px cards/tables/dropzones · 10px modals/login card · 99px pills/badges · 50% avatars
- Card: surface bg, 1px border, radius 8, shadow `0 1px 2px rgba(0,0,0,.04)` (dark: `rgba(0,0,0,.3)`), padding 16px 18px
- Modal shadow: `0 16px 48px rgba(0,0,0,.18)` (dark `.55`); overlay `rgba(10,10,14,.45)`
- Table row padding: **12px** vertical (comfortable) / **7px** (compact) — user-switchable; 16px horizontal; 12px column gap
- Control heights: inputs 31–34px · buttons 29–30px · small buttons/chips 26–27px · topbar 46px · sidebar 216px wide
- Icons: 13–15px, stroke 1.7, round caps/joins (Feather-style outline)

## Screens

### 1. Login

Centered 360px column: 40px logo tile (cube icon on accent-soft, radius 10) → "Sign in to Inventory" 17px/600 + subtitle → card with Email, Password (with "Forgot?" link), primary "Sign in", "or" divider, ghost "Continue with SSO" → footer `v1.4.2 · open source · self-hosted at …` in faint 11.5px. Theme toggle top-right.

### 2. App shell (all other screens)

- **Sidebar 216px**, side bg, right border. Top: 24px logo tile + "Acme Corp / Inventory" two-line wordmark. Nav: Dashboard, Assets, Employees, Members, then 10px gap, Admin. Items: 6px 8px padding, radius 6, icon+label 13px; active = hover bg + text color + weight 600; inactive = muted 500. Bottom (pinned): current user (avatar, name, role) + sign-out icon button.
- **Topbar 46px**, surface bg, bottom border: breadcrumb (13px/600, e.g. "Assets / AST-0142") left; right: search button 230px ("Search assets, people…" + ⌘K kbd chip) opening the command palette, theme toggle.

### 3. Dashboard

Header row: title + date/summary subtitle; ghost "Customize widgets" button (opens widget modal). Widgets (each individually toggleable):

- **Status counts**: 6 KPI cards in a 6-col grid — colored 7px status dot + label 12px muted, count 20px/600. Click filters the Assets list to that status.
- Two-column grid `1.35fr 1fr`. Left: **Assets by category** (rows: 88px label, track bar 7px tall radius 4 with accent fill by proportion, count) and **Recent activity** (colored dot + text + actor + relative time, divided rows, "Audit log" link → Admin). Right: **Warranty expirations** (asset name + mono tag, days-left pill colored by urgency; rows click through to the asset) and **Pending returns** (asset, person, due date; footnote "Triggered by offboarding · email reminders on").

### 4. Assets (list)

Toolbar: title, density segmented control (Comfortable/Compact), ghost "Import CSV", primary "+ New asset". Filter row: text input (filters name/tag/serial live) + status pill tabs with counts ("All 13", "Available 2", …; active = accent-soft bg accent text). Table columns: `minmax(210px,1.6fr) 100px 130px 110px 150px 95px 95px` = Asset (name + mono tag below) · Category · Serial (mono) · Status pill (dot + label) · Assigned to · Purchased · Warranty. Rows hover-highlight and navigate to Asset detail. Footer count line.

### 5. Asset detail

Back link "‹ Assets". Header: name 18px/600 + status pill, mono `tag · serial` below; right: ghost "Edit" + primary action (contextual: **Check in** when Assigned / **Assign** when Available / "Change status" otherwise). Grid `1.5fr 1fr`:

- Left: **Details** card (2-col key/value rows: category, model, serial, tag, purchased, price, warranty, supplier) · **Custom fields** card (MDM enrolled, disk encryption, hostname, cost center; "Edit fields" link) · **Attachments** (file rows with size, Upload action) · **Audit log** (mono date + event + actor rows).
- Right: **Current holder** (avatar, name, title·location, "Checked out {date} · {duration}"; links to employee; unassigned states show a contextual note) · **Ownership history** vertical timeline (dot color: accent=current, neutral=past, green=added; connector line; name + date range + duration).

### 6. Employees (list)

Toolbar: density control, "Import CSV", primary "+ Add employee". Columns `minmax(200px,1.5fr) 1.3fr 130px 130px 80px 100px`: Name (avatar + name + job title) · Email · Department · Location · Assets (count) · Status pill (Active=green, Offboarding=amber). Rows → Employee detail.

### 7. Employee detail

Back link. Header: 44px avatar, name + status pill, `title · dept · location · email` line; ghost "Edit" + primary "Assign asset" (opens assign modal in pick-an-asset mode). **Currently holding · N** table (asset, category, serial, since date, "Check in →" affordance; rows → asset). **Assignment history** list (past holdings with date ranges and outcome).

### 8. Members

Header explains the concept: members = people who can sign in; employees = staff who hold assets; same person can be both. Primary "+ Invite member". Columns `minmax(200px,1.5fr) 110px 140px 110px 110px 40px`: Member (avatar, name, email) · Role pill (Admin=accent, Manager=blue, Viewer=gray) · Linked employee (link → employee detail) · Last active · Status (Active=green, Invited=blue) · overflow "···". Footer: role definitions.

### 9. Admin (admins only)

Underline tabs: **Activity log** / **Settings**.

- Activity log: type filter pills with counts (All/Assets/People/Auth/System), "Export log" ghost. Columns `135px 150px 1fr 90px`: mono time · actor · event · type pill (Assets=accent, People=blue, Auth=gray, System=amber). Footer: retention note.
- Settings (max-width 680): **Organization** (company name, default currency, mono asset-tag prefix, warranty-alert lead time) · **Email notifications** (toggle switches: warranty alerts, return reminders, invite emails, weekly digest) · **Data** (CSV template downloads, export-all JSON, log retention select) · **Danger zone** (red border card, "Delete workspace").

## Modals (all: overlay rgba(10,10,14,.45), card radius 10, header with title+subtitle+X, footer border with Cancel ghost + primary; Esc closes; click-outside closes)

- **⌘K Command palette** (560px, top-aligned ~12vh): search input + "esc" kbd; grouped results — Assets (icon, name, tag·status), Employees (name, title·dept), Actions (New asset, Add employee, Invite member, Import CSV, Toggle theme, Admin settings); live filter; empty state; footer hint bar "↑↓ navigate · ↵ open · esc close". Opened via topbar search or ⌘K/Ctrl-K globally.
- **New asset** (560px, scrollable): Name*, Category* (select), Status* (select), Asset tag (auto-generated `AST-nnnn`, editable, mono), Serial (mono), Assigned to (select; hint: only when status Assigned — creates first ownership record), Purchase date, Price, Supplier, Warranty until, Notes, Custom fields (checkboxes: MDM enrolled, disk encryption + "Manage fields"), attachment dropzone. Footer: "* Required", "Create another" checkbox, Cancel, Create asset.
- **Add employee** (520px): First*, Last*, Work email* (hint: matches CSV imports and invites), Job title, Department (select), Location, Start date, Employee ID (mono, optional). Divider, then "Also invite as a member of this app" checkbox → reveals Role select + invite-email hint.
- **Invite member** (480px): Email*, Link to employee (optional select, hint), Role* as radio cards (Admin/Manager/Viewer, each with a one-line permission description; selected = accent border + soft bg + filled radio dot), "Send invitation email now" checkbox.
- **Check in** (460px, from an Assigned asset): Return date*, Condition (Good/Needs repair/Damaged), New status* segmented (Return to stock / In repair / Retired), Notes, "Email confirmation to {holder}" checkbox.
- **Assign** (480px, two modes): from an asset → search+pick an Active employee (avatar rows, selected = accent-soft); from an employee → search+pick an Available/Ordered asset. Then Checkout date*, Expected return (optional), Notes, "notify assignee" checkbox.
- **Import CSV** (560px): Assets/Employees segmented switch; template file row with "Download template" (see `assets-template.csv` / `employees-template.csv` in this bundle); dashed dropzone ("Up to 5,000 rows · you'll review column mapping next"); column chips — required ones marked `*` in accent (assets: asset_tag*, name*, category*; employees: first_name*, last_name*, email*); behavior notes (unknown assignee email → Unassigned; employees matched by email → updated not duplicated).
- **Customize dashboard** (420px): five widget rows with 32×19px toggle switches (accent when on, knob slides 13px); changes apply live; note "Widget layout is saved per member".

## Interactions & Behavior

- Hover: rows/list items get `hover` bg; ghost buttons get `hover` bg; primary buttons darken to accent-hover; KPI cards border-darken. Cursor pointer on all clickable rows.
- Focus: inputs get accent border (no outline ring).
- Theme toggle: sun/moon icon button; instant swap of the token set. Density toggle: swaps row padding 12px↔7px.
- Navigation: sidebar highlights section including detail pages (Assets active on asset detail); breadcrumb reflects depth.
- Keyboard: ⌘K/Ctrl-K opens palette anywhere; Esc closes any modal.
- Toggle switches animate knob `transform .15s`.
- Sign out returns to Login.

## State Management (suggested)

- Global: theme (persisted per user), density (persisted), current user + role (gates Admin nav + page)
- Per-user: dashboard widget visibility map
- Assets list: status filter, text query. Activity log: type filter.
- Modal stack: one active modal + context (asset/employee being acted on); assign modal carries mode (pick-employee vs pick-asset)
- Entities: Asset (tag, name, category, serial, status, assignee→Employee, purchase{date,price,supplier}, warranty, notes, custom fields, attachments, ownership history[], audit events[]) · Employee (name, email, title, dept, location, employeeId, status Active/Offboarding, start date) · Member (email, role Admin/Manager/Viewer, status Active/Invited, optional link→Employee, last active)
- Statuses: Available, Assigned, In repair, Ordered, Retired, Lost/Stolen. Roles: Admin (full), Manager (edit), Viewer (read-only).

## Assets

No raster images. All icons are inline Feather-style outline SVGs (24 viewBox, stroke 1.7, currentColor): grid, cube, users, shield-check, gear, search, sun, moon, plus, upload, file, pencil, chevron-left, log-out, x. Fonts from Google Fonts (self-host for the real app since it runs on-prem).

## Files

- `Asset Inventory.dc.html` — the full interactive prototype (all screens + modals; open in a browser; state and demo data are in the embedded script)
- `assets-template.csv`, `employees-template.csv` — the CSV import templates referenced by the Import modal
