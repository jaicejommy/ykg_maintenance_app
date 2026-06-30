/**
 * frontend/js/ui.js
 * DOM manipulation helpers — no business logic or API calls.
 * Pure presentation layer functions.
 */

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------

/**
 * Render a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const iconMap = {
    success: "✓",
    error:   "✕",
    info:    "ℹ",
  };

  const toast = document.createElement("div");
  toast.className = `app-toast app-toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${iconMap[type] || "ℹ"}</span>
    <div class="toast-body">
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-dismiss" aria-label="Dismiss">✕</button>
  `;

  const dismissBtn = toast.querySelector(".toast-dismiss");
  dismissBtn.addEventListener("click", () => dismissToast(toast));

  container.appendChild(toast);

  // Auto-dismiss
  setTimeout(() => dismissToast(toast), TOAST_DURATION_MS);
}

/**
 * Animate and remove a toast element.
 * @param {HTMLElement} toastEl
 */
function dismissToast(toastEl) {
  if (!toastEl || !toastEl.parentNode) return;
  toastEl.classList.add("toast-fade-out");
  setTimeout(() => {
    if (toastEl.parentNode) {
      toastEl.parentNode.removeChild(toastEl);
    }
  }, 300);
}

/**
 * Escape HTML special characters to prevent XSS in innerHTML contexts.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Form field error rendering
// ---------------------------------------------------------------------------

/**
 * Render an inline validation error below a form field.
 * @param {string} fieldId - The id of the input/select/textarea element
 * @param {string} message
 */
function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;

  field.classList.add("is-invalid");

  const errorElId = `${fieldId}-error`;
  let errorEl = document.getElementById(errorElId);
  if (!errorEl) {
    errorEl = document.createElement("div");
    errorEl.id = errorElId;
    errorEl.className = "field-error";
    field.parentNode.insertBefore(errorEl, field.nextSibling);
  }
  errorEl.textContent = message;
  errorEl.classList.add("visible");
}

/**
 * Clear all inline validation error states on the page.
 */
function clearFieldErrors() {
  document.querySelectorAll(".is-invalid").forEach((el) => {
    el.classList.remove("is-invalid");
  });
  document.querySelectorAll(".field-error").forEach((el) => {
    el.textContent = "";
    el.classList.remove("visible");
  });
}

// ---------------------------------------------------------------------------
// Button loading state
// ---------------------------------------------------------------------------

/**
 * Toggle the loading state of a button.
 * @param {HTMLButtonElement} buttonEl
 * @param {boolean} isLoading
 */
function setLoading(buttonEl, isLoading) {
  if (!buttonEl) return;

  if (isLoading) {
    buttonEl.disabled = true;
    buttonEl.dataset.originalText = buttonEl.innerHTML;
    buttonEl.innerHTML = `
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      Processing...
    `;
  } else {
    buttonEl.disabled = false;
    if (buttonEl.dataset.originalText) {
      buttonEl.innerHTML = buttonEl.dataset.originalText;
    }
  }
}

// ---------------------------------------------------------------------------
// Navbar user info
// ---------------------------------------------------------------------------

/**
 * Populate the navbar user badge with username and role.
 * Expects elements with ids: navbar-username, navbar-role, navbar-avatar-initials
 */
function populateNavbar() {
  const username = getUsername();
  const role     = getRole();

  const usernameEl = document.getElementById("navbar-username");
  const roleEl     = document.getElementById("navbar-role");
  const avatarEl   = document.getElementById("navbar-avatar-initials");

  if (usernameEl) usernameEl.textContent = username || "";
  if (roleEl)     roleEl.textContent     = role || "";
  if (avatarEl && username) {
    avatarEl.textContent = username.charAt(0).toUpperCase();
  }
}

// ---------------------------------------------------------------------------
// Records table rendering
// ---------------------------------------------------------------------------

/**
 * Build and inject table rows for maintenance records.
 * Conditionally renders Edit/Delete buttons based on user role and ownership.
 * Uses appendCell() and formatDisplayDate() helpers throughout — no innerHTML with record data.
 * @param {Array<object>} records
 * @param {string} userRole
 * @param {string} username
 */
