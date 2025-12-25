// App Version - update this when deploying new versions
const APP_VERSION = '1.0.0';

// Email archive folder ID
const EMAIL_ARCHIVE_FOLDER_ID = '1ODJ1pXaIXR9CUMhWeuDDB5mz13DXWOoe';

// Gmail draft template subject (used to find the template)
const EMAIL_TEMPLATE_SUBJECT = 'TEMPLATE: Thank You Email';

// Google Doc archive template ID
const ARCHIVE_TEMPLATE_ID = '1Jm6Sxoset4Wzo8pmDReIIvU59QZdciUYdVPGLAbXx8Q';

// Email archiving toggle - set to false to temporarily disable if Google APIs are having issues
const ARCHIVE_ENABLED = true;

function getVersionInfo() {
  return {
    version: APP_VERSION,
    timestamp: new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    })
  };
}

/**
 * getEmailTemplateHtml - Fetches the HTML content from a Gmail draft template.
 * The draft is identified by its subject line matching EMAIL_TEMPLATE_SUBJECT.
 */
function getEmailTemplateHtml() {
  const drafts = GmailApp.getDrafts();
  for (const draft of drafts) {
    if (draft.getMessage().getSubject() === EMAIL_TEMPLATE_SUBJECT) {
      return draft.getMessage().getBody();
    }
  }
  throw new Error('Email template draft not found. Create a Gmail draft with subject: ' + EMAIL_TEMPLATE_SUBJECT);
}

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.versionInfo = getVersionInfo();
  return template.evaluate()
    .setTitle('DonorCRM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * getDatasource - Helper to get the Spreadsheet object.
 * Handles both Bound scripts (ActiveSpreadsheet) and Standalone scripts (openById).
 */
function getDatasource() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {
    // Ignore, likely standalone
  }

  // Fallback: Check Script Properties for a linked ID
  const props = PropertiesService.getScriptProperties();
  const storedId = props.getProperty('SHEET_ID');
  
  if (storedId) {
    return SpreadsheetApp.openById(storedId);
  }
  
  return null;
}

/**
 * setupDatabase - One-time setup.
 * Creates a new Spreadsheet if one doesn't exist/isn't linked.
 * Now supports household-based donor management with multiple members per household.
 */
function setupDatabase() {
  let ss = getDatasource();

  if (!ss) {
    // No active sheet and no stored ID -> Create a new one
    ss = SpreadsheetApp.create("DonorCRM_DB");
    const id = ss.getId();
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', id);
    console.log("Created new Spreadsheet. ID saved: " + id);
    console.log("URL: " + ss.getUrl());
  } else {
    console.log("Using existing Spreadsheet. ID: " + ss.getId());
  }

  const sheets = [
    { 
      name: 'db_Households', 
      headers: ['household_id', 'household_name', 'search_index', 'address_json', 'created_at'] 
    },
    { 
      name: 'db_HouseholdMembers', 
      headers: ['member_id', 'household_id', 'first_name', 'last_name', 'email', 'phone', 'member_order', 'created_at'] 
    },
    {
      name: 'db_Donations',
      headers: ['txn_id', 'household_id', 'project_id', 'date', 'amount_cents', 'method', 'comments', 'meta_json', 'entry_date', 'deposit_date']
    },
    { 
      name: 'db_Projects', 
      headers: ['project_id', 'name', 'description'] 
    }
  ];

  sheets.forEach(config => {
    let sheet = ss.getSheetByName(config.name);
    if (!sheet) {
      sheet = ss.insertSheet(config.name);
    }
    
    // Reset permissions/content
    sheet.clear();
    
    // Append headers
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(config.headers);
    }
    
    // IMPORTANT: You cannot freeze all rows. We need at least 2 rows to freeze 1.
    if (sheet.getMaxRows() < 2) {
      sheet.insertRowAfter(1);
    }
    
    sheet.setFrozenRows(1);
    
    // Optional: Delete extra rows to keep it clean (leave 10 buffer rows)
    const max = sheet.getMaxRows();
    if (max > 20) {
      sheet.deleteRows(11, max - 10);
    }
  });

  // Remove default 'Sheet1' if it exists
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
  
  return "Database Setup Complete. Linked to: " + ss.getUrl();
}

/**
 * getInitialData - Fetches all necessary data for the frontend.
 * Returns households with nested members array.
 */
