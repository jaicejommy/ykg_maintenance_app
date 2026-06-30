/**
 * frontend/js/app.js
 * Page controller — wires validators, api, ui, and auth together.
 * Contains one self-invoking initialization block per page.
 * Only this file imports from all other modules.
 */

// ---------------------------------------------------------------------------
// LOGIN PAGE
// ---------------------------------------------------------------------------

/**
 * Initialize the login page.
 * Detects page by checking for #login-form.
 */
function initLoginPage() {
  const loginForm = document.getElementById("login-form");
  if (!loginForm) return;

  // If already authenticated, skip login
  if (getToken()) {
    window.location.replace("dashboard.html");
    return;
  }

  const submitBtn     = document.getElementById("btn-login");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const togglePwdBtn  = document.getElementById("toggle-password");

  // Show / hide password toggle
  if (togglePwdBtn) {
    togglePwdBtn.addEventListener("click", () => {
      const isText = passwordInput.type === "text";
      passwordInput.type = isText ? "password" : "text";
      togglePwdBtn.textContent = isText ? "Show" : "Hide";
    });
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    // Client-side required validation
    let hasErrors = false;
    const userResult = validateRequired(username, "Username");
    if (!userResult.valid) {
      showFieldError("username", userResult.message);
      hasErrors = true;
    }
    const passResult = validateRequired(password, "Password");
    if (!passResult.valid) {
      showFieldError("password", passResult.message);
      hasErrors = true;
    }
    if (hasErrors) return;

    setLoading(submitBtn, true);
    try {
      const data = await login(username, password);
      saveToken(data.access_token, data.role, data.username);
      window.location.replace("dashboard.html");
    } catch (err) {
      showToast(err.message || "Login failed. Please try again.", "error");
      setLoading(submitBtn, false);
    }
  });
}

// ---------------------------------------------------------------------------
// SHARED HELPERS
// ---------------------------------------------------------------------------

/**
 * Show or hide the "Manage Users" navbar link based on the current role.
 * Reads #nav-manage-users and toggles d-none. Does not use innerHTML.
 */
function applyNavbarRoleVisibility() {
  const role = getRole();
  const manageUsersLink = document.getElementById("nav-manage-users");
  if (manageUsersLink) {
    if (role === ROLES.ADMIN) {
      manageUsersLink.classList.remove("d-none");
    } else {
      manageUsersLink.classList.add("d-none");
    }
  }
}

/**
 * Populate the sidebar user info fields and wire the logout button.
 * Uses textContent only — no innerHTML.
 */
function populateSidebar() {
  const username = getUsername();
  const role     = getRole();

  const avatarEl = document.getElementById("sidebarUserAvatar");
  const nameEl   = document.getElementById("sidebarUsername");
  const roleEl   = document.getElementById("sidebarUserRole");

  if (avatarEl && username) avatarEl.textContent = username.charAt(0).toUpperCase();
  if (nameEl)  nameEl.textContent  = username || "\u2014";
  if (roleEl)  roleEl.textContent  = role    || "\u2014";

  // Show/hide Manage Users sidebar item based on role
  const manageUsersItem = document.getElementById("nav-manage-users-item");
  if (manageUsersItem) {
    manageUsersItem.classList.toggle("d-none", role !== ROLES.ADMIN);
  }

  // Wire sidebar logout button
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearSession();
      window.location.href = "index.html";
    });
  }
}

/**
 * Populate the topbar user meta string (username — role).
 */
function populateTopbarMeta() {
  const username = getUsername();
  const role     = getRole();
  const metaEl   = document.getElementById("topbar-user-meta");
  if (metaEl && username) {
    metaEl.textContent = username + " \u2014 " + (role || "");
  }
}

// ---------------------------------------------------------------------------
// DASHBOARD PAGE
// ---------------------------------------------------------------------------

let pendingDeleteId   = null;
let pendingDeleteRow  = null;

// Map of record id -> full record object, used by the row-click detail handler
let _recordsMap = {};

/**
 * Initialize the dashboard page.
 * Detects page by checking for #records-tbody.
 */
