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
    { name: 'db_Donors', headers: ['donor_id', 'status', 'type', 'search_index', 'json_data', 'created_at'] },
    { name: 'db_Donations', headers: ['txn_id', 'donor_id', 'project_id', 'date', 'amount_cents', 'method', 'meta_json'] },
    { name: 'db_Projects', headers: ['project_id', 'name', 'description'] }
  ];

  sheets.forEach(config => {
    let sheet = ss.getSheetByName(config.name);
    if (!sheet) {
      sheet = ss.insertSheet(config.name);
    }
    
    // Reset permissions/content
    sheet.clear();
    
    // Check if we have data (headers already there? No, we cleared).
    // Just append headers
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
 */
function getInitialData() {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected. Please run setupDatabase() first.");

  const donorsSheet = ss.getSheetByName('db_Donors');
  const projectsSheet = ss.getSheetByName('db_Projects');
  
  // Helper to get data or empty array
  const getData = (sheet) => {
    if (!sheet || sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  };

  const donorRows = getData(donorsSheet);
  const projectRows = getData(projectsSheet);

  // Process Donors
  const donors = donorRows.map(row => {
    // donor_id (0), status (1), type (2), search_index (3), json_data (4), created_at (5)
    let parsedData = {};
    try {
      parsedData = row[4] ? JSON.parse(row[4]) : {};
    } catch (e) {
      console.error('Error parsing donor JSON', e);
    }
    
    return {
      donor_id: row[0],
      search_index: row[3],
      ...parsedData
    };
  });

  // Process Projects
  const projects = projectRows.map(row => ({
    project_id: row[0],
    name: row[1],
    description: row[2]
  }));

  return { donors, projects };
}

/**
 * saveDonation - Appends a new donation record.
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

    // Append row: txn_id | donor_id | project_id | date | amount_cents | method | meta_json
    sheet.appendRow([
      txn_id,
      payload.donor_id,
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

/**
 * saveDonor - Creates a new donor.
 */
function saveDonor(payload) {
  const ss = getDatasource();
  if (!ss) throw new Error("Database not connected.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    throw new Error('Busy. Try again.');
  }

  try {
    const sheet = ss.getSheetByName('db_Donors');
    if (!sheet) throw new Error('db_Donors sheet not found');

    const donor_id = Utilities.getUuid();
    // Payload: firstName, lastName, email, phone, type
    
    // Construct search_index: "LastName, FirstName"
    const search_index = `${payload.lastName}, ${payload.firstName}`;
    
    const json_data = JSON.stringify({
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      phone: payload.phone
    });
    
    // Headers: donor_id | status | type | search_index | json_data | created_at
    sheet.appendRow([
      donor_id,
      'Active',
      payload.type || 'Individual',
      search_index,
      json_data,
      new Date().toISOString()
    ]);
    
    return { success: true, donor_id: donor_id, search_index: search_index };

  } catch (error) {
    throw error;
  } finally {
    lock.releaseLock();
  }
}
