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
 * Clicks on action buttons stop propagation so they don't open the modal.
 */
function attachRowClickListeners(role, username) {
  const tbody = document.getElementById("records-tbody");
  if (!tbody) return;

  tbody.querySelectorAll("tr").forEach((tr) => {
    const recordId = parseInt(tr.dataset.recordId, 10);

    // Stop propagation on action buttons so row click doesn't trigger
    tr.querySelectorAll(".btn-action, .attachment-link").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    });

    tr.addEventListener("click", () => {
      const record = _recordsMap[recordId];
      if (record) {
        showRecordDetail(record, role, username);
      }
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

  const role = getRole();

  // Logout
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

    const maintenanceType     = document.getElementById("field-maintenance-type")?.value;
    const equipmentId         = document.getElementById("field-equipment-id")?.value ?? "";
    const dateTime            = document.getElementById("field-date-time")?.value ?? "";
    const responsiblePerson   = document.getElementById("field-responsible-person")?.value ?? "";
    const operatingConditions = document.getElementById("field-operating-conditions")?.value ?? "";
    const inventoryConsumables = document.getElementById("field-inventory-consumables")?.value ?? "";
    const remarks             = document.getElementById("field-remarks")?.value ?? "";
    const file                = fileInput?.files[0] ?? null;

    // Run all validators and collect errors
    const validations = [
      { fieldId: "field-maintenance-type",      result: validateMaintenanceType(maintenanceType) },
      { fieldId: "field-equipment-id",          result: validateRequired(equipmentId, "Equipment ID") },
      { fieldId: "field-equipment-id",          result: validateMaxLength(equipmentId, MAX_EQUIPMENT_ID_LENGTH, "Equipment ID") },
      { fieldId: "field-date-time",             result: validateDatetime(dateTime) },
      { fieldId: "field-responsible-person",    result: validateRequired(responsiblePerson, "Responsible Person") },
      { fieldId: "field-responsible-person",    result: validateMaxLength(responsiblePerson, MAX_RESPONSIBLE_PERSON_LENGTH, "Responsible Person") },
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

    if (hasErrors) return;

    // Build FormData
    const formData = new FormData();
    formData.append("maintenance_type",      maintenanceType);
    formData.append("equipment_id",          equipmentId.trim());
    formData.append("date_time",             dateTime);
    formData.append("responsible_person",    responsiblePerson.trim());
    if (operatingConditions)  formData.append("operating_conditions",  operatingConditions);
    if (inventoryConsumables) formData.append("inventory_consumables", inventoryConsumables);
    if (remarks)              formData.append("remarks",               remarks);
    if (file)                 formData.append("attachment",            file);

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

  // Logout
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
// Bootstrap — auto-detect and initialize the correct page
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  initLoginPage();
  initDashboardPage();
  initFormPage();
  initManageUsersPage();
});