function getInitialData() {
  try {
    const ss = getDatasource();
    if (!ss) throw new Error("Database not connected. Please run setupDatabase() first.");

    const householdsSheet = ss.getSheetByName('db_Households');
    const membersSheet = ss.getSheetByName('db_HouseholdMembers');
    const projectsSheet = ss.getSheetByName('db_Projects');
    
    // Helper to get data or empty array
    const getData = (sheet) => {
      if (!sheet || sheet.getLastRow() < 2) return [];
      return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    };

    const householdRows = getData(householdsSheet);
    const memberRows = getData(membersSheet);
    const projectRows = getData(projectsSheet);
    const donationRows = getData(ss.getSheetByName('db_Donations'));

    // Process Households
    const households = householdRows.map(row => {
      // household_id (0), household_name (1), search_index (2), address_json (3), created_at (4)
      let address = {};
      try {
        address = row[3] ? JSON.parse(row[3]) : {};
      } catch (e) {
        console.error('Error parsing address JSON', e);
      }
      
      return {
        household_id: String(row[0]),
        household_name: String(row[1]),
        search_index: String(row[2]),
        address: address, // Object
        members: [] 
      };
    });

    // Process Members and add to their households
    memberRows.forEach(row => {
      // member_id (0), household_id (1), first_name (2), last_name (3), email (4), phone (5), member_order (6), created_at (7)
      const member = {
        member_id: String(row[0]),
        household_id: String(row[1]),
        first_name: String(row[2]),
        last_name: String(row[3]),
        email: String(row[4]),
        phone: String(row[5]),
        member_order: Number(row[6])
      };
      
      // Find parent household and add member
      const household = households.find(h => h.household_id === member.household_id);
      if (household) {
        household.members.push(member);
      }
    });

    // Sort members by member_order within each household
    households.forEach(h => {
      h.members.sort((a, b) => a.member_order - b.member_order);
    });

    // Process Projects
    const projects = projectRows.map(row => ({
      project_id: String(row[0]),
      name: String(row[1]),
      description: String(row[2])
    }));

    // Process Donations
    // Helper to safe-convert dates
    const toIso = (val) => {
        if (val instanceof Date) return val.toISOString();
        if (val && !isNaN(Date.parse(val))) return new Date(val).toISOString();
        return '';
    };

    const donations = (donationRows || []).map(row => ({
      txn_id: String(row[0]),
      household_id: String(row[1]),
      project_id: String(row[2]),
      date: toIso(row[3]), // Donation Date
      amount_cents: Number(row[4]),
      method: String(row[5]),
      comments: String(row[6] || ''),
      entry_date: toIso(row[8]),    // When donation was logged (auto-set)
      deposit_date: toIso(row[9])   // When deposit was made (internal use)
    }));

    return {
        status: 'success',
        data: { households, projects, donations }
    };
  } catch (e) {
      return { status: 'error', message: e.toString() + "\n" + e.stack };
  }
}

/**
 * getHouseholdDisplayName - Generate formatted name for receipts and display.
 * Rules:
 * - Same last name: "John and Jane Smith"
 * - Different last names: "John Smith and Jane Doe"
 * - Single member: "John Smith"
 */
function getHouseholdDisplayName(members) {
  if (!members || members.length === 0) return "Unknown";
  
  if (members.length === 1) {
    return `${members[0].first_name} ${members[0].last_name}`;
  }
  
  // Check if all members share the same last name
  const lastNames = members.map(m => m.last_name);
  const allSameLastName = lastNames.every(ln => ln === lastNames[0]);
  
  if (allSameLastName) {
    // "John and Jane Smith"
    const firstNames = members.map(m => m.first_name).join(' and ');
    return `${firstNames} ${lastNames[0]}`;
  } else {
    // "John Smith & Jane Doe"
    const fullNames = members.map(m => `${m.first_name} ${m.last_name}`);
    return fullNames.join(' & ');
  }
}

/**
 * saveHousehold - Creates a new household with members.
 * Payload: { household_name, address: {street, city, state, zip}, members: [{first_name, last_name, email, phone}] }
 */