function renderRecordsTable(records, userRole, username) {
  const tbody = document.getElementById("records-tbody");
  const emptyState = document.getElementById("empty-state");
  const statsTotal = document.getElementById("stat-total");
  const statPlanned = document.getElementById("stat-planned");
  const statConducted = document.getElementById("stat-conducted");

  if (!tbody) return;

  // Update stats
  if (statsTotal)    statsTotal.textContent    = records.length;
  if (statPlanned)   statPlanned.textContent   = records.filter(r => r.maintenance_type === "Planned").length;
  if (statConducted) statConducted.textContent = records.filter(r => r.maintenance_type === "Conducted").length;

  if (records.length === 0) {
    tbody.textContent = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  const isAdmin    = userRole === ROLES.ADMIN;
  const isEngineer = userRole === ROLES.ENGINEER;

  // Clear existing rows safely (no innerHTML on tbody itself)
  tbody.textContent = "";

  records.forEach((record) => {
    const row = document.createElement("tr");
    row.dataset.recordId = record.id;

    // # (record id badge)
    const idTd = document.createElement("td");
    const idBadge = document.createElement("span");
    idBadge.className = "record-id-badge";
    idBadge.textContent = "#" + record.id;
    idTd.appendChild(idBadge);
    row.appendChild(idTd);

    // Created Time — before Equipment ID per spec
    appendCell(row, formatDisplayDate(record.created_time));

    // Equipment ID
    appendCell(row, record.equipment_id);

    // Type — with badge styling
    const typeTd = document.createElement("td");
    const typeBadge = document.createElement("span");
    typeBadge.className = "type-badge " + (record.maintenance_type === "Planned"
      ? "type-badge-planned"
      : "type-badge-conducted");
    typeBadge.textContent = record.maintenance_type;
    typeTd.appendChild(typeBadge);
    row.appendChild(typeTd);

    // Responsible Person
    appendCell(row, record.responsible_person);

    // Planned Start — after Responsible Person per spec
    appendCell(row, formatDisplayDate(record.planned_start));

    // Planned End — after Planned Start per spec
    appendCell(row, formatDisplayDate(record.planned_end));

    // Last Updated — after Planned End per spec
    appendCell(row, formatDisplayDate(record.last_updated_time));

    // Attachment cell — link or dash; uses setAttribute/textContent, never innerHTML
    const attachTd = document.createElement("td");
    if (record.attachment_original_name) {
      const link = document.createElement("a");
      link.setAttribute("href", "#");
      link.className = "attachment-link";
      link.textContent = record.attachment_original_name;
      link.addEventListener("click", (e) => {
        e.stopPropagation();
        handleDownload(e, record.id, record.attachment_original_name);
      });
      attachTd.appendChild(link);
    } else {
      const dash = document.createElement("span");
      dash.className = "attachment-dash";
      dash.textContent = "\u2014";
      attachTd.appendChild(dash);
    }
    row.appendChild(attachTd);

    // Created By
    const createdByTd = document.createElement("td");
    createdByTd.className = "text-muted-custom";
    createdByTd.textContent = record.created_by || "\u2014";
    row.appendChild(createdByTd);

    // Actions cell
    const canEdit   = isAdmin || (isEngineer && record.created_by === username);
    const canDelete = isAdmin;

    const actionsTd = document.createElement("td");
    if (canEdit || canDelete) {
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "actions-cell d-flex gap-1";

      if (canEdit) {
        const editLink = document.createElement("a");
        editLink.setAttribute("href", `form.html?id=${record.id}`);
        editLink.className = "btn-action btn-action-edit";
        editLink.textContent = "Edit";
        actionsDiv.appendChild(editLink);
      }

      if (canDelete) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn-action btn-action-delete";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          handleDeleteClick(record.id, deleteBtn);
        });
        actionsDiv.appendChild(deleteBtn);
      }

      actionsTd.appendChild(actionsDiv);
    } else {
      const dash = document.createElement("span");
      dash.className = "text-muted-custom";
      dash.textContent = "\u2014";
      actionsTd.appendChild(dash);
    }
    row.appendChild(actionsTd);

    tbody.appendChild(row);
  });
}

/**
 * Append a plain-text table cell to a row.
 * Using textContent only — never innerHTML — prevents XSS from record data.
 * @param {HTMLTableRowElement} row
 * @param {string|null|undefined} text
 */
function appendCell(row, text) {
  const td = document.createElement("td");
  td.textContent = text || "\u2014";
  row.appendChild(td);
}

/**
 * Format an ISO date string for table cell display.
 * Returns '—' for null/undefined/empty/unparsable values.
 * @param {string|null|undefined} isoString
 * @returns {string}
 */
function formatDisplayDate(isoString) {
  if (!isoString) return "\u2014";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "\u2014";
  return date.toLocaleString();
}

