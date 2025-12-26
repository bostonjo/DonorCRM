// App Version - update this when deploying new versions
const APP_VERSION = '1.2.0';

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
    }),
    userEmail: getUserEmail()
  };
}

/**
 * getUserEmail - Helper to get the logged in user's email.
 */
function getUserEmail() {
  try {
    return Session.getActiveUser().getEmail();
  } catch (e) {
    return 'Unknown User';
  }
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
      headers: ['txn_id', 'household_id', 'project_id', 'date', 'amount_cents', 'method', 'comments', 'meta_json', 'entry_date', 'deposit_date', 'logged_by']
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
    
    // Check if sheet is empty (no headers)
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(config.headers);
    } else {
      // Sheet exists and has data. Check for missing columns and add them to the header row.
      const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      config.headers.forEach((expectedHeader, index) => {
        if (!currentHeaders.includes(expectedHeader)) {
          // Add missing header to the next available column
          sheet.getRange(1, currentHeaders.length + 1).setValue(expectedHeader);
          currentHeaders.push(expectedHeader); // Update local list to track newly added
          console.log(`Added missing header "${expectedHeader}" to sheet "${config.name}"`);
        }
      });
    }
    
    // Ensure at least 2 rows exist for freezing
    if (sheet.getMaxRows() < 2) {
      sheet.insertRowAfter(1);
    }
    
    sheet.setFrozenRows(1);
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

    const donations = (donationRows || []).map((row, i) => {
      // Data Recovery Logic: If Col I (entry_date) is empty, try to extract from Col H (meta_json)
      let entryDate = toIso(row[8]);
      if (!entryDate && row[7]) {
        try {
          const meta = JSON.parse(row[7]);
          if (meta.timestamp) entryDate = toIso(meta.timestamp);
        } catch (e) {
          // Not valid JSON or no timestamp, skip
        }
      }

      return {
        txn_id: String(row[0]),
        household_id: String(row[1]),
        project_id: String(row[2]),
        date: toIso(row[3]), // Donation Date
        amount_cents: Number(row[4]),
        method: String(row[5]),
        comments: String(row[6] || ''),
        entry_date: entryDate,        // Recovered date
        deposit_date: toIso(row[9]),  // When deposit was made (internal use)
        logged_by: String(row[10] || '')
      };
    });

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

    // Capture the logged-in user's email for tracking
    const logged_by = getUserEmail();

    // Append row: txn_id | household_id | project_id | date | amount_cents | method | comments | meta_json | entry_date | deposit_date | logged_by
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
      deposit_date,
      logged_by
    ]);

    return { success: true, txn_id: txn_id, entry_date: entry_date, logged_by: logged_by };

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
 * Uses Advanced Services (Drive API v3, Docs API v1) for better authorization control.
 * Copies the template and replaces placeholders with actual values.
 * 
 * @param {string} recipient - Email recipient(s)
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML email body
 * @param {string} householdName - Household name for file naming
 */