function saveHousehold(payload) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('Could not obtain lock. Try again.');
  }

  try {
    const householdsSheet = ss.getSheetByName('db_Households');
    const membersSheet = ss.getSheetByName('db_HouseholdMembers');
    
    if (!householdsSheet || !membersSheet) {
      throw new Error('Required sheets not found. Run setupDatabase() first.');
    }

    const household_id = Utilities.getUuid();
    
    // Build search_index from all member names
    const memberNames = payload.members.map(m => `${m.last_name}, ${m.first_name}`).join(' | ');
    const search_index = `${payload.household_name} | ${memberNames}`;
    
    // Save address as JSON
    const address_json = JSON.stringify(payload.address || {});
    
    // Append household row
    householdsSheet.appendRow([
      household_id,
      payload.household_name,
      search_index,
      address_json,
      new Date().toISOString()
    ]);
    
    // Append member rows
    payload.members.forEach((member, index) => {
      const member_id = Utilities.getUuid();
      membersSheet.appendRow([
        member_id,
        household_id,
        member.first_name,
        member.last_name,
        member.email || '',
        member.phone || '',
        index + 1, // member_order
        new Date().toISOString()
      ]);
    });
    
    return { 
      success: true, 
      household_id: household_id, 
      household_name: payload.household_name 
    };

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * deleteHousehold - Deletes a household and its members IF no donations exist.
 */
function deleteHousehold(household_id) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('Could not obtain lock. Try again.');
  }

  try {
    const householdsSheet = ss.getSheetByName('db_Households');
    const membersSheet = ss.getSheetByName('db_HouseholdMembers');
    const donationsSheet = ss.getSheetByName('db_Donations');
    
    // Check for donations first
    if (donationsSheet) {
      const donationData = donationsSheet.getDataRange().getValues();
      // Skip header, check household_id (col 1)
      for (let i = 1; i < donationData.length; i++) {
        if (donationData[i][1] === household_id) {
           throw new Error("Cannot delete household with existing donations. Please delete donations first.");
        }
      }
    }

    // Delete members (reverse order to safely remove rows)
    if (membersSheet) {
      const memberData = membersSheet.getDataRange().getValues();
      for (let i = memberData.length - 1; i >= 1; i--) { // Skip header
        if (memberData[i][1] === household_id) {
          membersSheet.deleteRow(i + 1);
        }
      }
    }
    
    // Delete household
    if (householdsSheet) {
       const householdData = householdsSheet.getDataRange().getValues();
       for (let i = householdData.length - 1; i >= 1; i--) { // Skip header
         if (householdData[i][0] === household_id) {
           householdsSheet.deleteRow(i + 1);
           return { success: true };
         }
       }
    }
    
    throw new Error("Household not found.");

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * updateHousehold - Updates household details and syncs members.
 * Payload: { household_id, household_name, address: {...}, members: [...] }
 */
function updateHousehold(payload) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('Could not obtain lock. Try again.');
  }

  try {
    const householdsSheet = ss.getSheetByName('db_Households');
    const membersSheet = ss.getSheetByName('db_HouseholdMembers');
    
    // 1. Update Household Info
    const householdData = householdsSheet.getDataRange().getValues();
    let householdRowIndex = -1;
    for (let i = 1; i < householdData.length; i++) {
      if (householdData[i][0] === payload.household_id) {
        householdRowIndex = i + 1;
        break;
      }
    }
    if (householdRowIndex === -1) throw new Error("Household not found.");

    // Build new search_index
    const memberNames = payload.members.map(m => `${m.last_name}, ${m.first_name}`).join(' | ');
    const search_index = `${payload.household_name} | ${memberNames}`;
    const address_json = JSON.stringify(payload.address || {});
    
    // Update Row: household_id(0), household_name(1), search_index(2), address_json(3)
    // We update cols 2, 3, 4 (1-based indices) -> data array range is cols 2,3,4
    householdsSheet.getRange(householdRowIndex, 2).setValue(payload.household_name);
    householdsSheet.getRange(householdRowIndex, 3).setValue(search_index);
    householdsSheet.getRange(householdRowIndex, 4).setValue(address_json);

    // 2. Sync Members
    const memberData = membersSheet.getDataRange().getValues();
    
    // Identify Rows belonging to this household
    const memberRows = [];
    for (let i = 1; i < memberData.length; i++) {
        if (memberData[i][1] === payload.household_id) {
            memberRows.push({ rowIndex: i + 1, data: memberData[i] });
        }
    }

    // A. Update Existing Members & Identify New/Deleted
    const payloadMemberIds = new Set(payload.members.filter(m => m.member_id).map(m => m.member_id));
    
    // Delete members in DB not in Payload
    // Reverse order deletion
    for (let i = memberRows.length - 1; i >= 0; i--) {
        const dbMemberId = memberRows[i].data[0];
        if (!payloadMemberIds.has(dbMemberId)) {
            membersSheet.deleteRow(memberRows[i].rowIndex);
        }
    }

    // Update or Insert from Payload
    payload.members.forEach((m, index) => {
        if (m.member_id) {
            // Update
            // Find current row index (cannot use cached index if deletions occurred above? 
            // Actually deletions above definitely shift rows below them.
            // Safer to scan again or Use a safer unique ID lookup per row update?
            // To be robust: Scan for the ID again.
            // Performance optimization: For small household (5 members), scanning is fast.
            updateMemberRow(membersSheet, m, index); 
        } else {
            // Insert
            const new_id = Utilities.getUuid();
            membersSheet.appendRow([
                new_id,
                payload.household_id,
                m.first_name,
                m.last_name,
                m.email || '',
                m.phone || '',
                index + 1, // member_order
                new Date().toISOString()
            ]);
        }
    });

    return { success: true, household_id: payload.household_id };

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}

// Helper to update a member row
function updateMemberRow(sheet, member, order) {
    const data = sheet.getDataRange().getValues();
    for(let i=1; i<data.length; i++) {
        if(data[i][0] === member.member_id) {
            // Found it. Update name, email, phone, order (cols 3,4,5,6,7 -> array indices 2,3,4,5,6)
            // Sheet Columns: 1:id, 2:hh_id, 3:first, 4:last, 5:email, 6:phone, 7:order
            sheet.getRange(i+1, 3).setValue(member.first_name);
            sheet.getRange(i+1, 4).setValue(member.last_name);
            sheet.getRange(i+1, 5).setValue(member.email || '');
            sheet.getRange(i+1, 6).setValue(member.phone || '');
            sheet.getRange(i+1, 7).setValue(order + 1);
            return;
        }
    }
}

