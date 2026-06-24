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
      togglePwdBtn.textContent = isText ? "👁" : "🙈";
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
// DASHBOARD PAGE
// ---------------------------------------------------------------------------

let pendingDeleteId   = null;
let pendingDeleteRow  = null;

/**
 * Initialize the dashboard page.
 * Detects page by checking for #records-tbody.
 */
function initDashboardPage() {
  if (!document.getElementById("records-tbody")) return;

  guardPage();
  populateNavbar();

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
      renderRecordsTable(records, role, username);
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
// Bootstrap — auto-detect and initialize the correct page
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  initLoginPage();
  initDashboardPage();
  initFormPage();
});