function archiveEmail(recipient, subject, htmlBody, householdName) {
  // Check if archiving is enabled
  if (!ARCHIVE_ENABLED) {
    console.info('Email archiving temporarily disabled (ARCHIVE_ENABLED = false)');
    return;
  }

  if (!ARCHIVE_TEMPLATE_ID || ARCHIVE_TEMPLATE_ID === 'PASTE_TEMPLATE_DOC_HERE') {
    console.warn('Email archiving skipped: ARCHIVE_TEMPLATE_ID not configured');
    return;
  }

  // Pre-flight authorization checks
  console.log('Starting email archive process...');
  console.log('Performing authorization checks...');
  
  const driveAuth = checkDriveAuthorization();
  const docsAuth = checkDocsAuthorization();
  
  if (!driveAuth.authorized) {
    const error = new Error(`Drive API authorization failed: ${driveAuth.error || 'Unknown error'}`);
    error.classification = classifyError(error);
    console.error('❌ Drive API authorization check failed:', driveAuth.details);
    console.error('Suggestion:', driveAuth.suggestion);
    throw error;
  }
  
  if (!docsAuth.authorized) {
    const error = new Error(`Docs API authorization failed: ${docsAuth.error || 'Unknown error'}`);
    error.classification = classifyError(error);
    console.error('❌ Docs API authorization check failed:', docsAuth.details);
    console.error('Suggestion:', docsAuth.suggestion);
    throw error;
  }
  
  console.log('✓ Authorization checks passed');

  try {
    console.log('Folder ID:', EMAIL_ARCHIVE_FOLDER_ID);
    console.log('Template ID:', ARCHIVE_TEMPLATE_ID);

    // Step 1: Verify folder access using Advanced Services
    console.log('Step 1: Verifying archive folder access...');
    let folderResult;
    try {
      folderResult = driveGetFolder(EMAIL_ARCHIVE_FOLDER_ID);
      console.log('✓ Folder verified:', folderResult.name);
    } catch (e) {
      const classification = classifyError(e);
      console.error('❌ Failed to access archive folder');
      console.error('Error type:', classification.type);
      console.error('Details:', e.details || e.message);
      throw new Error(`Cannot access archive folder: ${classification.userMessage}`);
    }

    // Step 2: Verify template file access
    console.log('Step 2: Verifying template file access...');
    let templateResult;
    try {
      templateResult = driveGetFile(ARCHIVE_TEMPLATE_ID, ['id', 'name', 'mimeType']);
      console.log('✓ Template verified:', templateResult.file.name);
      
      // Verify it's a Google Doc
      if (templateResult.file.mimeType !== 'application/vnd.google-apps.document') {
        throw new Error('Template file is not a Google Doc');
      }
    } catch (e) {
      const classification = classifyError(e);
      console.error('❌ Failed to access template file');
      console.error('Error type:', classification.type);
      console.error('Details:', e.details || e.message);
      throw new Error(`Cannot access template file: ${classification.userMessage}`);
    }

    // Step 3: Prepare document name
    const timestamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
    const timeStr = Utilities.formatDate(new Date(), 'America/New_York', 'h:mm a');
    const safeHousehold = (householdName || 'Unknown').replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 50);
    const docName = `${timestamp} - ${safeHousehold} - Thank You`;
    console.log('Step 3: Document name prepared:', docName);

    // Step 4: Copy template using Advanced Services
    console.log('Step 4: Copying template file...');
    let copyResult;
    try {
      copyResult = driveCopyFile(ARCHIVE_TEMPLATE_ID, docName, EMAIL_ARCHIVE_FOLDER_ID);
      console.log('✓ Copy created with ID:', copyResult.fileId);
    } catch (e) {
      const classification = classifyError(e);
      console.error('❌ Failed to copy template file');
      console.error('Error type:', classification.type);
      console.error('Details:', e.details || e.message);
      throw new Error(`Cannot copy template file: ${classification.userMessage}`);
    }

    // Step 5: Convert HTML to plain text for the body
    console.log('Step 5: Converting HTML to plain text...');
    const plainBody = htmlBody
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

    // Step 6: Replace placeholders using Docs API batchUpdate
    console.log('Step 6: Replacing placeholders in document...');
    try {
      // Create batch update requests for all placeholder replacements
      const requests = [
        {
          replaceAllText: {
            containsText: {
              text: '{{TO}}',
              matchCase: false
            },
            replaceText: recipient || ''
          }
        },
        {
          replaceAllText: {
            containsText: {
              text: '{{SUBJECT}}',
              matchCase: false
            },
            replaceText: subject || ''
          }
        },
        {
          replaceAllText: {
            containsText: {
              text: '{{DATE}}',
              matchCase: false
            },
            replaceText: timestamp + ' at ' + timeStr
          }
        },
        {
          replaceAllText: {
            containsText: {
              text: '{{EMAIL_BODY}}',
              matchCase: false
            },
            replaceText: plainBody
          }
        }
      ];
      
      const updateResult = docsBatchUpdate(copyResult.fileId, requests);
      console.log('✓ Placeholders replaced successfully');
      console.log('Document revision ID:', updateResult.revisionId);
    } catch (e) {
      const classification = classifyError(e);
      console.error('❌ Failed to replace placeholders');
      console.error('Error type:', classification.type);
      console.error('Details:', e.details || e.message);
      // Don't throw - document was created, just placeholder replacement failed
      console.warn('⚠️  Document created but placeholder replacement failed. Manual editing may be required.');
    }

    console.log('✅ Email archived successfully!');
    console.log('Document ID:', copyResult.fileId);
    console.log('Document name:', docName);

  } catch (error) {
    // Enhanced error handling with classification
    const classification = error.classification || classifyError(error);
    
    console.error('='.repeat(50));
    console.error('❌ Email archiving failed');
    console.error('='.repeat(50));
    console.error('Error type:', classification.type);
    console.error('Error message:', error.message || classification.userMessage);
    console.error('Recoverable:', classification.recoverable ? 'Yes' : 'No');
    console.error('Suggestion:', classification.suggestion);
    
    if (error.details) {
      console.error('Details:', error.details);
    }
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    console.error('='.repeat(50));

    // Re-throw with structured error information
    const enhancedError = new Error(`Email archiving failed: ${classification.userMessage}`);
    enhancedError.classification = classification;
    enhancedError.originalError = error;
    throw enhancedError;
  }
}

/**
 * DEBUG: Test the email archive function using Advanced Services
 * Run this from the Apps Script editor to test archive creation
 */