/**
 * saveDonation - Appends a new donation record.
 * Now uses household_id instead of donor_id.
 */
function saveDonation(payload) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected. Please run setupDatabase() first.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 10s timeout
  } catch (e) {
    throw new Error('Could not obtain lock. Try again later.');
  }

  try {
    const sheet = ss.getSheetByName('db_Donations');
    if (!sheet) throw new Error('db_Donations sheet not found');

    const txn_id = Utilities.getUuid();
    
    const meta_json = JSON.stringify({
      timestamp: new Date().toISOString(),
      userAgent: 'WebClient'
    });

    // Entry date is always set to current date/time when donation is created
    const entry_date = new Date().toISOString();

    // Deposit date is optional - can be set later for internal tracking
    const deposit_date = payload.deposit_date || '';

    // Append row: txn_id | household_id | project_id | date | amount_cents | method | comments | meta_json | entry_date | deposit_date
    sheet.appendRow([
      txn_id,
      payload.household_id,
      payload.project_id,
      payload.date,
      payload.amount_cents,
      payload.method,
      payload.comments || '',
      meta_json,
      entry_date,
      deposit_date
    ]);

    return { success: true, txn_id: txn_id, entry_date: entry_date };

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * getAppLogo - Fetches the specific logo file from Drive and returns base64.
 * File ID: 1TFdBOctEpHFP-F3yAv6ElDb5AEJb-979
 */


/**
 * updateDonation - Updates an existing donation.
 */
function updateDonation(payload) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('Could not obtain lock. Try again.');
  }

  try {
    const sheet = ss.getSheetByName('db_Donations');
    const data = sheet.getDataRange().getValues();
    
    // Find row by txn_id (index 0)
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === payload.txn_id) {
        rowIndex = i + 1; // Convert to 1-based Row Index
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error('Donation not found.');
    }

    // Update Row (entry_date in column 9 is NOT updated - it's immutable)
    sheet.getRange(rowIndex, 2).setValue(payload.household_id);
    sheet.getRange(rowIndex, 3).setValue(payload.project_id);
    sheet.getRange(rowIndex, 4).setValue(payload.date);
    sheet.getRange(rowIndex, 5).setValue(payload.amount_cents);
    sheet.getRange(rowIndex, 6).setValue(payload.method);
    sheet.getRange(rowIndex, 7).setValue(payload.comments || '');
    // Column 9 (entry_date) is immutable - not updated
    // Column 10 (deposit_date) can be set/updated for internal tracking
    if (payload.deposit_date !== undefined) {
      sheet.getRange(rowIndex, 10).setValue(payload.deposit_date || '');
    }

    return { success: true };

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * deleteDonation - Deletes a donation by ID.
 */
function deleteDonation(txn_id) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('Could not obtain lock. Try again.');
  }

  try {
    const sheet = ss.getSheetByName('db_Donations');
    const data = sheet.getDataRange().getValues();
    
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === txn_id) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error('Donation not found.');
    }

    sheet.deleteRow(rowIndex);
    return { success: true };

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}

// --- PROJECT MANAGEMENT ---

/**
 * saveProject - Creates a new project
 */
function saveProject(payload) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    throw new Error('Could not obtain lock.');
  }

  try {
    const sheet = ss.getSheetByName('db_Projects');
    const project_id = Utilities.getUuid();
    
    // Check if name is provided
    if (!payload.name) throw new Error("Project name is required.");

    sheet.appendRow([
      project_id,
      payload.name,
      payload.description || ''
    ]);

    return { success: true, project_id: project_id, name: payload.name };

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * updateProject - Updates an existing project
 */
function updateProject(payload) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    throw new Error('Could not obtain lock.');
  }

  try {
    const sheet = ss.getSheetByName('db_Projects');
    const data = sheet.getDataRange().getValues();
    
    // Find row by project_id
    for (let i = 1; i < data.length; i++) {
       if (data[i][0] === payload.project_id) {
         // Update cols 2, 3 (Name, Description)
         sheet.getRange(i + 1, 2).setValue(payload.name);
         sheet.getRange(i + 1, 3).setValue(payload.description || '');
         return { success: true };
       }
    }
    
    throw new Error("Project not found.");

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * deleteProject - Deletes a project IF no donations exist.
 */
function deleteProject(project_id) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    throw new Error('Could not obtain lock.');
  }

  try {
    const projectsSheet = ss.getSheetByName('db_Projects');
    const donationsSheet = ss.getSheetByName('db_Donations');
    
    // 1. Check for donations
    if (donationsSheet) {
      const data = donationsSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][2] === project_id) { // Col 3 is project_id
           throw new Error("Cannot delete project with existing donations.");
        }
      }
    }

    // 2. Delete Project
    if (projectsSheet) {
      const data = projectsSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === project_id) {
           projectsSheet.deleteRow(i + 1);
           return { success: true };
        }
      }
    }
    
    throw new Error("Project not found.");

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * importDataInternal - Bulk import function.
 * Expects { households: [], projects: [], donations: [] }
 * Clears existing data (keeping headers) before import.
 */