function initDashboardPage() {
  if (!document.getElementById("records-tbody")) return;

  guardPage();
  populateNavbar();
  applyNavbarRoleVisibility();

  // Sidebar wiring
  populateSidebar();
  populateTopbarMeta();
  const activeDash = document.getElementById("nav-dashboard");
  if (activeDash) activeDash.classList.add("active");

  const role     = getRole();
  const username = getUsername();

  // Hide "New Record" button for Viewers
  const newRecordBtn = document.getElementById("btn-new-record");
  if (newRecordBtn && role === ROLES.VIEWER) {
    newRecordBtn.style.display = "none";
  }

  const searchInput  = document.getElementById("search-input");
  const typeFilter   = document.getElementById("type-filter");

  // Load records function with current filter state
  async function loadRecords() {
    const filters = {
      type:   typeFilter  ? typeFilter.value  : "",
      search: searchInput ? searchInput.value : "",
    };
    try {
      const records = await getRecords(filters);

      // Keep a local map for the row-click handler
      _recordsMap = {};
      records.forEach((r) => { _recordsMap[r.id] = r; });

      renderRecordsTable(records, role, username);

      // Attach row-click listeners after the table is rendered
      attachRowClickListeners(role, username);
    } catch (err) {
      showToast(err.message || "Failed to load records.", "error");
    }
  }

  // Wire search and filter controls
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadRecords, 350);
    });
  }

  if (typeFilter) {
    typeFilter.addEventListener("change", loadRecords);
  }

  // Logout
  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => logout());
  }

  // Delete confirmation modal
  const deleteModal    = document.getElementById("delete-modal");
  const confirmDeleteBtn = document.getElementById("btn-confirm-delete");

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener("click", async () => {
      if (!pendingDeleteId) return;
      setLoading(confirmDeleteBtn, true);
      try {
        await deleteRecord(pendingDeleteId);
        // Remove the row without a full reload
        if (pendingDeleteRow) {
          const tr = pendingDeleteRow.closest("tr");
          if (tr) tr.remove();
        }
        showToast("Record deleted successfully.", "success");

        // Close modal
        const bsModal = bootstrap.Modal.getInstance(deleteModal);
        if (bsModal) bsModal.hide();

        // Reload to update stats
        loadRecords();
      } catch (err) {
        showToast(err.message || "Failed to delete record.", "error");
      } finally {
        setLoading(confirmDeleteBtn, false);
        pendingDeleteId  = null;
        pendingDeleteRow = null;
      }
    });
  }

  // Initial load
  loadRecords();
}

/**
 * Attach click listeners to every tbody row.
 * Clicks on action buttons stop propagation so they don't trigger navigation.
 */
function attachRowClickListeners(role, username) {
  const tbody = document.getElementById("records-tbody");
  if (!tbody) return;

  tbody.querySelectorAll("tr").forEach((tr) => {
    const recordId = parseInt(tr.dataset.recordId, 10);

    // Stop propagation on action buttons so row click doesn't trigger navigation
    tr.querySelectorAll(".btn-action, .attachment-link").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    });

    tr.addEventListener("click", () => {
      window.location.href = `record-detail.html?id=${recordId}`;
    });
  });
}

/**
 * Handle download attachment button clicks from the table.
 * @param {Event} e
 * @param {number} recordId
 * @param {string} filename
 */
async function handleDownload(e, recordId, filename) {
  e.preventDefault();
  try {
    await downloadAttachment(recordId, filename);
  } catch (err) {
    showToast(err.message || "Failed to download attachment.", "error");
  }
}

/**
 * Handle delete button clicks — show confirmation modal.
 * @param {number} recordId
 * @param {HTMLElement} buttonEl
 */
function handleDeleteClick(recordId, buttonEl) {
  pendingDeleteId  = recordId;
  pendingDeleteRow = buttonEl;

  const deleteModal = document.getElementById("delete-modal");
  if (deleteModal) {
    const bsModal = new bootstrap.Modal(deleteModal);
    bsModal.show();
  }
}

// ---------------------------------------------------------------------------
// FORM PAGE
// ---------------------------------------------------------------------------

/**
 * Initialize the record creation / edit form page.
 * Detects page by checking for #record-form.
 */
