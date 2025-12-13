function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
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
      headers: ['txn_id', 'household_id', 'project_id', 'date', 'amount_cents', 'method', 'comments', 'meta_json'] 
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
      date: toIso(row[3]), // Ensure String
      amount_cents: Number(row[4]),
      method: String(row[5]),
      comments: String(row[6] || '')
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

    // Append row: txn_id | household_id | project_id | date | amount_cents | method | comments | meta_json
    sheet.appendRow([
      txn_id,
      payload.household_id,
      payload.project_id,
      payload.date,
      payload.amount_cents,
      payload.method,
      payload.comments || '',
      meta_json
    ]);

    return { success: true, txn_id: txn_id };

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }

}

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

    // Update Row
    sheet.getRange(rowIndex, 2).setValue(payload.household_id); 
    sheet.getRange(rowIndex, 3).setValue(payload.project_id);
    sheet.getRange(rowIndex, 4).setValue(payload.date);
    sheet.getRange(rowIndex, 5).setValue(payload.amount_cents); 
    sheet.getRange(rowIndex, 6).setValue(payload.method);
    sheet.getRange(rowIndex, 7).setValue(payload.comments || '');

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

