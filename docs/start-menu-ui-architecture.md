# Start Menu UI Architecture

## Overview

`racer_start_menu.html` contains the entire start menu UI in a single file: HTML structure, CSS (one `<style>` block), and JavaScript. The UI is a **4-step wizard**:

1. **Step 1 — Select Class** (`#step1`): 6 static HTML cards with `.card-icon` (img or emoji)
2. **Step 2 — Select Vehicle** (`#step2`): JS-rendered cards with `.card-icon` (from `VEHICLES[]` array)
3. **Step 3 — Select Track** (`#step3`): JS-rendered cards with `.card-thumbnail` (background-image from generated track thumbnail)
4. **Step 4 — Settings** (`#step4`): Sliders and toggles (no cards)

---

## Card HTML Structure

All three card-based steps use the same base structure:

```html
<div class="card">
  <div class="card-badge">...</div>          <!-- Optional: Optimized/WIP/Custom badge -->
  <div class="card-icon">...</div>           <!-- Steps 1 & 2: icon (img or emoji) -->
  <!-- OR -->
  <div class="card-thumbnail"></div>         <!-- Step 3: track thumbnail (background-image) -->
  <div class="card-title">Name</div>        <!-- Always present -->
  <div class="card-desc">Description</div>  <!-- Always present but globally hidden -->
</div>
```

### Key differences by step

| Feature | Step 1 (Class) | Step 2 (Vehicle) | Step 3 (Track) |
|---------|---------------|-------------------|-----------------|
| Source | Static HTML | JS `renderVehicles()` | JS `renderTracks()` |
| Visual element | `.card-icon` | `.card-icon` | `.card-thumbnail` |
| Badge element | `<div>` | `<div>` | `<div>` (built-in) / `<span>` (custom) |
| Has `.card-actions`? | No | No | Yes (custom tracks only) |

---

## Card Layout System

### Flex layout contract

All cards use this layout enforced by `!important` global overrides at the end of the `<style>` block:

```
┌─ .card ──────────────────────────┐
│  justify-content: flex-start     │  ← content stacks from top
│  flex-direction: column          │
│                                  │
│  ┌─ .card-badge ────────┐       │  ← absolute positioned, top-right
│  └──────────────────────┘       │
│                                  │
│  ┌─ .card-icon ─────────┐       │  ← flex: 1 (fills available space)
│  │  margin: auto         │       │  ← vertically centered via auto margins
│  │  display: flex        │       │  ← centers content within
│  │  align-items: center  │       │
│  └───────────────────────┘       │
│  ┌─ .card-thumbnail ────┐       │  ← flex: 1 (fills available space)
│  │  background-size:     │       │  ← track image via CSS background
│  │    contain            │       │
│  └───────────────────────┘       │
│                                  │
│  ┌─ .card-title ────────┐       │  ← margin-bottom: 4px (pinned to bottom)
│  └──────────────────────┘       │
│  ┌─ .card-desc ─────────┐       │  ← display: none !important (hidden)
│  └──────────────────────┘       │
└──────────────────────────────────┘
```

### Global overrides (`!important`)

These rules at the end of the `<style>` block apply to ALL breakpoints:

```css
.card-desc  { display: none !important; }
.card       { justify-content: flex-start !important; }
.card-icon  { margin-top: auto !important; margin-bottom: auto !important; }
.card-title { margin-top: 0 !important; margin-bottom: 4px !important; }
```

**⚠️ Consequence:** Any responsive override setting `margin-bottom` on `.card-icon` or `.card-title`, or `justify-content` on `.card`, or `display` on `.card-desc` will be dead code.

Useful properties to override in responsive breakpoints:
- `.card-icon`: `font-size`, `flex`, `min-height`, `display`, `align-items`
- `.card-thumbnail`: `flex`, `min-height`, `max-height`, `margin-top`, `margin-bottom`
- `.card-title`: `font-size`, `white-space`, `text-overflow`
- `.card`: `padding`, `width`, `aspect-ratio`, `max-height`, `min-height`

---

## Responsive Breakpoints

### Width-based (portrait)

| Breakpoint | Grid layout | Card sizing | Thumbnail | Icon |
|-----------|-------------|-------------|-----------|------|
| **≥1440px** | `auto-fill, minmax(280px, 1fr)` | Base | Base: `min-h:120px, max-h:200px, mt:28px` | Base: `flex:1, min-h:120px, font:48px` |
| **1025–1439px** | `auto-fill, minmax(240px, 1fr)` | Base | Base | Base |
| **769–1024px** | `repeat(2, 1fr)` | Base | Base | Base |
| **481–768px** | `repeat(2, 1fr)` | `p:8px 10px, max-h:none` | `min-h:80px, max-h:160px, mt:10px` | `flex:1, min-h:80px, font:22px` |
| **≤480px** | `repeat(2, 1fr)` | `p:5px 6px, max-h:none` | `min-h:60px, max-h:140px, mt:8px` | `flex:1, min-h:60px, font:16px` |
| **≤360px** | gap:4px | — | — | — |

### Height-based (landscape/short screens)