async function initFormPage() {
  const form = document.getElementById("record-form");
  if (!form) return;

  guardPage();
  populateNavbar();
  applyNavbarRoleVisibility();

  // Sidebar wiring
  populateSidebar();
  populateTopbarMeta();
  const activeForm = document.getElementById("nav-new-record");
  if (activeForm) activeForm.classList.add("active");

  const role = getRole();

  // Logout (legacy navbar button — kept for compatibility)
  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => logout());
  }

  // Determine create vs. edit mode
  const params   = new URLSearchParams(window.location.search);
  const editId   = params.get("id") ? parseInt(params.get("id"), 10) : null;
  const isEdit   = editId !== null;

  // Update page title and submit button
  const pageTitle = document.getElementById("form-page-title");
  const submitBtn = document.getElementById("btn-submit");
  if (pageTitle) pageTitle.textContent = isEdit ? "Edit Maintenance Record" : "New Maintenance Record";
  if (submitBtn) submitBtn.textContent = isEdit ? "Update Record" : "Save Record";

  // For edit mode, load and pre-populate the form
  if (isEdit) {
    try {
      const records = await getRecords({});
      const record  = records.find((r) => r.id === editId);
      if (record) {
        populateForm(record);
      } else {
        showToast("Record not found.", "error");
      }
    } catch (err) {
      showToast(err.message || "Failed to load record.", "error");
    }
  }

  // File input — show info on selection
  const fileInput   = document.getElementById("field-attachment");
  const fileInfoRow = document.getElementById("file-info-row");
  const fileInfoName = document.getElementById("file-info-name");
  const fileInfoSize = document.getElementById("file-info-size");
  const fileWarning  = document.getElementById("file-warning");

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) {
        if (fileInfoRow) fileInfoRow.classList.remove("visible");
        return;
      }

      if (fileInfoRow)  fileInfoRow.classList.add("visible");
      if (fileInfoName) fileInfoName.textContent = file.name;
      if (fileInfoSize) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
        fileInfoSize.textContent = `${sizeMB} MB`;
      }

      // Show inline warnings for type/size
      const typeResult = validateFileType(file);
      const sizeResult = validateFileSize(file, DEFAULT_MAX_UPLOAD_MB);
      const warnings = [];
      if (!typeResult.valid) warnings.push(typeResult.message);
      if (!sizeResult.valid) warnings.push(sizeResult.message);

      if (fileWarning) {
        fileWarning.textContent = warnings.join(" ");
        fileWarning.style.display = warnings.length ? "block" : "none";
      }
    });
  }

  // Form submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();

    const maintenanceType      = document.getElementById("field-maintenance-type")?.value;
    const equipmentId          = document.getElementById("field-equipment-id")?.value ?? "";
    const responsiblePerson    = document.getElementById("field-responsible-person")?.value ?? "";
    const plannedStart         = document.getElementById("field-planned-start")?.value ?? "";
    const plannedEnd           = document.getElementById("field-planned-end")?.value ?? "";
    const operatingConditions  = document.getElementById("field-operating-conditions")?.value ?? "";
    const inventoryConsumables = document.getElementById("field-inventory-consumables")?.value ?? "";
    const remarks              = document.getElementById("field-remarks")?.value ?? "";
    const file                 = fileInput?.files[0] ?? null;

    // Run all per-field validators and collect errors
    const validations = [
      { fieldId: "field-maintenance-type",      result: validateMaintenanceType(maintenanceType) },
      { fieldId: "field-equipment-id",          result: validateRequired(equipmentId, "Equipment ID") },
      { fieldId: "field-equipment-id",          result: validateMaxLength(equipmentId, MAX_EQUIPMENT_ID_LENGTH, "Equipment ID") },
      { fieldId: "field-responsible-person",    result: validateRequired(responsiblePerson, "Responsible Person") },
      { fieldId: "field-responsible-person",    result: validateMaxLength(responsiblePerson, MAX_RESPONSIBLE_PERSON_LENGTH, "Responsible Person") },
      { fieldId: "field-planned-start",         result: validateDatetimeOptional(plannedStart, "Planned Start") },
      { fieldId: "field-planned-end",           result: validateDatetimeOptional(plannedEnd, "Planned End") },
      { fieldId: "field-operating-conditions",  result: validateMaxLength(operatingConditions, MAX_TEXT_FIELD_LENGTH, "Operating Conditions") },
      { fieldId: "field-inventory-consumables", result: validateMaxLength(inventoryConsumables, MAX_TEXT_FIELD_LENGTH, "Inventory / Consumables") },
      { fieldId: "field-remarks",               result: validateMaxLength(remarks, MAX_REMARKS_LENGTH, "Remarks") },
    ];

    if (file) {
      validations.push({ fieldId: "field-attachment", result: validateFileType(file) });
      validations.push({ fieldId: "field-attachment", result: validateFileSize(file, DEFAULT_MAX_UPLOAD_MB) });
    }

    let hasErrors = false;
    validations.forEach(({ fieldId, result }) => {
      if (!result.valid) {
        showFieldError(fieldId, result.message);
        hasErrors = true;
      }
    });

    // Cross-field: planned_end must not precede planned_start
    const windowResult = validatePlannedWindow(plannedStart, plannedEnd);
    if (!windowResult.valid) {
      showFieldError("field-planned-end", windowResult.message);
      hasErrors = true;
    }

    if (hasErrors) return;

    // Build FormData — field names match the name attributes on the HTML inputs
    const formData = new FormData();
    formData.append("maintenance_type",   maintenanceType);
    formData.append("equipment_id",       equipmentId.trim());
    formData.append("responsible_person", responsiblePerson.trim());
    if (plannedStart)          formData.append("planned_start",          plannedStart);
    if (plannedEnd)            formData.append("planned_end",            plannedEnd);
    if (operatingConditions)   formData.append("operating_conditions",   operatingConditions);
    if (inventoryConsumables)  formData.append("inventory_consumables",  inventoryConsumables);
    if (remarks)               formData.append("remarks",                remarks);
    if (file)                  formData.append("attachment",             file);

    setLoading(submitBtn, true);
    try {
      if (isEdit) {
        await updateRecord(editId, formData);
      } else {
        await createRecord(formData);
      }
      showToast(
        isEdit ? "Record updated successfully." : "Record created successfully.",
        "success"
      );
      setTimeout(() => window.location.replace("dashboard.html"), SUCCESS_REDIRECT_DELAY_MS);
    } catch (err) {
      showToast(err.message || "Failed to save record.", "error");
      setLoading(submitBtn, false);
    }
  });
}

