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
    tbody.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  const isAdmin    = userRole === ROLES.ADMIN;
  const isEngineer = userRole === ROLES.ENGINEER;

  tbody.innerHTML = records.map((record) => {
    const typeBadgeClass = record.maintenance_type === "Planned"
      ? "type-badge-planned"
      : "type-badge-conducted";

    const attachmentCell = record.attachment_original_name
      ? `<a href="#" class="attachment-link"
           onclick="handleDownload(event, ${record.id}, '${escapeHtml(record.attachment_original_name)}')">
           📎 ${escapeHtml(record.attachment_original_name)}
         </a>`
      : `<span class="attachment-dash">—</span>`;

    // Determine which action buttons to show
    const canEdit = isAdmin || (isEngineer && record.created_by === username);
    const canDelete = isAdmin;

    const editBtn = canEdit
      ? `<a href="form.html?id=${record.id}" class="btn-action btn-action-edit">✏ Edit</a>`
      : "";

    const deleteBtn = canDelete
      ? `<button class="btn-action btn-action-delete"
            onclick="handleDeleteClick(${record.id}, this)">🗑 Delete</button>`
      : "";

    const actionsCell = (editBtn || deleteBtn)
      ? `<div class="actions-cell d-flex gap-1">${editBtn}${deleteBtn}</div>`
      : `<span class="text-muted-custom">—</span>`;

    // Format datetime for display
    const displayDate = record.date_time
      ? new Date(record.date_time).toLocaleString("en-GB", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        })
      : record.date_time;

    return `
      <tr data-record-id="${record.id}">
        <td><span class="record-id-badge">#${record.id}</span></td>
        <td>${escapeHtml(record.equipment_id)}</td>
        <td><span class="type-badge ${typeBadgeClass}">${escapeHtml(record.maintenance_type)}</span></td>
        <td>${escapeHtml(displayDate)}</td>
        <td>${escapeHtml(record.responsible_person)}</td>
        <td>${attachmentCell}</td>
        <td class="text-muted-custom">${escapeHtml(record.created_by)}</td>
        <td>${actionsCell}</td>
      </tr>
    `;
  }).join("");
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

  // Datetime-local requires "YYYY-MM-DDTHH:mm" format
  if (record.date_time) {
    const dt = new Date(record.date_time);
    if (!isNaN(dt.getTime())) {
      const pad = (n) => String(n).padStart(2, "0");
      const local = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      setValue("field-date-time", local);
    } else {
      setValue("field-date-time", record.date_time);
    }
  }

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
