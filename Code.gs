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
      headers: ['txn_id', 'household_id', 'project_id', 'date', 'amount_cents', 'method', 'meta_json'] 
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
      household_id: row[0],
      household_name: row[1],
      search_index: row[2],
      address: address,
      members: [] // Will be populated below
    };
  });

  // Process Members and add to their households
  memberRows.forEach(row => {
    // member_id (0), household_id (1), first_name (2), last_name (3), email (4), phone (5), member_order (6), created_at (7)
    const member = {
      member_id: row[0],
      household_id: row[1],
      first_name: row[2],
      last_name: row[3],
      email: row[4],
      phone: row[5],
      member_order: row[6]
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
    project_id: row[0],
    name: row[1],
    description: row[2]
  }));

  return { households, projects };
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

    // Append row: txn_id | household_id | project_id | date | amount_cents | method | meta_json
    sheet.appendRow([
      txn_id,
      payload.household_id,
      payload.project_id,
      payload.date,
      payload.amount_cents,
      payload.method,
      meta_json
    ]);

    return { success: true, txn_id: txn_id };

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}