// ---------------------------------------------------------------------------
// MANAGE USERS PAGE
// ---------------------------------------------------------------------------

/**
 * Render the existing users table on manage-users.html.
 * @param {Array} users
 */
function renderUsersTable(users) {
  const tbody = document.getElementById("users-tbody");
  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.innerHTML = "";
    const empty = document.getElementById("users-empty-state");
    if (empty) empty.style.display = "block";
    return;
  }

  const empty = document.getElementById("users-empty-state");
  if (empty) empty.style.display = "none";

  tbody.innerHTML = users.map((u) => {
    const statusClass = u.is_active ? "type-badge-conducted" : "type-badge-planned";
    const statusText  = u.is_active ? "Active" : "Inactive";
    return `
      <tr>
        <td><span class="record-id-badge">#${u.id}</span></td>
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.role)}</td>
        <td><span class="type-badge ${statusClass}">${statusText}</span></td>
      </tr>
    `;
  }).join("");
}

/**
 * Initialize the manage-users page.
 * Detects page by checking for #create-user-form.
 */
async function initManageUsersPage() {
  const form = document.getElementById("create-user-form");
  if (!form) return;

  guardPage();

  // Client-side role guard — server still enforces on the API
  if (getRole() !== ROLES.ADMIN) {
    window.location.replace("dashboard.html");
    return;
  }

  populateNavbar();
  applyNavbarRoleVisibility();

  // Sidebar wiring
  populateSidebar();
  populateTopbarMeta();
  const activeManage = document.getElementById("nav-manage-users");
  if (activeManage) activeManage.classList.add("active");

  // Logout (legacy navbar button — kept for compatibility)
  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => logout());
  }

  const submitBtn = document.getElementById("btn-create-user");

  // Load existing users table
  async function loadUsers() {
    try {
      const users = await getUsers();
      renderUsersTable(users);
    } catch (err) {
      showToast(err.message || "Failed to load users.", "error");
    }
  }

  loadUsers();

  // Form submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();

    const usernameVal  = document.getElementById("new-username")?.value ?? "";
    const passwordVal  = document.getElementById("new-password")?.value ?? "";
    const confirmVal   = document.getElementById("new-confirm-password")?.value ?? "";
    const roleVal      = document.getElementById("new-role")?.value ?? "";

    // Run all validators simultaneously
    const validations = [
      { fieldId: "new-username",          result: validateUsername(usernameVal) },
      { fieldId: "new-password",          result: validatePassword(passwordVal) },
      { fieldId: "new-confirm-password",  result: validateConfirmPassword(passwordVal, confirmVal) },
      { fieldId: "new-role",              result: validateRequired(roleVal, "Role") },
    ];

    let hasErrors = false;
    validations.forEach(({ fieldId, result }) => {
      if (!result.valid) {
        showFieldError(fieldId, result.message);
        hasErrors = true;
      }
    });

    if (hasErrors) return;

    setLoading(submitBtn, true);
    try {
      await createUser({
        username: usernameVal.trim(),
        password: passwordVal,
        role:     roleVal,
      });
      showToast(`User "${usernameVal.trim()}" created successfully.`, "success");
      form.reset();
      clearFieldErrors();
      loadUsers();
    } catch (err) {
      showToast(err.message || "Failed to create user.", "error");
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

// ---------------------------------------------------------------------------
// RECORD DETAIL PAGE
// ---------------------------------------------------------------------------

/** Module-level state for the CSV grid on the detail page. */
let _originalCsvData  = null;  // deep copy at load / after save
let _currentCsvData   = null;  // live working state
let _hasUnsavedChanges = false;
let _recordDetailId   = null;

/**
 * Initialize the record detail page.
 * Detects page by checking for #recordDetailPage.
 */
async function initRecordDetailPage() {
  if (!document.getElementById("recordDetailPage")) return;

  guardPage();
  populateNavbar();
  applyNavbarRoleVisibility();

  // Sidebar wiring
  populateSidebar();
  populateTopbarMeta();
  // No specific nav item is active on the detail page (it's a drill-down)

  const role     = getRole();
  const username = getUsername();

  // Logout (legacy navbar button — kept for compatibility)
  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => logout());
  }

  // Read record id from URL
  const params   = new URLSearchParams(window.location.search);
  const rawId    = params.get("id");
  const recordId = rawId ? parseInt(rawId, 10) : null;
  if (!recordId || isNaN(recordId) || recordId <= 0) {
    window.location.replace("dashboard.html");
    return;
  }
  _recordDetailId = recordId;

  // --- Load record ---
  let record = null;
  try {
    const records = await getRecords({});
    record = records.find((r) => r.id === recordId) || null;
    if (!record) {
      showToast("Record not found.", "error");
      setTimeout(() => window.location.replace("dashboard.html"), 2000);
      return;
    }
  } catch (err) {
    showToast(err.message || "Failed to load record.", "error");
    return;
  }

  // --- Section 1: Populate record fields ---
  _populateDetailFields(record);

  // Populate the record header strip with equipment ID
  const headerIdEl   = document.getElementById("detail-header-id");
  const headerEqpEl  = document.getElementById("detail-header-equipment");
  if (headerIdEl)  headerIdEl.textContent  = "REC-" + record.id;
  if (headerEqpEl) headerEqpEl.textContent = record.equipment_id || "\u2014";

  // Show/hide Edit Record button
  const editBtn = document.getElementById("detail-edit-btn");
  if (editBtn) {
    const canEdit = (role === ROLES.ADMIN) || (role === ROLES.ENGINEER && record.created_by === username);
    if (canEdit) {
      editBtn.classList.remove("d-none");
      editBtn.setAttribute("href", `form.html?id=${recordId}`);
    } else {
      editBtn.classList.add("d-none");
    }
  }

  // --- Section 2: CSV buttons role visibility ---
  const btnUpload   = document.getElementById("btn-csv-upload");
  const btnSave     = document.getElementById("btn-csv-save");
  const btnUndo     = document.getElementById("btn-csv-undo");
  const btnDownload = document.getElementById("btn-csv-download");

  const isViewer = (role === ROLES.VIEWER);

  if (isViewer) {
    if (btnUpload)   btnUpload.classList.add("d-none");
    if (btnSave)     btnSave.classList.add("d-none");
    if (btnUndo)     btnUndo.classList.add("d-none");
  } else {
    if (btnUpload)   btnUpload.classList.remove("d-none");
    if (btnSave)   { btnSave.classList.remove("d-none");   btnSave.disabled  = true; }
    if (btnUndo)   { btnUndo.classList.remove("d-none");   btnUndo.disabled  = true; }
  }

  // Download always hidden initially until we confirm CSV exists
  if (btnDownload) btnDownload.classList.add("d-none");

  // --- Attempt to load existing CSV data ---
  try {
    const csvData = await getCsvData(recordId);
    // Success — CSV exists
    _originalCsvData  = JSON.parse(JSON.stringify(csvData));
    _currentCsvData   = JSON.parse(JSON.stringify(csvData));
    _renderGrid(csvData.headers, csvData.rows, !isViewer);
    _hideCsvPlaceholder();
    if (btnDownload) btnDownload.classList.remove("d-none");
  } catch (err) {
    if (err.message && err.message.includes("404")) {
      // No CSV uploaded yet — show placeholder
      _showCsvPlaceholder();
    } else {
      // Unexpected error — show placeholder and toast
      showToast(err.message || "Failed to load CSV data.", "error");
      _showCsvPlaceholder();
    }
  }

  // --- Wire Upload button ---
  const csvFileInput = document.getElementById("csvFileInput");
  if (btnUpload && csvFileInput) {
    btnUpload.addEventListener("click", () => {
      csvFileInput.click();
    });

    csvFileInput.addEventListener("change", async () => {
      const file = csvFileInput.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append("csv_file", file);

      setLoading(btnUpload, true);
      try {
        const result = await uploadCsv(recordId, formData);
        _originalCsvData  = JSON.parse(JSON.stringify({ headers: result.headers, rows: result.rows }));
        _currentCsvData   = JSON.parse(JSON.stringify({ headers: result.headers, rows: result.rows }));
        _hasUnsavedChanges = false;
        _renderGrid(result.headers, result.rows, !isViewer);
        _hideCsvPlaceholder();
        if (btnDownload) btnDownload.classList.remove("d-none");
        if (btnSave)     btnSave.disabled  = true;
        if (btnUndo)     btnUndo.disabled  = true;
        showToast(`CSV uploaded successfully. ${result.row_count} rows, ${result.col_count} columns.`, "success");
      } catch (err) {
        showToast(err.message || "Failed to upload CSV.", "error");
      } finally {
        setLoading(btnUpload, false);
        csvFileInput.value = "";
      }
    });
  }

  // --- Wire Save button ---
  if (btnSave) {
    btnSave.addEventListener("click", async () => {
      if (!_currentCsvData) return;
      setLoading(btnSave, true);
      try {
        const saved = await saveCsvData(recordId, _currentCsvData);
        _originalCsvData  = JSON.parse(JSON.stringify({ headers: saved.headers, rows: saved.rows }));
        _hasUnsavedChanges = false;
        if (btnSave) btnSave.disabled = true;
        if (btnUndo) btnUndo.disabled = true;
        showToast("CSV changes saved successfully.", "success");
      } catch (err) {
        showToast(err.message || "Failed to save CSV data.", "error");
      } finally {
        setLoading(btnSave, false);
      }
    });
  }

  // --- Wire Undo button ---
  if (btnUndo) {
    btnUndo.addEventListener("click", () => {
      if (!_originalCsvData) return;
      _currentCsvData    = JSON.parse(JSON.stringify(_originalCsvData));
      _hasUnsavedChanges = false;
      _renderGrid(_originalCsvData.headers, _originalCsvData.rows, !isViewer);
      if (btnSave) btnSave.disabled = true;
      if (btnUndo) btnUndo.disabled = true;
    });
  }

  // --- Wire Download button ---
  if (btnDownload) {
    btnDownload.addEventListener("click", async () => {
      try {
        await downloadCsv(recordId);
      } catch (err) {
        showToast(err.message || "Failed to download CSV.", "error");
      }
    });
  }

  // --- beforeunload guard ---
  window.addEventListener("beforeunload", (e) => {
    if (_hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = "You have unsaved changes. Leave anyway?";
    }
  });
}

