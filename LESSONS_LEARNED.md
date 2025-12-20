# Project Lessons Learned & Debugging Protocols

## 1. UI Visibility & Navigation Issues (The "White Screen" Bug)
**Date:** 2025-12-12
**Incident:** The "Households" and "Projects" views rendered as blank white screens despite the data loading correctly and no console errors.
**Root Cause:** Structurally malformed HTML. A missing closing `</div>` tag in the `#view-donations` section caused the subsequent view containers (`#view-households`, etc.) to be parsed as *children* of the donations view.
**Technical Detail:** The `switchView()` function hides all `.view-section` elements. Because the target view was accidentally nested inside a hidden parent view, unhiding the target had no effect (it remained hidden by its parent).
**Corrective Protocol for Future Agents:**
- **Step 1:** Before debugging JS logic or data fetching, verify the DOM hierarchy.
- **Step 2:** Ensure high-level containers (like `.view-section`) are **siblings**, not nested children.
- **Check:** Do not rely on visual indentation in the editor; verify the actual closing tags match the opening tags.

## 2. Feature Updates: Match Donation Type & Default Project
**Date:** 2025-12-20
**Changes Made:**
- Added "Match" as a new payment method option across all UI elements (Dashboard filters, Donation Management filters, Donation Modal, Export filters)
- Implemented default project selection: When logging a new donation, the Project dropdown now defaults to "General Fund"
**Implementation Notes:**
- The Match option was added to `<select>` elements in `Index.html` and filter logic in `js.html`
- Default project logic uses `STATE.projects.find(p => p.name === 'General Fund')` to locate and select the correct project ID
