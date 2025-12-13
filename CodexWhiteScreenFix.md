# Codex White Screen Fix

## Executive Summary (Root Cause)
The “white screen” on **Households** and **Projects** was caused by **malformed HTML structure in `Index.html`**: the `#view-households` and `#view-projects` sections were unintentionally **nested inside** `#view-donations` due to missing/incorrect closing tags around the Donations table/layout. When navigation called `switchView('view-households' | 'view-projects')`, the app hid **all** `.view-section` elements (including the parent `#view-donations`), which also hid the nested target view—leaving the content area blank.

Separately, the sidebar used `href="javascript:void(0)"` links under Apps Script’s iframe environment, which triggered Chrome’s **“Unsafe attempt to initiate navigation … to a javascript: url”** warnings and added noise/confusion during debugging.

## Symptoms Observed
- Clicking **Households** or **Projects** shows a blank/white content pane.
- Console repeatedly logs “Unsafe attempt to initiate navigation … to a javascript: url”.
- `renderHouseholdsDirectory()` / `renderProjectsDirectory()` logs may appear, but no UI is visible.

## Changes Made

### 1) Fix HTML nesting and view layout (`Index.html`)
- Replaced sidebar `<a href="javascript:void(0)">` items with `<button type="button">` to avoid `javascript:` navigation warnings in the Apps Script iframe.
  - Added stable IDs: `nav-dashboard`, `nav-donations`, `nav-households`, `nav-projects`.
- Corrected the Donations view markup so it closes cleanly:
  - Ensured the table container (`.table-responsive` / `.card-body` / `.card`) is fully closed.
  - Ensured `#view-donations` ends before other sections.
- Moved `#donationModal` **outside** of `#view-donations`.
- Ensured `#view-households` and `#view-projects` are **top-level siblings** of other `.view-section` elements (not nested).

Why this fixes the white screen:
- `switchView()` hides all `.view-section` elements, then unhides the target view.
- With correct sibling structure, the target view is no longer “hidden by a hidden parent”.

### 2) Update navigation wiring + harden error visibility (`js.html`)
- Updated internal navigation lookups to match the new sidebar button IDs:
  - Replaced `document.querySelector('a[onclick*="view-donations"]')` with `document.getElementById('nav-donations')`.
- Scoped the “active link” styling updates to the sidebar only:
  - Changed selection from `.list-group-item` to `#sidebar-wrapper .list-group-item` so other list groups (e.g., autocomplete results) aren’t affected.
- Added global error surfacing so failures don’t silently become a blank UI:
  - `window.addEventListener('error', …)` and `window.addEventListener('unhandledrejection', …)` route to `showError()` (fallback to `console.error` if needed).

## Deployment
- Ran `clasp push` and confirmed overwrite of the manifest when prompted.
- Pushed updated files including `Index.html` and `js.html`.

## How to Verify
1. Reload the published web app (hard refresh).
2. Click **Households** → the grid should render (no blank screen).
3. Click **Projects** → the grid should render (no blank screen).
4. Open DevTools Console:
   - The “Unsafe attempt to initiate navigation … javascript: url” errors should be gone.
   - Any runtime errors should show via the in-page alert (`#alert-container`) instead of leaving the UI blank.

## Notes / Follow-ups
- If the UI ever “goes blank” again, check the alert banner first—global error hooks now surface unexpected exceptions and promise rejections.
- Consider adding a lightweight HTML validation step (even manual) when editing `Index.html` to prevent future tag-balance regressions.