/**
 * Format an ISO date string for human-readable display.
 * Returns '—' for null/undefined/empty or unparsable values.
 * Reused by both the detail page and the records table in ui.js.
 * @param {string|null|undefined} isoString
 * @returns {string}
 */
function formatDisplayDate(isoString) {
  if (!isoString) return "\u2014";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "\u2014";
  return date.toLocaleString();
}

/**
 * Set a detail-page field's textContent by element ID.
 * Reused for all definition-grid fields to consolidate repeated getElementById patterns.
 * @param {string} elementId
 * @param {string} value
 */
function setDetailField(elementId, value) {
  const el = document.getElementById(elementId);
  if (el) el.textContent = value || "\u2014";
}

/**
 * Populate Section 1 record fields using textContent / setAttribute only.
 * @param {object} record
 */
function _populateDetailFields(record) {
  const nullish = (v) => (v !== null && v !== undefined && v !== "") ? v : "\u2014";
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = nullish(value);
  };

  set("detail-id",                    record.id);
  set("detail-maintenance-type",      record.maintenance_type);
  set("detail-equipment-id",          record.equipment_id);
  set("detail-responsible-person",    record.responsible_person);
  set("detail-operating-conditions",  record.operating_conditions);
  set("detail-inventory-consumables", record.inventory_consumables);
  set("detail-remarks",               record.remarks);
  set("detail-created-by",            record.created_by);
  set("detail-created-date",          record.created_date);
  set("detail-updated-by",            record.updated_by);
  set("detail-updated-date",          record.updated_date);

  // Four new time fields — all formatted consistently via formatDisplayDate()
  setDetailField("detail-created-time",      formatDisplayDate(record.created_time));
  setDetailField("detail-planned-start",     formatDisplayDate(record.planned_start));
  setDetailField("detail-planned-end",       formatDisplayDate(record.planned_end));
  setDetailField("detail-last-updated-time", formatDisplayDate(record.last_updated_time));

  // Attachment — use setAttribute, never innerHTML
  const attachEl = document.getElementById("detail-attachment");
  if (attachEl) {
    attachEl.textContent = "";
    if (record.attachment_original_name) {
      const link = document.createElement("a");
      link.setAttribute("href", "#");
      link.textContent = record.attachment_original_name;
      link.className = "attachment-link";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        handleDownload(e, record.id, record.attachment_original_name);
      });
      attachEl.appendChild(link);
    } else {
      attachEl.textContent = "\u2014";
    }
  }
}

