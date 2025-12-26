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

## 4. Advanced Services & Cloud Console Synchronization
**Date:** 2025-12-25
**Issue:** Persistent "server errors" (500) when using built-in `DriveApp` and `DocumentApp` services.
**Discovery:**
- Enabling "Advanced Services" in the Apps Script editor is only half the battle.
- The corresponding APIs (Drive API v3, Docs API v1) **must also be enabled** in the underlying Google Cloud Project console (console.cloud.google.com).
- Failing to do so results in a generic 500 error that gives no indication of the missing API configuration.

## 5. Drive API v3 vs. DriveApp (Shared Drives)
**Discovery:**
- Unlike the built-in `DriveApp`, the Advanced Drive Service (v3) is strictly partitioned.
- To access files or folders in a **Shared Drive**, you must explicitly include the flag `{ supportsAllDrives: true }` in every API call (get, copy, list, etc.).
- Without this flag, the API returns a "File not found" error, even if the user has full permissions.

## 6. Database Safety & Initialization
**Discovery:**
- Traditional `sheet.clear()` initialization patterns are catastrophic for production databases.
- **Best Practice:** Use a "Diff and Append" approach for headers. Compare the required schema against existing columns and only append missing ones to the end of the header row.
- **Legacy Fallbacks:** When migrating data from a JSON blob (like `meta_json`) to dedicated columns, the loading logic should attempt to "recover" data from the old location if the new column is empty.

## 7. Maintaining Production URLs
**Discovery:**
- To keep a Production URL constant while updating code, use the specific deployment ID with clasp:
  `clasp deploy -i [DEPLOYMENT_ID] -V [VERSION_NUMBER] -d "Description"`
- Creating a "New Deployment" in the UI generates a new URL, which breaks external bookmarks/links.

## 8. User Tracking & Audit Trails
**Date:** 2025-12-25
**Discovery:**
- `Session.getActiveUser().getEmail()` provides a reliable audit trail for actions taken within the app.
- Storing a `logged_by` field alongside `entry_date` ensures accountability.
- **Apps Script State Loss:** When updating local `STATE` objects in the frontend after a successful `google.script.run`, always use object spreading `{...old, ...new}` to preserve fields that weren't part of the update payload (like `entry_date`).

**Related Files:**
- Code.gs: `setupDatabase()`, `saveDonation()`, `getInitialData()` (Data recovery logic)
- Index.html: Header user display
- js.html: State preservation logic in `submitDonation()` success handler.