function importDataInternal(payload) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); 
  } catch (e) {
    throw new Error('Lock timeout');
  }

  try {
    const householdsSheet = ss.getSheetByName('db_Households');
    const membersSheet = ss.getSheetByName('db_HouseholdMembers');
    const donationsSheet = ss.getSheetByName('db_Donations');
    const projectsSheet = ss.getSheetByName('db_Projects');

    // CLEAR DATA (Keep headers)
    [householdsSheet, membersSheet, donationsSheet, projectsSheet].forEach(sheet => {
        if (sheet && sheet.getLastRow() > 1) {
            sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
        }
    });

    // 1. PROJECTS
    if (payload.projects && payload.projects.length > 0) {
        const rows = payload.projects.map(p => [p.project_id, p.name, p.description]);
        if (rows.length > 0) {
            projectsSheet.getRange(2, 1, rows.length, 3).setValues(rows);
        }
    }

    // 2. HOUSEHOLDS
    if (payload.households && payload.households.length > 0) {
        // 'household_id', 'household_name', 'search_index', 'address_json', 'created_at'
        const rows = payload.households.map(h => [
            h.household_id,
            h.household_name,
            h.search_index,
            JSON.stringify(h.address),
            new Date().toISOString()
        ]);
        householdsSheet.getRange(2, 1, rows.length, 5).setValues(rows);
        
        // 3. MEMBERS
        const memberRows = [];
        payload.households.forEach(h => {
            h.members.forEach(m => {
                // 'member_id', 'household_id', 'first_name', 'last_name', 'email', 'phone', 'member_order', 'created_at'
                memberRows.push([
                    m.member_id,
                    h.household_id,
                    m.first_name,
                    m.last_name,
                    m.email,
                    m.phone,
                    m.member_order,
                    new Date().toISOString()
                ]);
            });
        });
        if (memberRows.length > 0) {
            membersSheet.getRange(2, 1, memberRows.length, 8).setValues(memberRows);
        }
    }

    // Process Donations - now with comments
    const donationRows = [];
    if (payload.donations && payload.donations.length > 0) {
        payload.donations.forEach(d => {
            // 'txn_id', 'household_id', 'project_id', 'date', 'amount_cents', 'method', 'comments', 'meta_json'
            donationRows.push([
                d.txn_id,
                d.household_id,
                d.project_id,
                d.date,
                d.amount_cents,
                d.method,
                d.comments || '',
                JSON.stringify(d.meta || {})
            ]);
        });
        donationsSheet.getRange(2, 1, donationRows.length, 8).setValues(donationRows);
    }

    console.log("Import Complete: " + payload.donations.length + " donations imported.");
    return "Success";

  } catch (e) {
    console.error(e);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/**
 * archiveEmail - Saves a copy of sent email using a Google Doc template.
 * Copies the template and replaces placeholders with actual values.
 */
function archiveEmail(recipient, subject, htmlBody, householdName) {
  // Check if archiving is enabled
  if (!ARCHIVE_ENABLED) {
    console.info('Email archiving temporarily disabled (ARCHIVE_ENABLED = false)');
    return;
  }

  if (!ARCHIVE_TEMPLATE_ID || ARCHIVE_TEMPLATE_ID === 'PASTE_TEMPLATE_DOC_ID_HERE') {
    console.warn('Email archiving skipped: ARCHIVE_TEMPLATE_ID not configured');
    return;
  }

  const folder = DriveApp.getFolderById(EMAIL_ARCHIVE_FOLDER_ID);
  const timestamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  const timeStr = Utilities.formatDate(new Date(), 'America/New_York', 'h:mm a');
  const safeHousehold = (householdName || 'Unknown').replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 50);
  const docName = `${timestamp} - ${safeHousehold} - Thank You`;

  // Copy template to archive folder
  const templateFile = DriveApp.getFileById(ARCHIVE_TEMPLATE_ID);
  const newFile = templateFile.makeCopy(docName, folder);

  // Open the copy and replace placeholders
  const doc = DocumentApp.openById(newFile.getId());
  const body = doc.getBody();

  // Convert HTML to plain text for the body
  const plainBody = htmlBody
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

  // Replace placeholders
  body.replaceText('\\{\\{TO\\}\\}', recipient);
  body.replaceText('\\{\\{SUBJECT\\}\\}', subject);
  body.replaceText('\\{\\{DATE\\}\\}', timestamp + ' at ' + timeStr);
  body.replaceText('\\{\\{EMAIL_BODY\\}\\}', plainBody);

  doc.saveAndClose();
}