/**
 * Render (or re-render) the CSV grid inside the csv-grid-container.
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {boolean} isEditable
 */
function _renderGrid(headers, rows, isEditable) {
  const container = document.getElementById("csv-grid-container");
  if (!container) return;

  // Remove any existing grid
  const existing = container.querySelector(".csv-grid-wrapper");
  if (existing) existing.remove();

  const table   = renderCsvGrid(headers, rows, isEditable);
  const wrapper = document.createElement("div");
  wrapper.className = "csv-grid-wrapper";
  wrapper.appendChild(table);
  container.appendChild(wrapper);

  if (isEditable) {
    // Listen for input events on editable cells
    table.addEventListener("input", (e) => {
      if (e.target.tagName !== "TD") return;
      const btnSave = document.getElementById("btn-csv-save");
      const btnUndo = document.getElementById("btn-csv-undo");

      // Read all cell values back from the DOM into _currentCsvData
      const trs = table.querySelectorAll("tbody tr");
      _currentCsvData.rows = Array.from(trs).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => td.textContent)
      );

      _hasUnsavedChanges = true;
      if (btnSave) btnSave.disabled = false;
      if (btnUndo) btnUndo.disabled = false;
    });
  }
}

/** Show the no-CSV placeholder. */
function _showCsvPlaceholder() {
  const placeholder = document.getElementById("csv-placeholder");
  if (placeholder) placeholder.classList.remove("d-none");
}

/** Hide the no-CSV placeholder. */
function _hideCsvPlaceholder() {
  const placeholder = document.getElementById("csv-placeholder");
  if (placeholder) placeholder.classList.add("d-none");
}

// ---------------------------------------------------------------------------
// Bootstrap — auto-detect and initialize the correct page
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  initLoginPage();
  initDashboardPage();
  initFormPage();
  initManageUsersPage();
  initRecordDetailPage();
});
