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

## 3. OAuth Scope Changes in Production Deployments
**Date:** 2025-12-24
**Issue:** Adding new OAuth scopes to `appsscript.json` breaks production web app deployments
**Root Cause:** Web app deployments require explicit reauthorization when OAuth scopes change. Simply pushing code via `clasp push` updates the script files but does NOT update the web app's OAuth permissions.

**What Doesn't Work:**
- ❌ `clasp push` alone - only updates code, not web app OAuth
- ❌ Editing @HEAD deployment via UI - doesn't consistently trigger reauth
- ❌ Running auth functions in Apps Script editor - authorizes editor, not web app
- ❌ `clasp deploy -i <deployment-id>` - cannot modify read-only @HEAD deployment

**Automated Solution That Works:**
```bash
# Create NEW versioned deployment (triggers OAuth consent automatically)
clasp deploy -V <version> -d "Description mentioning new OAuth scopes"

# Example:
clasp deploy -V 113 -d "v113: Gmail templates and Doc archiving (new OAuth: gmail.readonly, documents, drive)"
```

**Why This Works:**
- Creates a brand new deployment with a new ID
- New deployments automatically request OAuth authorization
- User can test new deployment URL before switching production
- @HEAD remains unchanged and functional during testing

**Process for Future OAuth Changes:**
1. Add new scopes to `appsscript.json`
2. Run `oauth_preflight_check()` function to verify scopes in editor
3. Create new deployment: `clasp deploy -V <next-version> -d "Description"`
4. Test new deployment URL thoroughly
5. Once verified, switch production to use new deployment URL
6. Document the change in git commit and release notes

**Manual Fallback (if clasp unavailable):**
- Apps Script UI → Deploy → **New deployment** (not "Manage deployments")
- Type: Web app
- Execute as: Me
- **Deploy** - this triggers OAuth consent
- Authorize all new scopes when prompted

**OAuth Preflight Check Function:**
Use `oauth_preflight_check()` in Code.gs to verify all scopes are authorized before creating production deployments. This function tests each OAuth scope and returns a status report.

**Related Files:**
- `scripts/deploy-with-oauth.sh` - Automated deployment script with OAuth handling
- Code.gs: `oauth_preflight_check()` - Validates OAuth scopes before deployment