/**
 * DEBUG: Test the email archive function
 * Run this from the Apps Script editor to test archive creation
 */
function debug_testEmailArchive() {
  console.log("Testing email archive functionality...");

  try {
    // Test 1: Check constants
    console.log("EMAIL_ARCHIVE_FOLDER_ID: " + EMAIL_ARCHIVE_FOLDER_ID);
    console.log("ARCHIVE_TEMPLATE_ID: " + ARCHIVE_TEMPLATE_ID);

    // Test 2: Check folder access
    const folder = DriveApp.getFolderById(EMAIL_ARCHIVE_FOLDER_ID);
    console.log("✓ Archive folder found: " + folder.getName());

    // Test 3: Check template access
    const template = DriveApp.getFileById(ARCHIVE_TEMPLATE_ID);
    console.log("✓ Template found: " + template.getName());

    // Test 4: Try to create a test archive
    console.log("\nCreating test archive...");
    archiveEmail(
      "test@example.com",
      "Test Subject",
      "<p>This is a test email body.</p>",
      "Test Household"
    );

    console.log("✅ Test archive created successfully!");
    console.log("Check your archive folder for: " + new Date().toISOString().split('T')[0] + " - Test Household - Thank You");

  } catch (e) {
    console.error("❌ Archive test failed:");
    console.error(e.toString());
    console.error("Stack: " + e.stack);
  }
}

/**
 * sendThankYouEmail - Sends a thank you email to donors.
 * Payload: { recipients: [email], subject: string, body: string, householdName: string }
 */
function sendThankYouEmail(payload) {
  if (!payload.recipients || payload.recipients.length === 0) {
    throw new Error("No recipients provided.");
  }

  if (!payload.subject || !payload.body) {
    throw new Error("Subject and body are required.");
  }

  try {
    // Join multiple recipients with comma
    const recipientList = payload.recipients.join(',');

    // Get email template and replace placeholder with actual content
    const templateHtml = getEmailTemplateHtml();
    const htmlBody = templateHtml.replace('{{EMAIL_BODY}}', payload.body.replace(/\n/g, '<br>'));

    // Send email using MailApp
    MailApp.sendEmail(
      recipientList,
      payload.subject,
      payload.body,  // Plain text fallback
      {
        name: 'Southwest Corridor Park Conservancy',
        htmlBody: htmlBody  // HTML from template
      }
    );

    // Archive email to Drive (non-blocking - don't fail if archive fails)
    let archiveStatus = 'success';
    let archiveMessage = '';
    try {
      archiveEmail(recipientList, payload.subject, htmlBody, payload.householdName);
      archiveMessage = 'Email archived to Google Drive.';
    } catch (archiveError) {
      archiveStatus = 'failed';
      archiveMessage = 'Email sent but archiving failed: ' + archiveError.toString();
      console.warn('Email archiving failed:', archiveError);
    }

    return {
      success: true,
      message: 'Email sent successfully!',
      archiveStatus: archiveStatus,
      archiveMessage: archiveMessage
    };

  } catch (e) {
    console.error('Error sending thank you email:', e);
    throw new Error('Failed to send email: ' + e.toString());
  }
}


/**
 * Run this function from the editor to trigger the authorization prompt.
 * It accesses all services to ensure ALL OAuth scopes are granted.
 * This is especially important after adding new scopes to appsscript.json.
 */
function debug_triggerAuth() {
  console.log("Triggering authorization for all OAuth scopes...");
  console.log("This will prompt you to authorize if you haven't already.");

  try {
    // Just accessing these services triggers OAuth - we don't need to do complex operations
    MailApp.getRemainingDailyQuota();
    GmailApp.getAliases();
    DriveApp.getStorageLimit();

    console.log("✅ Authorization complete!");
    console.log("All OAuth scopes have been approved.");
    console.log("");
    console.log("IMPORTANT: The web app still needs to be updated.");
    console.log("In the browser, go to: Deploy > Manage deployments");
    console.log("Click the edit icon (pencil) next to @HEAD");
    console.log("Just click 'Deploy' - don't change anything");
    console.log("This will update the web app to use the new scopes.");

  } catch (e) {
    console.error("Authorization error: " + e.toString());
    console.log("Please try running this function again.");
  }
}

/**
 * OAuth Preflight Check
 * Run this BEFORE creating production deployments to verify all OAuth scopes work.
 * Returns a detailed status report of each scope.
 *
 * Usage: Run from Apps Script editor before deployment
 * Purpose: Catch OAuth issues before they affect production web app
 */
