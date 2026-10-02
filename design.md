# ProjectSpace design notes

How the UI is put together after the 2026 redesign, and the rules to follow when changing it. The README covers features, setup and deployment.

The redesign had two parts:
- **Visual:** a clean, neutral look in the style of Linear and Notion, built from design tokens and laid out mobile-first.
- **Flow:** organised around work. Home summarises every project you're in, and inside a project there are fewer, grouped pages.

---

## 1. Visual system

### Look
- **Colour:** grayscale surfaces with one indigo accent (`--primary`, `#4f46e5`). Colour carries meaning (status, priority, role) rather than decoration.
- **Surfaces:** cards are flat, with a 1px border and no shadow while at rest. Only overlays get a shadow: popovers, modals, sheets and toasts.
- **Fonts:** Inter, with Noto Sans Thai for Thai. Line height is 1.55 so Thai vowels and tone marks aren't clipped.
- **Icons:** [lucide](https://lucide.dev), always through `<Icon name="…" />` (`src/components/common/Icon.tsx`). Never import from `lucide-react` anywhere else. To add an icon, add it to the `ICONS` map. Icons are decorative (`aria-hidden`) by default; pass `label` when an icon stands alone and means something.
- **Themed exceptions:** Tarot (`pages/tarot.css`) and the gacha reveal (`sections/gacha-reveal.css`) keep their own visual style and may use raw colours.

### Tokens (`src/styles/tokens.css`)
Every colour, font size and radius comes from a token. Dark mode redefines the same tokens under `:root[data-theme=dark]`, so a component written with tokens works in both themes without extra code.

| Group | Tokens |
|---|---|
| Neutrals | `--bg` `--surface` `--surface-2` `--surface-3` `--border` `--border-strong` `--text` `--muted` `--dim` |
| Accent | `--primary` (text/borders), `--primary-solid` + `--on-primary` (filled buttons), `--primary-soft` (selected backgrounds) |
| Status | `--{success,warning,danger,info,violet,teal,pink}-{fg,bg,border}` |
| Type | `--fs-2xs` 11 · `xs` 12 · `sm` 13 · `base` 14 · `md` 16 · `lg` 20 · `xl` 24 · `2xl` 30 · `3xl` 40 |
| Space | `--sp-1` … `--sp-12` (4px steps) |
| Radius | `--r-xs` 4 · `sm` 6 · `md` 8 · `lg` 12 · `xl` 16 · `2xl` 20 · `full` |
| Controls | `--h-control` 34 · `--h-control-sm` 28 · `--h-touch` 36 |
| Layout | `--topbar-h` 56 · `--sidebar-w` 240 · `--rail-w` 64 · `--bottom-nav-h` 60 |
| Layers | `--z-topbar` < `--z-sidebar` < `--z-bulk` < `--z-bottom-nav` < `--z-chat` < `--z-sheet` < `--z-modal` < `--z-popover` |

**Touch sizing.** On touch screens (`@media (pointer: coarse)`) controls grow to 40 / 34 / 44px, and inputs use a 16px font so iOS doesn't zoom in on focus. Sizing follows the pointer type rather than the screen width, so a narrow desktop window stays compact and a tablet gets touch-sized targets. Pinch-zoom is allowed.

### CSS layout and rules
```
src/styles/index.css     imports everything, in order
  tokens.css  base.css
  components/  button field chip surface tabs modal overlay markdown
  layout/      shell.css (topbar, sidebar/rail/drawer, bottom nav, More sheet)
  sections/    one file per workspace page
  pages/       pages.css (login, home, new project, invite), tarot.css
```

**Breakpoints** are mobile-first, using `min-width` only: **640** (sm), **1024** (lg), **1440** (xl). A few phone-only overrides use `max-width: 639px`. Put responsive rules next to the base rule they change.

**Guard.** `npm run check:css` runs as part of `npm run build` and fails the build on any of these:
- a raw hex, `rgb()` or `hsl()` colour outside `tokens.css` and the two themed files
- `!important`, except inside the reduced-motion block
- a raw `font-size` or `border-radius` value; use the tokens instead

Default form-field styles use `:where()`, so they have zero specificity and are easy to override.

---

## 2. App shell

| Width | Navigation |
|---|---|
| < 640 (phones) | Top bar with a breadcrumb. The **P** logo goes Home. A bottom nav holds **Overview · Tasks · Notes · Docs · More**; More opens a sheet with the rest. |
| 640–1023 (tablet) | A 64px icon rail that opens as an overlay drawer. |
| ≥ 1024 (desktop) | A 240px sidebar that collapses to the rail. The collapsed state is saved in `localStorage` (`ps.sidebarCollapsed`). |

- **Top bar:** a `Project › Page › View` breadcrumb, then the Tarot, Feedback and avatar buttons.
- **Avatar menu (`UserMenu`):** language, theme, GitHub profile and sign-out. It drops down from the avatar on wider screens and opens as a bottom sheet on phones.
- **Modals:** a centred dialog from 640px up. On phones they become bottom sheets; editors (modals with header actions) go full screen.
- **Popovers and pickers:** these are portaled to `<body>` and pinned to their trigger with `useAnchoredPanel`, so a scrolling modal can't clip them. Below 640px they become bottom sheets.

---

## 3. Information architecture

### Home (`/`)
Home is a summary across every active project:
1. **Summary tiles:** active tasks, overdue, due in 7 days, assigned to me, and milestones due in 14 days. Clicking a tile scrolls to the matching section.
2. **Upcoming deadlines:** tasks and milestones due in the next 14 days, plus anything overdue, grouped by day. A **Mine / Everyone** toggle filters it and is remembered (`ps.home.deadlines`).
3. **My work:** my open tasks, grouped into Overdue · Today · Next 7 days · Later · No date.
4. **Project cards:** active tasks, an overdue badge, a progress bar and the next milestone.
5. Archived projects (collapsed), then the Tarot entry.

The data comes from `useHomeSummary`, which makes one listener per active project. It reuses the same cached queries the board and Overview use. The calculations are pure functions in `src/utils/home-summary.ts`, with unit tests.

### Project pages (`/p/:id/<page>`)

| Sidebar group | Page | Views (`?view=`) |
|---|---|---|
| Work | **Overview** `overview` | – |
| | **Tasks** `tasks` | `board` (default) · `table` · `calendar` |
| | **Plan** `plan` | `milestones` (default) · `usecases` · `diagrams` |
| | **Notes** `notes` | sticky-note canvas |
| | **Docs** `docs`, `docs/:documentId` | document library and reader |
| Collaborate | Team · Votes · Gacha | – |
| Manage | Settings | – |

- Notes and Docs are deliberately **separate pages**, not tabs of one page.
- View tabs (`ViewTabs`) change only `?view`. Filters (`q`, `m`, `group`, `month`) and an open `?task=` stay in the URL.
- **Old URLs** such as `/board`, `/calendar`, `/dashboard`, `/milestones`, `/design`, `/use-cases`, `/documents/:id` and `/notes/:id` are redirected by `legacySectionRedirect` in `src/utils/workspace-routes.ts`, which keeps the query string. When you move or rename a page, add a redirect row and a test.
- A project URL the user can't open shows `ProjectUnavailable` instead of silently sending them Home.

### Tasks: one shared editor
- **`TaskModalProvider`** (`src/components/board/TaskModalHost.tsx`) wraps the workspace. Pages call `useTaskModal()` and use:
  - `openTask(task | id)`, which pushes `?task=<id>`; Back closes the task again
  - `newTask(defaults)`
  - `isOpen`
- **No other page renders `<TaskModal>` itself.** Check with `grep -rn "<TaskModal" src`.
- **Link to a task** from anywhere with `/p/:id/tasks?task=<id>`.
- **The editor keeps an explicit Save button**, with these behaviours:
  - The checklist autosaves on tasks that already exist.
  - Closing with unsaved changes asks for confirmation.
  - New tasks have a "Save & add documents" button.
  - A locked status names the milestones it is waiting on.
- **Assignees** are picked with `AssigneePicker`: searchable, with "Assign to me". **Labels** are picked with `LabelPicker`.

### Onboarding
- **New project** offers a **Software project** template (`src/config/project-templates.ts`): 4 labels and 5 milestones. The milestones have no `dependsOn`, so nothing starts locked.
- **Overview** shows a **Getting started** checklist (task, teammate, milestone, document). It can be dismissed (`ps.gs.<projectId>`) and hides itself once every step is done.
- **Invite page** shows who invited you, when the link expires and the role, and gives readable errors (`src/utils/invite-errors.ts`).

---

## 4. Patterns to keep

- **Wait for data before showing numbers.** Show content only once everything it depends on has arrived, with static placeholders (`.list-skeleton`, `Metric value={null}`) until then. Don't render zeros that then count up, bars that grow one after another, or empty states that flash and disappear. Don't animate the placeholders. Inside a project, sections don't render until memberships have loaded, so role-dependent UI never shows "member" first.
- **Bilingual everywhere.** Every user-facing string is Thai + English, through `t('key')` (`src/utils/i18n.ts`; a test checks that both locales have the same keys) or `pick(locale, th, en)` for one-off text. The login page has no profile yet, so it uses the browser language plus its own toggle (`ps.loginLocale`).
- **`localStorage` is only for small per-viewer preferences.** Always wrap reads and writes in `try/catch` and render correctly when storage is blocked.
- **Accessibility:**
  - Focus rings are visible (`:focus-visible`).
  - Escape closes popovers, sheets and modals.
  - Icon-only buttons have an `aria-label`.
  - `prefers-reduced-motion` turns animations off.