| Breakpoint | Grid layout | Card sizing | Thumbnail | Icon |
|-----------|-------------|-------------|-----------|------|
| **≤500px h + landscape** (forms block) | — | — | — | — |
| **≤500px h + landscape** (cards block) | `flex-wrap, w:120px` | `w:120px, max-h:none` | `flex:1, min-h:0, mt:6px` | `flex:1, min-h:0, font:28px` |
| **≤420px h + landscape** | gap:10px | `w:105px, max-h:none` | `flex:1, min-h:0, mt:4px` | `flex:1, min-h:0, font:24px` |
| **501–700px h + landscape** | `flex-wrap, w:160px` | `w:160px, max-h:none` | `flex:1, min-h:0, mt:6px` | `flex:1, min-h:0, font:36px` |
| **≤500px h** (any orientation) | `auto-fill, minmax(100px, 1fr)` | `aspect:1, p:4px` | `flex:1, min-h:0, mt:6px` | `flex:1, min-h:0, font:12px` |

### Step-specific icon size overrides

Steps 1 and 2 double the `.card-icon` font-size for larger vehicle/class icons:

| Breakpoint | Base icon size | Step 1&2 icon size |
|-----------|---------------|-------------------|
| Base | `var(--icon-size)` | `calc(var(--icon-size) * 2)` |
| 481–768px | 22px | 44px |
| ≤480px | 16px | 32px |
| ≤500px h + landscape | 28px | 56px |
| ≤420px h + landscape | 24px | 48px |
| 501–700px h + landscape | 36px | 72px |

---

## Media Query Organization

The `<style>` block organizes media queries in this order:

1. **Base styles** — `.card`, `.card-icon`, `.card-thumbnail`, `.card-title`, etc.
2. **Fluid scaling section** — CSS custom properties, `clamp()` values
3. **Width breakpoints (descending)** — ≥1440 → 1025–1439 → 769–1024 → 481–768 → ≤480 → ≤360
4. **Landscape/height breakpoints** — `(max-height:500px, landscape)` for menus/forms only
5. **Height-only breakpoint** — `(max-height:500px)` for card sizing (any orientation)
6. **Feature-specific styles** — track builder, badges, custom track cards, animations
7. **Second landscape block** (~line 2035) — Card/grid/thumbnail/wizard layout for landscape
8. **420px and 501–700px landscape blocks** — additional landscape refinements
9. **Global overrides** — `!important` rules for card layout, icon scaling, descriptions

### ⚠️ Why there are multiple landscape blocks

The `(max-height: 500px) and (orientation: landscape)` query appears 3 times intentionally:

| Block | Purpose | Contains |
|-------|---------|----------|
| **1st** (~line 986) | Menu & form layout | `.menu-grid`, `.range-wrap`, `.settings-form`, `.form-group` |
| **2nd** (~line 2035) | Card & wizard layout | `header`, `.screen`, `.wizard-*`, `.selection-grid`, `.card`, `.card-icon`, `.card-thumbnail`, `.card-badge`, `.action-bar` |
| **3rd** (~line 2373) | Step icon overrides | `#step1 .card-icon`, `#step2 .card-icon` |

**Do NOT merge these.** They are separated for organizational clarity and to keep concerns isolated. Adding card rules to block 1 would put them before the height-only `(max-height:500px)` block, causing specificity issues.

---

## Common Pitfalls

### ❌ Don't use `overflow: hidden` on `.selection-grid`
Use `overflow-y: auto` instead. Grid-level clipping silently cuts off the bottom of thumbnail cards on small screens.

### ❌ Don't use rigid `max-height: calc(...)` on `.card`
Use `max-height: none` and let flex layout handle sizing. Rigid heights + `overflow: hidden` clip thumbnails.

### ❌ Don't set `margin-bottom` on `.card-icon` or `.card-title` in media queries
These are overridden by `!important auto` / `!important 4px` at the base level and will have no effect.

### ❌ Don't add a `.card-desc` display rule in a media query
It's globally set to `display: none !important` — any responsive override is dead code.

### ❌ Don't add `.card-thumbnail` `min-height: 120px` in a mobile breakpoint
The base value of 120px is too tall for small cards. Use `min-height: 0` (landscape) or `min-height: 60–80px` (portrait mobile).

### ✅ Do test at these viewport sizes after UI changes
- **480px × 800px** (portrait phone)
- **768px × 1024px** (portrait tablet)
- **915px × 412px** (landscape phone — Samsung Galaxy S20 Ultra)
- **1024px × 768px** (landscape tablet)
- **1440px × 900px** (desktop)

### ✅ Do bump `CACHE_VERSION` in `service-worker.js` before testing
Stale service worker cache will serve old CSS, making changes appear broken.

---

## Rendering Functions

| Function | File | Purpose |
|----------|------|---------|
| `renderVehicles()` | `racer_start_menu.html` | Populates `#vehicleGrid` based on selected class |
| `renderTracks()` | `racer_start_menu.html` | Populates `#trackGrid` with built-in + custom tracks |
| `TrackBuilder.makeThumbnail()` | `track_builder.js` | Generates 1024×N canvas → data URI for track thumbnails |
| `selectClass(cls, el)` | `racer_start_menu.html` | Handles class card click → sets `state.mode` |
| `selectVehicle(vid, el)` | `racer_start_menu.html` | Handles vehicle card click → sets `state.vehicle` |
| `selectTrack(tid, el)` | `racer_start_menu.html` | Handles track card click → sets `state.track` |
| `highlightCard(el)` | `racer_start_menu.html` | Adds `.selected` class, removes from siblings |