function oauth_preflight_check() {
  console.log("🔍 OAuth Preflight Check");
  console.log("=".repeat(50));

  const results = {
    scopes: [],
    allPassed: true,
    timestamp: new Date().toISOString()
  };

  // Test 1: MailApp (script.send_mail)
  console.log("\n1. Testing MailApp (script.send_mail)...");
  try {
    const quota = MailApp.getRemainingDailyQuota();
    results.scopes.push({
      name: 'script.send_mail',
      status: 'OK',
      details: 'Daily email quota: ' + quota
    });
    console.log("   ✅ OK - Daily quota: " + quota);
  } catch(e) {
    results.scopes.push({
      name: 'script.send_mail',
      status: 'FAIL',
      error: e.toString()
    });
    results.allPassed = false;
    console.error("   ❌ FAIL - " + e.toString());
  }

  // Test 2: GmailApp (gmail.readonly)
  console.log("\n2. Testing GmailApp (gmail.readonly)...");
  try {
    const drafts = GmailApp.getDrafts();
    results.scopes.push({
      name: 'gmail.readonly',
      status: 'OK',
      details: 'Draft count: ' + drafts.length
    });
    console.log("   ✅ OK - Drafts accessible: " + drafts.length);
  } catch(e) {
    results.scopes.push({
      name: 'gmail.readonly',
      status: 'FAIL',
      error: e.toString()
    });
    results.allPassed = false;
    console.error("   ❌ FAIL - " + e.toString());
  }

  // Test 3: DriveApp (drive) - SKIPPED due to API instability
  console.log("\n3. Testing DriveApp (drive)...");
  results.scopes.push({
    name: 'drive',
    status: 'SKIPPED',
    details: 'Google Drive API experiencing intermittent server errors'
  });
  console.log("   ⏭️  SKIPPED - Google API unstable");

  // Test 4: DocumentApp (documents) - SKIPPED due to API instability
  console.log("\n4. Testing DocumentApp (documents)...");
  results.scopes.push({
    name: 'documents',
    status: 'SKIPPED',
    details: 'Google Docs API experiencing intermittent server errors'
  });
  console.log("   ⏭️  SKIPPED - Google API unstable");

  // Test 5: SpreadsheetApp (spreadsheets)
  console.log("\n5. Testing SpreadsheetApp (spreadsheets)...");
  try {
    const ss = getDatasource();
    const name = ss ? ss.getName() : 'Not connected';
    results.scopes.push({
      name: 'spreadsheets',
      status: 'OK',
      details: 'Connected to: ' + name
    });
    console.log("   ✅ OK - Connected to: " + name);
  } catch(e) {
    results.scopes.push({
      name: 'spreadsheets',
      status: 'FAIL',
      error: e.toString()
    });
    results.allPassed = false;
    console.error("   ❌ FAIL - " + e.toString());
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  if (results.allPassed) {
    console.log("✅ PREFLIGHT CHECK PASSED");
    console.log("All critical OAuth scopes are authorized.");
    console.log("Safe to create production deployment.");
  } else {
    console.error("❌ PREFLIGHT CHECK FAILED");
    console.error("Some OAuth scopes are not authorized.");
    console.error("Fix authorization issues before deployment.");
  }
  console.log("=".repeat(50));

  // Return structured results for programmatic use
  return results;
}

/**
 * DEV SETUP: Creates a dev database by copying production and linking it.
 *
 * This function does the following:
 * 1. Copies the production spreadsheet to a new "DEV" copy
 * 2. Links this Apps Script project to the copy
 * 3. Adds any new columns (entry_date, deposit_date) if missing
 *
 * Usage:
 * 1. Get the production spreadsheet ID from the production project
 *    (Run dev_getProductionSheetId() on the PRODUCTION project)
 * 2. Paste the ID in PROD_SHEET_ID below
 * 3. Run this function from the Apps Script editor
 */
function dev_setupDevDatabase() {
  // ========================================
  // PASTE YOUR PRODUCTION SPREADSHEET ID HERE:
  const PROD_SHEET_ID = 'PASTE_PRODUCTION_SHEET_ID_HERE';
  // ========================================

  if (PROD_SHEET_ID === 'PASTE_PRODUCTION_SHEET_ID_HERE') {
    console.error('❌ ERROR: Please edit dev_setupDevDatabase() and paste your production spreadsheet ID');
    console.log('');
    console.log('To get the production spreadsheet ID:');
    console.log('1. Open the PRODUCTION Apps Script project');
    console.log('2. Run the function: dev_getProductionSheetId()');
    console.log('3. Copy the ID from the log');
    console.log('4. Paste it in the PROD_SHEET_ID variable above');
    return;
  }

  try {
    // Step 1: Open the production spreadsheet
    console.log('📂 Opening production spreadsheet...');
    const prodSS = SpreadsheetApp.openById(PROD_SHEET_ID);
    console.log('   Found: ' + prodSS.getName());

    // Step 2: Create a copy for dev
    console.log('📋 Creating DEV copy...');
    const devSS = prodSS.copy(prodSS.getName() + ' - DEV COPY');
    const devSheetId = devSS.getId();
    console.log('   Created: ' + devSS.getName());
    console.log('   URL: ' + devSS.getUrl());

    // Step 3: Link this project to the dev copy
    console.log('🔗 Linking to this Apps Script project...');
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', devSheetId);
    console.log('   Linked successfully!');

    // Step 4: Add new columns if they don't exist
    console.log('📊 Checking for new columns...');
    dev_addNewColumnsIfMissing(devSS);

    console.log('');
    console.log('✅ DEV DATABASE SETUP COMPLETE!');
    console.log('');
    console.log('Dev Spreadsheet URL: ' + devSS.getUrl());
    console.log('');
    console.log('You can now test the dev deployment.');

  } catch (e) {
    console.error('❌ ERROR: ' + e.toString());
    console.log('');
    console.log('Common issues:');
    console.log('- Invalid spreadsheet ID');
    console.log('- No permission to access the production spreadsheet');
    console.log('- Make sure you\'re signed into the correct Google account');
  }
}

/**
 * Helper function to add new columns (entry_date, deposit_date) if missing
 */
function dev_addNewColumnsIfMissing(ss) {
  const donationsSheet = ss.getSheetByName('db_Donations');
  if (!donationsSheet) {
    console.log('   ⚠️ db_Donations sheet not found - will be created on first use');
    return;
  }

  const headers = donationsSheet.getRange(1, 1, 1, donationsSheet.getLastColumn()).getValues()[0];
  const expectedHeaders = ['txn_id', 'household_id', 'project_id', 'date', 'amount_cents', 'method', 'comments', 'meta_json', 'entry_date', 'deposit_date'];

  // Check if entry_date and deposit_date columns exist
  const hasEntryDate = headers.includes('entry_date');
  const hasDepositDate = headers.includes('deposit_date');

  if (!hasEntryDate) {
    const col = headers.length + 1;
    donationsSheet.getRange(1, col).setValue('entry_date');
    console.log('   Added column: entry_date (column ' + col + ')');
  } else {
    console.log('   ✓ entry_date column exists');
  }

  if (!hasDepositDate) {
    const newHeaders = donationsSheet.getRange(1, 1, 1, donationsSheet.getLastColumn()).getValues()[0];
    const col = newHeaders.length + 1;
    donationsSheet.getRange(1, col).setValue('deposit_date');
    console.log('   Added column: deposit_date (column ' + col + ')');
  } else {
    console.log('   ✓ deposit_date column exists');
  }
}

/**
 * DEV HELPER: Run this to add new columns to the dev database
 * (Wrapper for dev_addNewColumnsIfMissing that can be run from the editor)
 */
function dev_addColumnsToDevDb() {
  const ss = getDatasource();
  if (!ss) {
    console.error('❌ No database connected. Run dev_setupDevDatabase first or set SHEET_ID in Script Properties.');
    return;
  }
  console.log('📊 Adding new columns to: ' + ss.getName());
  dev_addNewColumnsIfMissing(ss);
  console.log('✅ Done!');
}

/**
 * DEV HELPER: Get the current spreadsheet ID (run this on PRODUCTION project)
 *
 * Run this function on the PRODUCTION Apps Script project to get the
 * spreadsheet ID needed for dev_setupDevDatabase().
 */
function dev_getProductionSheetId() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('SHEET_ID');

  if (sheetId) {
    console.log('='.repeat(60));
    console.log('PRODUCTION SPREADSHEET ID:');
    console.log('');
    console.log(sheetId);
    console.log('');
    console.log('Copy this ID and paste it into dev_setupDevDatabase()');
    console.log('in the DEV Apps Script project.');
    console.log('='.repeat(60));
  } else {
    console.log('No SHEET_ID found in Script Properties.');
    console.log('This project may be using a bound spreadsheet.');

    try {
      const active = SpreadsheetApp.getActiveSpreadsheet();
      if (active) {
        console.log('');
        console.log('Active spreadsheet ID: ' + active.getId());
      }
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * DEV HELPER: Link to an existing spreadsheet (manual method)
 * Use if you already have a dev spreadsheet copy
 */
function dev_linkToSpreadsheet() {
  // PASTE YOUR SPREADSHEET ID HERE:
  const SHEET_ID = 'PASTE_SPREADSHEET_ID_HERE';

  if (SHEET_ID === 'PASTE_SPREADSHEET_ID_HERE') {
    console.error('ERROR: Please edit this function and paste your spreadsheet ID');
    return;
  }

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', SHEET_ID);
    console.log('SUCCESS! Linked to spreadsheet: ' + ss.getName());
    console.log('URL: ' + ss.getUrl());
  } catch (e) {
    console.error('ERROR: Could not open spreadsheet. Check the ID and permissions.');
    console.error(e.toString());
  }
}