// ---------------------------------------------------------------------------
// Form population (edit mode)
// ---------------------------------------------------------------------------

/**
 * Populate the form.html fields from an existing record object.
 * @param {object} record
 */
function populateForm(record) {
  const setValue = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? "";
  };

  setValue("field-maintenance-type", record.maintenance_type);
  setValue("field-equipment-id",     record.equipment_id);
  setValue("field-responsible-person", record.responsible_person);
  setValue("field-operating-conditions", record.operating_conditions);
  setValue("field-inventory-consumables", record.inventory_consumables);
  setValue("field-remarks", record.remarks);

  // datetime-local inputs require "YYYY-MM-DDTHH:mm" format
  const toDatetimeLocal = (isoString) => {
    if (!isoString) return "";
    const dt = new Date(isoString);
    if (isNaN(dt.getTime())) return isoString;
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  };

  setValue("field-planned-start", toDatetimeLocal(record.planned_start));
  setValue("field-planned-end",   toDatetimeLocal(record.planned_end));

  // Show existing attachment info
  if (record.attachment_original_name) {
    const fileInfo = document.getElementById("file-info-row");
    const fileName = document.getElementById("file-info-name");
    const currentAttach = document.getElementById("current-attachment");
    if (fileInfo)     fileInfo.classList.add("visible");
    if (fileName)     fileName.textContent = record.attachment_original_name + " (existing)";
    if (currentAttach) currentAttach.textContent = record.attachment_original_name;
  }
}

// ---------------------------------------------------------------------------
// Record detail modal
// ---------------------------------------------------------------------------

/**
 * Populate and open the #recordDetailModal for a given record.
 * Uses textContent and setAttribute only — no innerHTML with record data.
 * @param {object} record
 * @param {string} userRole
 * @param {string} username
 */
function showRecordDetail(record, userRole, username) {
  const modal = document.getElementById("recordDetailModal");
  if (!modal) return;

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

  // Attachment — use setAttribute, never innerHTML
  const attachEl = document.getElementById("detail-attachment");
  if (attachEl) {
    attachEl.textContent = "";
    if (record.attachment_original_name) {
      const link = document.createElement("a");
      link.setAttribute("href", `${API_BASE}/api/attachments/${record.id}`);
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

  // Edit button visibility
  const isAdmin    = userRole === ROLES.ADMIN;
  const isEngineer = userRole === ROLES.ENGINEER;
  const canEdit    = isAdmin || (isEngineer && record.created_by === username);

  const editBtn = document.getElementById("detail-btn-edit");
  if (editBtn) {
    if (canEdit) {
      editBtn.classList.remove("d-none");
      editBtn.setAttribute("href", `form.html?id=${record.id}`);
    } else {
      editBtn.classList.add("d-none");
    }
  }

  new bootstrap.Modal(modal).show();
}

// ---------------------------------------------------------------------------
// CSV grid rendering
// ---------------------------------------------------------------------------

/**
 * Build and return an editable CSV grid <table> element.
 * Uses document.createElement only — never innerHTML — so no XSS risk from user data.
 *
 * @param {string[]}   headers    - Array of column header strings
 * @param {string[][]} rows       - Array of data rows (each row is an array of cell strings)
 * @param {boolean}    isEditable - If true, every <td> gets contenteditable="true"
 * @returns {HTMLTableElement}    - The constructed table; caller appends it to the DOM
 */
function renderCsvGrid(headers, rows, isEditable) {
  const table = document.createElement("table");
  table.className = "table table-bordered table-sm csv-grid";
  table.setAttribute("role", "grid");
  table.setAttribute("aria-label", "CSV data grid");

  // --- <thead> ---
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  headers.forEach((headerText) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = headerText;
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // --- <tbody> ---
  const tbody = document.createElement("tbody");

  rows.forEach((rowData, rowIndex) => {
    const tr = document.createElement("tr");

    rowData.forEach((cellValue, colIndex) => {
      const td = document.createElement("td");
      td.textContent = cellValue;

      if (isEditable) {
        td.setAttribute("contenteditable", "true");
        td.setAttribute("aria-label", `Row ${rowIndex + 1}, Column ${colIndex + 1}`);
        // Prevent paste of HTML — handle paste as plain text
        td.addEventListener("paste", (e) => {
          e.preventDefault();
          const text = (e.clipboardData || window.clipboardData).getData("text/plain");
          document.execCommand("insertText", false, text);
        });
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}