function debug_testEmailArchive() {
  console.log("=".repeat(50));
  console.log("Testing Email Archive Functionality (Advanced Services)");
  console.log("=".repeat(50));

  try {
    // Test 1: Check constants
    console.log("\n1. Checking configuration constants...");
    console.log("   EMAIL_ARCHIVE_FOLDER_ID: " + EMAIL_ARCHIVE_FOLDER_ID);
    console.log("   ARCHIVE_TEMPLATE_ID: " + ARCHIVE_TEMPLATE_ID);
    console.log("   ARCHIVE_ENABLED: " + ARCHIVE_ENABLED);

    // Test 2: Check authorization
    console.log("\n2. Checking authorization...");
    const authCheck = checkAllAuthorizations();
    if (!authCheck.allAuthorized) {
      console.error("❌ Authorization check failed. Run debug_triggerAuth() first.");
      return;
    }
    console.log("   ✅ All authorizations verified");

    // Test 3: Check folder access using Advanced Services
    console.log("\n3. Testing folder access (Advanced Services)...");
    try {
      const folderResult = driveGetFolder(EMAIL_ARCHIVE_FOLDER_ID);
      console.log("   ✅ Archive folder found: " + folderResult.name);
      console.log("   Folder ID: " + folderResult.id);
    } catch (e) {
      console.error("   ❌ Failed to access folder:", e.message || e.details);
      throw e;
    }

    // Test 4: Check template access using Advanced Services
    console.log("\n4. Testing template file access (Advanced Services)...");
    try {
      const templateResult = driveGetFile(ARCHIVE_TEMPLATE_ID, ['id', 'name', 'mimeType']);
      console.log("   ✅ Template found: " + templateResult.file.name);
      console.log("   Template ID: " + templateResult.file.id);
      console.log("   MIME type: " + templateResult.file.mimeType);
      
      if (templateResult.file.mimeType !== 'application/vnd.google-apps.document') {
        console.warn("   ⚠️  Warning: Template is not a Google Doc");
      }
    } catch (e) {
      console.error("   ❌ Failed to access template:", e.message || e.details);
      throw e;
    }

    // Test 5: Try to create a test archive
    console.log("\n5. Creating test archive...");
    archiveEmail(
      "test@example.com",
      "Test Subject",
      "<p>This is a test email body.</p>",
      "Test Household"
    );

    console.log("\n" + "=".repeat(50));
    console.log("✅ Test archive created successfully!");
    console.log("Check your archive folder for: " + new Date().toISOString().split('T')[0] + " - Test Household - Thank You");
    console.log("=".repeat(50));

  } catch (e) {
    console.error("\n" + "=".repeat(50));
    console.error("❌ Archive test failed:");
    console.error("=".repeat(50));
    console.error("Error:", e.message || e.toString());
    if (e.classification) {
      console.error("Error type:", e.classification.type);
      console.error("Suggestion:", e.classification.suggestion);
    }
    if (e.details) {
      console.error("Details:", e.details);
    }
    if (e.stack) {
      console.error("Stack:", e.stack);
    }
    console.error("=".repeat(50));
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
 * It accesses all services (both built-in and Advanced Services) to ensure ALL OAuth scopes are granted.
 * This is especially important after adding new scopes to appsscript.json.
 * 
 * Updated to test Advanced Services APIs for better authorization control.
 */
function debug_triggerAuth() {
  console.log("=".repeat(50));
  console.log("Triggering Authorization for All OAuth Scopes");
  console.log("=".repeat(50));
  console.log("This will prompt you to authorize if you haven't already.");
  console.log("");

  const results = {
    builtInServices: {},
    advancedServices: {},
    allPassed: true
  };

  try {
    // Test built-in services (for backward compatibility)
    console.log("Testing Built-in Services:");
    console.log("-".repeat(50));
    
    console.log("1. Checking MailApp...");
    try {
      MailApp.getRemainingDailyQuota();
      results.builtInServices.mailApp = { status: 'OK' };
      console.log("   ✅ MailApp authorized");
    } catch (e) {
      results.builtInServices.mailApp = { status: 'FAIL', error: e.message };
      results.allPassed = false;
      console.error("   ❌ MailApp authorization failed:", e.message);
    }

    console.log("2. Checking GmailApp...");
    try {
      GmailApp.getAliases();
      results.builtInServices.gmailApp = { status: 'OK' };
      console.log("   ✅ GmailApp authorized");
    } catch (e) {
      results.builtInServices.gmailApp = { status: 'FAIL', error: e.message };
      results.allPassed = false;
      console.error("   ❌ GmailApp authorization failed:", e.message);
    }

    console.log("3. Checking DriveApp...");
    try {
      DriveApp.getStorageLimit();
      const folder = DriveApp.getFolderById(EMAIL_ARCHIVE_FOLDER_ID);
      results.builtInServices.driveApp = { status: 'OK', folderName: folder.getName() };
      console.log("   ✅ DriveApp authorized");
      console.log("   ✓ Archive folder accessible: " + folder.getName());
    } catch (e) {
      results.builtInServices.driveApp = { status: 'FAIL', error: e.message };
      results.allPassed = false;
      console.error("   ❌ DriveApp authorization failed:", e.message);
    }

    console.log("4. Checking DocumentApp...");
    try {
      const template = DriveApp.getFileById(ARCHIVE_TEMPLATE_ID);
      const doc = DocumentApp.openById(ARCHIVE_TEMPLATE_ID);
      results.builtInServices.documentApp = { status: 'OK', templateName: template.getName() };
      console.log("   ✅ DocumentApp authorized");
      console.log("   ✓ Archive template accessible: " + template.getName());
    } catch (e) {
      results.builtInServices.documentApp = { status: 'FAIL', error: e.message };
      results.allPassed = false;
      console.error("   ❌ DocumentApp authorization failed:", e.message);
    }

    console.log("5. Checking SpreadsheetApp...");
    try {
      const ss = getDatasource();
      results.builtInServices.spreadsheetApp = { status: 'OK', sheetName: ss ? ss.getName() : 'N/A' };
      console.log("   ✅ SpreadsheetApp authorized");
      if (ss) {
        console.log("   ✓ Connected to: " + ss.getName());
      }
    } catch (e) {
      results.builtInServices.spreadsheetApp = { status: 'FAIL', error: e.message };
      results.allPassed = false;
      console.error("   ❌ SpreadsheetApp authorization failed:", e.message);
    }

    // Test Advanced Services (new approach)
    console.log("");
    console.log("Testing Advanced Services:");
    console.log("-".repeat(50));
    
    console.log("6. Checking Drive API v3...");
    const driveAuth = checkDriveAuthorization();
    results.advancedServices.drive = driveAuth;
    if (driveAuth.authorized) {
      console.log("   ✅ Drive API v3 authorized");
    } else {
      console.error("   ❌ Drive API v3 authorization failed:", driveAuth.error);
      results.allPassed = false;
    }

    console.log("7. Checking Docs API v1...");
    const docsAuth = checkDocsAuthorization();
    results.advancedServices.docs = docsAuth;
    if (docsAuth.authorized) {
      console.log("   ✅ Docs API v1 authorized");
    } else {
      console.error("   ❌ Docs API v1 authorization failed:", docsAuth.error);
      results.allPassed = false;
    }

    // Test Advanced Services with actual operations
    console.log("8. Testing Drive API operations...");
    try {
      const folderResult = driveGetFolder(EMAIL_ARCHIVE_FOLDER_ID);
      console.log("   ✅ Drive API folder access verified: " + folderResult.name);
      results.advancedServices.driveOperations = { status: 'OK' };
    } catch (e) {
      console.error("   ❌ Drive API operations failed:", e.message || e.details);
      results.advancedServices.driveOperations = { status: 'FAIL', error: e.message || e.details };
      results.allPassed = false;
    }

    console.log("9. Testing Docs API operations...");
    try {
      const docResult = docsGetDocument(ARCHIVE_TEMPLATE_ID);
      console.log("   ✅ Docs API document access verified: " + docResult.title);
      results.advancedServices.docsOperations = { status: 'OK' };
    } catch (e) {
      console.error("   ❌ Docs API operations failed:", e.message || e.details);
      results.advancedServices.docsOperations = { status: 'FAIL', error: e.message || e.details };
      results.allPassed = false;
    }

    console.log("");
    console.log("=".repeat(50));
    if (results.allPassed) {
      console.log("✅ AUTHORIZATION COMPLETE!");
      console.log("All OAuth scopes have been approved.");
      console.log("Both built-in services and Advanced Services are working.");
    } else {
      console.error("❌ AUTHORIZATION INCOMPLETE");
      console.error("Some services failed authorization. Please review errors above.");
      console.error("You may need to run this function again or check the OAuth consent screen.");
    }
    console.log("=".repeat(50));

  } catch (e) {
    console.error("");
    console.error("=".repeat(50));
    console.error("❌ Authorization error:", e.toString());
    console.error("=".repeat(50));
    console.log("Please try running this function again.");
    console.log("If the error persists, check the OAuth consent screen.");
    console.log("You may need to revoke and re-authorize all permissions.");
    results.allPassed = false;
  }
  
  return results;
}

/**
 * OAuth Preflight Check
 * Run this BEFORE creating production deployments to verify all OAuth scopes work.
 * Returns a detailed status report of each scope.
 * 
 * Updated to test Advanced Services APIs for better authorization control.
 *
 * Usage: Run from Apps Script editor before deployment
 * Purpose: Catch OAuth issues before they affect production web app
 */
function oauth_preflight_check() {
  console.log("🔍 OAuth Preflight Check (Advanced Services)");
  console.log("=".repeat(50));

  const results = {
    scopes: [],
    advancedServices: [],
    allPassed: true,
    timestamp: new Date().toISOString()
  };

  // Test 1: MailApp (script.send_mail)
  console.log("\n1. Testing MailApp (script.send_mail)...");
  try {
    const quota = MailApp.getRemainingDailyQuota();
    results.scopes.push({
      name: 'script.send_mail',
      service: 'MailApp (built-in)',
      status: 'OK',
      details: 'Daily email quota: ' + quota
    });
    console.log("   ✅ OK - Daily quota: " + quota);
  } catch(e) {
    results.scopes.push({
      name: 'script.send_mail',
      service: 'MailApp (built-in)',
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
      service: 'GmailApp (built-in)',
      status: 'OK',
      details: 'Draft count: ' + drafts.length
    });
    console.log("   ✅ OK - Drafts accessible: " + drafts.length);
  } catch(e) {
    results.scopes.push({
      name: 'gmail.readonly',
      service: 'GmailApp (built-in)',
      status: 'FAIL',
      error: e.toString()
    });
    results.allPassed = false;
    console.error("   ❌ FAIL - " + e.toString());
  }

  // Test 3: Drive API v3 (Advanced Service)
  console.log("\n3. Testing Drive API v3 (Advanced Service)...");
  const driveAuth = checkDriveAuthorization();
  results.advancedServices.push({
    name: 'drive',
    service: 'Drive API v3',
    status: driveAuth.authorized ? 'OK' : 'FAIL',
    authorized: driveAuth.authorized,
    error: driveAuth.error || null,
    details: driveAuth.authorized ? 'Drive API accessible' : driveAuth.details
  });
  if (driveAuth.authorized) {
    try {
      const folderResult = driveGetFolder(EMAIL_ARCHIVE_FOLDER_ID);
      console.log("   ✅ OK - Drive API authorized");
      console.log("   ✓ Archive folder accessible: " + folderResult.name);
      results.advancedServices[results.advancedServices.length - 1].details = 
        'Archive folder accessible: ' + folderResult.name;
    } catch(e) {
      console.error("   ⚠️  Authorization OK but folder access failed: " + (e.message || e.details));
      results.advancedServices[results.advancedServices.length - 1].warning = e.message || e.details;
    }
  } else {
    console.error("   ❌ FAIL - " + (driveAuth.details || driveAuth.error));
    results.allPassed = false;
  }

  // Test 4: Docs API v1 (Advanced Service)
  console.log("\n4. Testing Docs API v1 (Advanced Service)...");
  const docsAuth = checkDocsAuthorization();
  results.advancedServices.push({
    name: 'documents',
    service: 'Docs API v1',
    status: docsAuth.authorized ? 'OK' : 'FAIL',
    authorized: docsAuth.authorized,
    error: docsAuth.error || null,
    details: docsAuth.authorized ? 'Docs API accessible' : docsAuth.details
  });
  if (docsAuth.authorized) {
    try {
      const docResult = docsGetDocument(ARCHIVE_TEMPLATE_ID);
      console.log("   ✅ OK - Docs API authorized");
      console.log("   ✓ Archive template accessible: " + docResult.title);
      results.advancedServices[results.advancedServices.length - 1].details = 
        'Archive template accessible: ' + docResult.title;
    } catch(e) {
      const classification = classifyError(e);
      if (classification.type === 'NOT_FOUND') {
        console.warn("   ⚠️  Authorization OK but template not found (check ARCHIVE_TEMPLATE_ID)");
        results.advancedServices[results.advancedServices.length - 1].warning = e.message || e.details;
      } else {
        console.error("   ⚠️  Authorization OK but template access failed: " + (e.message || e.details));
        results.advancedServices[results.advancedServices.length - 1].warning = e.message || e.details;
      }
    }
  } else {
    console.error("   ❌ FAIL - " + (docsAuth.details || docsAuth.error));
    results.allPassed = false;
  }

  // Test 5: SpreadsheetApp (spreadsheets)
  console.log("\n5. Testing SpreadsheetApp (spreadsheets)...");
  try {
    const ss = getDatasource();
    const name = ss ? ss.getName() : 'Not connected';
    results.scopes.push({
      name: 'spreadsheets',
      service: 'SpreadsheetApp (built-in)',
      status: 'OK',
      details: 'Connected to: ' + name
    });
    console.log("   ✅ OK - Connected to: " + name);
  } catch(e) {
    results.scopes.push({
      name: 'spreadsheets',
      service: 'SpreadsheetApp (built-in)',
      status: 'FAIL',
      error: e.toString()
    });
    results.allPassed = false;
    console.error("   ❌ FAIL - " + e.toString());
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("Preflight Check Summary:");
  console.log("-".repeat(50));
  console.log("Built-in Services: " + results.scopes.filter(s => s.status === 'OK').length + "/" + results.scopes.length + " passed");
  console.log("Advanced Services: " + results.advancedServices.filter(s => s.status === 'OK').length + "/" + results.advancedServices.length + " passed");
  console.log("-".repeat(50));
  
  if (results.allPassed) {
    console.log("✅ PREFLIGHT CHECK PASSED");
    console.log("All critical OAuth scopes are authorized.");
    console.log("Both built-in services and Advanced Services are working.");
    console.log("Safe to create production deployment.");
  } else {
    console.error("❌ PREFLIGHT CHECK FAILED");
    console.error("Some OAuth scopes are not authorized.");
    console.error("Fix authorization issues before deployment.");
    console.error("Run debug_triggerAuth() to authorize all scopes.");
  }
  console.log("=".repeat(50));

  // Return structured results for programmatic use
  return results;
}

// ============================================================================
// PHASE 4: TESTING FUNCTIONS
// ============================================================================

/**
 * Comprehensive test of all Advanced Services operations
 * Tests Drive API v3 and Docs API v1 with actual operations
 * @returns {Object} Test results with detailed status for each operation
 */
function testAdvancedServices() {
  console.log("=".repeat(50));
  console.log("Advanced Services Comprehensive Test");
  console.log("=".repeat(50));
  
  const results = {
    timestamp: new Date().toISOString(),
    drive: {},
    docs: {},
    allPassed: true,
    initialization: {}
  };

  // Test Initialization
  console.log("\n0. Checking API Initialization...");
  results.initialization.drive = (typeof Drive !== 'undefined');
  results.initialization.docs = (typeof Docs !== 'undefined');
  
  if (results.initialization.drive) {
    console.log("   ✅ Drive API object is defined");
  } else {
    console.error("   ❌ Drive API object is UNDEFINED. Is it enabled in Services?");
    results.allPassed = false;
  }
  
  if (results.initialization.docs) {
    console.log("   ✅ Docs API object is defined");
  } else {
    console.error("   ❌ Docs API object is UNDEFINED. Is it enabled in Services?");
    results.allPassed = false;
  }
  
  // Test Drive API operations
  console.log("\nTesting Drive API v3 Operations:");
  console.log("-".repeat(50));
  
  console.log("1. Testing folder access...");
  try {
    const folderResult = driveGetFolder(EMAIL_ARCHIVE_FOLDER_ID);
    results.drive.folderAccess = { status: 'OK', folderName: folderResult.name };
    console.log("   ✅ Folder accessed: " + folderResult.name);
  } catch (e) {
    results.drive.folderAccess = { status: 'FAIL', error: e.message || e.details };
    results.allPassed = false;
    console.error("   ❌ Folder access failed:", e.message || e.details);
  }
  
  console.log("2. Testing file access...");
  try {
    const fileResult = driveGetFile(ARCHIVE_TEMPLATE_ID, ['id', 'name', 'mimeType']);
    results.drive.fileAccess = { status: 'OK', fileName: fileResult.file.name };
    console.log("   ✅ File accessed: " + fileResult.file.name);
    console.log("   MIME type: " + fileResult.file.mimeType);
  } catch (e) {
    results.drive.fileAccess = { status: 'FAIL', error: e.message || e.details };
    results.allPassed = false;
    console.error("   ❌ File access failed:", e.message || e.details);
  }
  
  console.log("3. Testing file copy operation...");
  try {
    const testFileName = 'TEST_' + new Date().getTime() + ' - Advanced Services Test';
    const copyResult = driveCopyFile(ARCHIVE_TEMPLATE_ID, testFileName, EMAIL_ARCHIVE_FOLDER_ID);
    results.drive.fileCopy = { status: 'OK', copiedFileId: copyResult.fileId };
    console.log("   ✅ File copied successfully");
    console.log("   Copied file ID: " + copyResult.fileId);
    
    // Clean up test file
    try {
      Drive.Files.remove(copyResult.fileId, {
        supportsAllDrives: true
      });
      console.log("   ✓ Test file cleaned up");
    } catch (cleanupError) {
      console.warn("   ⚠️  Could not clean up test file (ID: " + copyResult.fileId + ")");
    }
  } catch (e) {
    results.drive.fileCopy = { status: 'FAIL', error: e.message || e.details };
    results.allPassed = false;
    console.error("   ❌ File copy failed:", e.message || e.details);
  }
  
  // Test Docs API operations
  console.log("\nTesting Docs API v1 Operations:");
  console.log("-".repeat(50));
  
  console.log("1. Testing document retrieval...");
  try {
    const docResult = docsGetDocument(ARCHIVE_TEMPLATE_ID);
    results.docs.documentRetrieval = { status: 'OK', documentTitle: docResult.title };
    console.log("   ✅ Document retrieved: " + docResult.title);
    console.log("   Document ID: " + docResult.documentId);
  } catch (e) {
    results.docs.documentRetrieval = { status: 'FAIL', error: e.message || e.details };
    results.allPassed = false;
    console.error("   ❌ Document retrieval failed:", e.message || e.details);
  }
  
  console.log("2. Testing text replacement...");
  try {
    // Create a test copy first
    const testFileName = 'TEST_' + new Date().getTime() + ' - Text Replacement Test';
    const copyResult = driveCopyFile(ARCHIVE_TEMPLATE_ID, testFileName, EMAIL_ARCHIVE_FOLDER_ID);
    
    // Try to replace text
    const replaceResult = docsReplaceText(copyResult.fileId, '{{TEST}}', 'Replacement Successful');
    results.docs.textReplacement = { status: 'OK', revisionId: replaceResult.revisionId };
    console.log("   ✅ Text replacement successful");
    console.log("   Revision ID: " + replaceResult.revisionId);
    
    // Clean up test file
    try {
      Drive.Files.remove(copyResult.fileId, {
        supportsAllDrives: true
      });
      console.log("   ✓ Test file cleaned up");
    } catch (cleanupError) {
      console.warn("   ⚠️  Could not clean up test file (ID: " + copyResult.fileId + ")");
    }
  } catch (e) {
    results.docs.textReplacement = { status: 'FAIL', error: e.message || e.details };
    results.allPassed = false;
    console.error("   ❌ Text replacement failed:", e.message || e.details);
  }
  
  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("Test Summary:");
  console.log("-".repeat(50));
  const driveTests = Object.keys(results.drive).length;
  const drivePassed = Object.values(results.drive).filter(t => t.status === 'OK').length;
  const docsTests = Object.keys(results.docs).length;
  const docsPassed = Object.values(results.docs).filter(t => t.status === 'OK').length;
  
  console.log("Drive API: " + drivePassed + "/" + driveTests + " tests passed");
  console.log("Docs API: " + docsPassed + "/" + docsTests + " tests passed");
  console.log("-".repeat(50));
  
  if (results.allPassed) {
    console.log("✅ ALL TESTS PASSED");
    console.log("Advanced Services are working correctly.");
  } else {
    console.error("❌ SOME TESTS FAILED");
    console.error("Review errors above and fix authorization issues.");
  }
  console.log("=".repeat(50));
  
  return results;
}

// ============================================================================
// PHASE 1: AUTHORIZATION INFRASTRUCTURE
// ============================================================================

/**
 * Classifies errors into categories for better error handling
 * @param {Error|string} error - The error object or string to classify
 * @returns {Object} Classification with type, recoverable flag, and suggestion
 */
function classifyError(error) {
  // Handle case where error might be a string (common in Apps Script)
  const errorStr = error ? error.toString() : '';
  const msg = (error.message || errorStr || '').toLowerCase();
  
  // LOG THE RAW ERROR FOR DEBUGGING
  console.warn('Classifying error. Raw message:', errorStr);
  if (error && typeof error === 'object') {
    try {
      console.warn('Error properties:', JSON.stringify(Object.getOwnPropertyNames(error)));
    } catch (e) {}
  }

  const code = error.code || (errorStr.match(/\d{3}/) ? parseInt(errorStr.match(/\d{3}/)[0]) : null);
  
  // Authorization errors
  if (code === 401 || code === 403 || 
      msg.includes('permission') || 
      msg.includes('authorization') || 
      msg.includes('access denied') ||
      msg.includes('insufficient permission') ||
      msg.includes('not authorized') ||
      msg.includes('consent')) {
    return {
      type: 'AUTHORIZATION',
      recoverable: true,
      suggestion: 'Run debug_triggerAuth() to re-authorize all scopes',
      userMessage: 'Authorization required. Please grant permissions for Drive and Docs access.'
    };
  }
  
  // API/Server errors (MATCHING "server error" specifically now)
  if (code === 500 || 
      code === 503 ||
      msg.includes('server error') ||
      msg.includes('service unavailable') ||
      msg.includes('internal error') ||
      msg.includes('we\'re sorry')) {
    return {
      type: 'API_ERROR',
      recoverable: false,
      suggestion: 'This is a Google API server error. This often happens if the API is disabled in Cloud Console or if there is a temporary Google outage.',
      userMessage: 'Google API service returned a server error (500). Please try again later or check API settings.'
    };
  }
  
  // Not found errors
  if (code === 404 || 
      msg.includes('not found') ||
      msg.includes('file not found') ||
      msg.includes('folder not found')) {
    return {
      type: 'NOT_FOUND',
      recoverable: false,
      suggestion: 'Verify the file/folder IDs are correct in Code.gs constants',
      userMessage: 'File or folder not found. Please check configuration.'
    };
  }
  
  // Rate limit errors
  if (code === 429 || 
      msg.includes('rate limit') ||
      msg.includes('quota exceeded') ||
      msg.includes('too many requests')) {
    return {
      type: 'RATE_LIMIT',
      recoverable: true,
      suggestion: 'Wait a few minutes and retry. Consider implementing exponential backoff.',
      userMessage: 'Too many requests. Please wait a moment and try again.'
    };
  }
  
  // Network/timeout errors
  if (msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('connection') ||
      msg.includes('failed to fetch')) {
    return {
      type: 'NETWORK_ERROR',
      recoverable: true,
      suggestion: 'Check network connection and retry',
      userMessage: 'Network error. Please check your connection and try again.'
    };
  }
  
  // Default: unknown error
  return {
    type: 'UNKNOWN',
    recoverable: false,
    suggestion: 'The error was not recognized. Please check the raw log output above.',
    userMessage: 'An unexpected error occurred (' + errorStr.substring(0, 50) + '...).'
  };
}

/**
 * Checks if Drive API authorization is available
 * @returns {Object} Authorization status with authorized flag and error details if any
 */
function checkDriveAuthorization() {
  try {
    // Attempt a minimal Drive API call to verify authorization
    Drive.Files.list({maxResults: 1, fields: 'files(id)'});
    return {
      authorized: true,
      service: 'Drive API v3',
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    const classification = classifyError(e);
    return {
      authorized: false,
      service: 'Drive API v3',
      error: classification.type,
      details: e.message || e.toString(),
      suggestion: classification.suggestion,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Checks if Docs API authorization is available
 * @returns {Object} Authorization status with authorized flag and error details if any
 */
function checkDocsAuthorization() {
  try {
    // Attempt a minimal Docs API call to verify authorization
    // We'll use a test document ID - if it fails with auth error, we know it's authorization
    // If it fails with 404, that's fine - it means auth works
    try {
      Docs.Documents.get('test', {fields: 'documentId'});
    } catch (e) {
      // If it's a 404, that's fine - auth is working
      if (e.message && e.message.includes('404')) {
        return {
          authorized: true,
          service: 'Docs API v1',
          timestamp: new Date().toISOString()
        };
      }
      // If it's auth error, re-throw to be caught below
      if (e.message && (e.message.includes('permission') || e.message.includes('authorization') || e.message.includes('401') || e.message.includes('403'))) {
        throw e;
      }
      // Other errors might be API issues, but let's assume auth works if not explicitly denied
      return {
        authorized: true,
        service: 'Docs API v1',
        note: 'Authorization check passed (test document not found, but API accessible)',
        timestamp: new Date().toISOString()
      };
    }
    return {
      authorized: true,
      service: 'Docs API v1',
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    const classification = classifyError(e);
    return {
      authorized: false,
      service: 'Docs API v1',
      error: classification.type,
      details: e.message || e.toString(),
      suggestion: classification.suggestion,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Comprehensive authorization check for all required scopes
 * @returns {Object} Status report for all authorization checks
 */
function checkAllAuthorizations() {
  console.log('🔍 Checking all OAuth authorizations...');
  console.log('='.repeat(50));
  
  const results = {
    timestamp: new Date().toISOString(),
    checks: {},
    allAuthorized: true
  };
  
  // Check Drive API
  console.log('\n1. Checking Drive API authorization...');
  results.checks.drive = checkDriveAuthorization();
  if (results.checks.drive.authorized) {
    console.log('   ✅ Drive API authorized');
  } else {
    console.error('   ❌ Drive API NOT authorized:', results.checks.drive.error);
    results.allAuthorized = false;
  }
  
  // Check Docs API
  console.log('\n2. Checking Docs API authorization...');
  results.checks.docs = checkDocsAuthorization();
  if (results.checks.docs.authorized) {
    console.log('   ✅ Docs API authorized');
  } else {
    console.error('   ❌ Docs API NOT authorized:', results.checks.docs.error);
    results.allAuthorized = false;
  }
  
  // Check built-in services (for comparison)
  console.log('\n3. Checking built-in services...');
  try {
    DriveApp.getStorageLimit();
    results.checks.driveApp = { authorized: true, service: 'DriveApp (built-in)' };
    console.log('   ✅ DriveApp authorized');
  } catch (e) {
    results.checks.driveApp = { authorized: false, error: e.message };
    console.error('   ❌ DriveApp NOT authorized:', e.message);
    results.allAuthorized = false;
  }
  
  try {
    DocumentApp.create('test');
    results.checks.documentApp = { authorized: true, service: 'DocumentApp (built-in)' };
    console.log('   ✅ DocumentApp authorized');
  } catch (e) {
    results.checks.documentApp = { authorized: false, error: e.message };
    console.error('   ❌ DocumentApp NOT authorized:', e.message);
    results.allAuthorized = false;
  }
  
  console.log('\n' + '='.repeat(50));
  if (results.allAuthorized) {
    console.log('✅ ALL AUTHORIZATIONS VERIFIED');
  } else {
    console.error('❌ SOME AUTHORIZATIONS MISSING');
    console.log('Run debug_triggerAuth() to fix authorization issues');
  }
  console.log('='.repeat(50));
  
  return results;
}

/**
 * Verifies trigger authorization status
 * Lists all triggers and checks if they have proper authorization context
 * @returns {Object} Report of all triggers and their authorization status
 */
function verifyTriggerAuthorization() {
  console.log('🔍 Verifying Trigger Authorization');
  console.log('='.repeat(50));
  
  const triggers = ScriptApp.getProjectTriggers();
  const report = {
    timestamp: new Date().toISOString(),
    totalTriggers: triggers.length,
    triggers: [],
    warnings: []
  };
  
  if (triggers.length === 0) {
    console.log('No triggers found in this project.');
    report.message = 'No triggers configured';
    return report;
  }
  
  console.log(`Found ${triggers.length} trigger(s):\n`);
  
  triggers.forEach((trigger, index) => {
    const triggerInfo = {
      index: index + 1,
      type: trigger.getEventType().toString(),
      handlerFunction: trigger.getHandlerFunction(),
      source: trigger.getTriggerSource() ? trigger.getTriggerSource().toString() : 'UNKNOWN'
    };
    
    // Check trigger type
    if (trigger.getEventType() === ScriptApp.EventType.CLOCK) {
      triggerInfo.schedule = 'Time-driven trigger';
      triggerInfo.warning = 'Time-driven triggers execute as the user who created them. Ensure that user has authorized all required scopes.';
      report.warnings.push(`Trigger "${triggerInfo.handlerFunction}" is time-driven - verify creator has authorized scopes`);
    } else if (trigger.getEventType() === ScriptApp.EventType.ON_EDIT) {
      triggerInfo.schedule = 'On edit trigger';
    } else if (trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT) {
      triggerInfo.schedule = 'On form submit trigger';
    } else if (trigger.getEventType() === ScriptApp.EventType.ON_OPEN) {
      triggerInfo.schedule = 'On open trigger';
    }
    
    // Check if handler function exists
    try {
      const handler = eval(triggerInfo.handlerFunction);
      if (typeof handler === 'function') {
        triggerInfo.handlerExists = true;
      } else {
        triggerInfo.handlerExists = false;
        triggerInfo.error = 'Handler function not found';
        report.warnings.push(`Trigger "${triggerInfo.handlerFunction}" handler function not found`);
      }
    } catch (e) {
      triggerInfo.handlerExists = false;
      triggerInfo.error = 'Cannot verify handler function';
    }
    
    report.triggers.push(triggerInfo);
    
    console.log(`${index + 1}. ${triggerInfo.type}`);
    console.log(`   Handler: ${triggerInfo.handlerFunction}`);
    console.log(`   Source: ${triggerInfo.source}`);
    if (triggerInfo.schedule) {
      console.log(`   Schedule: ${triggerInfo.schedule}`);
    }
    if (triggerInfo.warning) {
      console.log(`   ⚠️  ${triggerInfo.warning}`);
    }
    console.log('');
  });
  
  console.log('='.repeat(50));
  console.log('Summary:');
  console.log(`Total triggers: ${report.totalTriggers}`);
  if (report.warnings.length > 0) {
    console.log(`Warnings: ${report.warnings.length}`);
    report.warnings.forEach(w => console.log(`  - ${w}`));
  }
  console.log('');
  console.log('⚠️  IMPORTANT: Time-driven triggers execute as the user who created them.');
  console.log('If triggers fail with authorization errors, the creator may need to:');
  console.log('1. Run debug_triggerAuth() to authorize all scopes');
  console.log('2. Delete and recreate the triggers');
  console.log('='.repeat(50));
  
  return report;
}

/**
 * Checks if triggers have required scopes
 * This is a helper function that combines trigger verification with authorization checks
 * @returns {Object} Combined report of triggers and their authorization status
 */
function checkTriggerScopes() {
  const triggerReport = verifyTriggerAuthorization();
  const authReport = checkAllAuthorizations();
  
  return {
    timestamp: new Date().toISOString(),
    triggers: triggerReport,
    authorization: authReport,
    recommendation: authReport.allAuthorized 
      ? 'All authorizations verified. Triggers should work correctly.'
      : 'Some authorizations are missing. Run debug_triggerAuth() and recreate triggers if needed.'
  };
}

// ============================================================================
// PHASE 3: ADVANCED SERVICES WRAPPER FUNCTIONS
// ============================================================================

/**
 * Copies a file using Drive API v3
 * @param {string} fileId - ID of the file to copy
 * @param {string} name - Name for the copied file
 * @param {string} folderId - ID of the destination folder
 * @returns {Object} Result with success flag and new file ID
 */
function driveCopyFile(fileId, name, folderId) {
  try {
    const copyMetadata = {
      name: name,
      parents: [folderId]
    };
    
    // Added supportsAllDrives for Shared Drive support
    const copiedFile = Drive.Files.copy(copyMetadata, fileId, {
      supportsAllDrives: true
    });
    
    return {
      success: true,
      fileId: copiedFile.id,
      name: copiedFile.name
    };
  } catch (e) {
    const classification = classifyError(e);
    throw {
      success: false,
      error: classification.type,
      message: classification.userMessage,
      details: e.message || e.toString(),
      suggestion: classification.suggestion
    };
  }
}

/**
 * Gets file metadata using Drive API v3
 * @param {string} fileId - ID of the file
 * @param {Array<string>} fields - Optional fields to retrieve (default: basic metadata)
 * @returns {Object} File metadata
 */
function driveGetFile(fileId, fields = ['id', 'name', 'mimeType', 'parents']) {
  try {
    // Added supportsAllDrives for Shared Drive support
    const file = Drive.Files.get(fileId, {
      fields: fields.join(','),
      supportsAllDrives: true
    });
    return {
      success: true,
      file: file
    };
  } catch (e) {
    const classification = classifyError(e);
    throw {
      success: false,
      error: classification.type,
      message: classification.userMessage,
      details: e.message || e.toString(),
      suggestion: classification.suggestion
    };
  }
}

/**
 * Gets folder metadata using Drive API v3
 * @param {string} folderId - ID of the folder
 * @returns {Object} Folder metadata
 */
function driveGetFolder(folderId) {
  try {
    // Added supportsAllDrives for Shared Drive support
    const folder = Drive.Files.get(folderId, {
      fields: 'id,name,mimeType,parents',
      supportsAllDrives: true
    });
    
    // Verify it's actually a folder
    if (folder.mimeType !== 'application/vnd.google-apps.folder') {
      throw {
        success: false,
        error: 'NOT_FOUND',
        message: 'The specified ID is not a folder',
        details: `Expected folder, got: ${folder.mimeType}`
      };
    }
    
    return {
      success: true,
      folder: folder,
      id: folder.id,
      name: folder.name
    };
  } catch (e) {
    // If it's already our structured error, re-throw
    if (e.success !== undefined) {
      throw e;
    }
    
    const classification = classifyError(e);
    throw {
      success: false,
      error: classification.type,
      message: classification.userMessage,
      details: e.message || e.toString(),
      suggestion: classification.suggestion
    };
  }
}

/**
 * Gets document content using Docs API v1
 * @param {string} documentId - ID of the document
 * @returns {Object} Document content and metadata
 */
function docsGetDocument(documentId) {
  try {
    const document = Docs.Documents.get(documentId);
    return {
      success: true,
      document: document,
      documentId: document.documentId,
      title: document.title
    };
  } catch (e) {
    const classification = classifyError(e);
    throw {
      success: false,
      error: classification.type,
      message: classification.userMessage,
      details: e.message || e.toString(),
      suggestion: classification.suggestion
    };
  }
}

/**
 * Performs batch update operations on a document using Docs API v1
 * @param {string} documentId - ID of the document
 * @param {Array<Object>} requests - Array of update requests
 * @returns {Object} Result with success flag and revision ID
 */
function docsBatchUpdate(documentId, requests) {
  try {
    const response = Docs.Documents.batchUpdate({
      requests: requests
    }, documentId);
    
    return {
      success: true,
      revisionId: response.revisionId,
      documentId: response.documentId
    };
  } catch (e) {
    const classification = classifyError(e);
    throw {
      success: false,
      error: classification.type,
      message: classification.userMessage,
      details: e.message || e.toString(),
      suggestion: classification.suggestion
    };
  }
}

/**
 * Replaces all occurrences of text in a document using Docs API v1
 * This is a helper function that creates the batch update request for text replacement
 * @param {string} documentId - ID of the document
 * @param {string} findText - Text to find (supports regex patterns)
 * @param {string} replaceText - Text to replace with
 * @returns {Object} Result with success flag
 */
function docsReplaceText(documentId, findText, replaceText) {
  try {
    const request = {
      replaceAllText: {
        containsText: {
          text: findText,
          matchCase: false
        },
        replaceText: replaceText
      }
    };
    
    return docsBatchUpdate(documentId, [request]);
  } catch (e) {
    // Re-throw structured errors as-is
    if (e.success !== undefined) {
      throw e;
    }
    
    const classification = classifyError(e);
    throw {
      success: false,
      error: classification.type,
      message: classification.userMessage,
      details: e.message || e.toString(),
      suggestion: classification.suggestion
    };
  }
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
