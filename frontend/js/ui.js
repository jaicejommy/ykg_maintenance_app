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
 *
 * The Attachment column now shows a file count (record.attachment_count) instead of a
 * single download link, since records can now have multiple attachments.
 *
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

    // ── Checkbox cell — first column, used by bulk-action selection logic ──
    const checkboxTd = document.createElement("td");
    checkboxTd.className = "col-checkbox";
    const checkbox = document.createElement("input");
    checkbox.type  = "checkbox";
    checkbox.className = "record-checkbox";
    checkbox.setAttribute("data-record-id", String(record.id));
    checkbox.setAttribute("aria-label", "Select record " + record.id);
    checkboxTd.appendChild(checkbox);
    row.appendChild(checkboxTd);

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

    // Attachment count cell — shows "N file(s)" or "—"; no download link
    // (users click the row to reach the detail page where individual files are listed).
    const attachTd = document.createElement("td");
    const attachCount = record.attachment_count || 0;
    if (attachCount > 0) {
      const countSpan = document.createElement("span");
      countSpan.className = "attachment-count-badge";
      countSpan.textContent = attachCount === 1 ? "1 file" : `${attachCount} files`;
      attachTd.appendChild(countSpan);
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
 * Only populates text/select/textarea fields. Existing attachment display is
 * handled separately by renderExistingAttachments() in app.js.
 * @param {object} record
 */
function populateForm(record) {
  const setValue = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? "";
  };

  setValue("field-maintenance-type", record.maintenance_type);
  // equipment_id is pre-populated via setEquipmentDropdownValue() in app.js
  // (the old free-text #field-equipment-id has been replaced by a searchable dropdown)
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
}

// ---------------------------------------------------------------------------
// Record detail modal (legacy helper — kept for compatibility)
// ---------------------------------------------------------------------------

/**
 * Populate and open the #recordDetailModal for a given record.
 * Uses textContent and setAttribute only — no innerHTML with record data.
 * The attachment panel now shows a file count rather than a single download link.
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

  // Attachment — show count only (individual downloads available on detail page)
  const attachEl = document.getElementById("detail-attachment");
  if (attachEl) {
    const count = record.attachment_count || 0;
    attachEl.textContent = count > 0
      ? (count === 1 ? "1 file" : `${count} files`)
      : "\u2014";
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
// Users table rendering (Change 2.4)
// ---------------------------------------------------------------------------

/**
 * Build and inject table rows for the existing users table on manage-users.html.
 * Uses createElement and textContent exclusively — never innerHTML with user data.
 *
 * The row for the currently logged-in Administrator has its Action buttons replaced
 * with "(Your Account)" and disabled — this is the client-side mirror of the backend
 * safeguard; the server-side check is the actual security boundary.
 *
 * @param {Array<object>} users - Array of user objects from GET /api/users
 * @param {string} currentUsername - Username of the currently logged-in Administrator
 * @param {function} onToggleClick - Callback(user) invoked when Activate/Deactivate is clicked
 * @param {function} onResetPasswordClick - Callback(user) invoked when Reset Password is clicked
 */
function renderUsersTable(users, currentUsername, onToggleClick, onResetPasswordClick) {
  const tbody = document.getElementById("users-tbody");
  const emptyState = document.getElementById("users-empty-state");

  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.textContent = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }

  if (emptyState) emptyState.style.display = "none";

  // Clear existing rows safely
  tbody.textContent = "";

  users.forEach((user, index) => {
    const row = document.createElement("tr");

    // # column
    const idTd = document.createElement("td");
    const idBadge = document.createElement("span");
    idBadge.className = "record-id-badge";
    idBadge.textContent = "#" + user.id;
    idTd.appendChild(idBadge);
    row.appendChild(idTd);

    // Username column
    const usernameTd = document.createElement("td");
    usernameTd.textContent = user.username;
    row.appendChild(usernameTd);

    // Role column
    const roleTd = document.createElement("td");
    roleTd.textContent = user.role;
    row.appendChild(roleTd);

    // Status column — badge styled via CSS variables
    const statusTd = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = "type-badge " + (user.is_active ? "type-badge-conducted" : "type-badge-planned");
    statusBadge.textContent = user.is_active ? "Active" : "Deactivated";
    statusTd.appendChild(statusBadge);
    row.appendChild(statusTd);

    // Actions column
    const actionTd = document.createElement("td");
    const isOwnAccount = (user.username === currentUsername);

    if (isOwnAccount) {
      // Disabled placeholder — no action on own account (client-side mirror of server guard)
      const ownLabel = document.createElement("span");
      ownLabel.className = "text-muted-custom";
      ownLabel.style.fontSize = "var(--font-size-sm)";
      ownLabel.textContent = "(Your Account)";
      actionTd.appendChild(ownLabel);
    } else {
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "d-flex gap-1";

      // Activate / Deactivate toggle button
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "btn btn-sm btn-outline-secondary";
      toggleBtn.textContent = user.is_active ? "Deactivate" : "Activate";
      toggleBtn.addEventListener("click", () => {
        if (onToggleClick) onToggleClick(user);
      });
      actionsDiv.appendChild(toggleBtn);

      // Reset Password button — hidden for own account (handled above),
      // visible for all other users
      const resetBtn = document.createElement("button");
      resetBtn.className = "btn btn-sm btn-outline-secondary";
      resetBtn.textContent = "Reset Password";
      resetBtn.addEventListener("click", () => {
        if (onResetPasswordClick) onResetPasswordClick(user);
      });
      actionsDiv.appendChild(resetBtn);

      actionTd.appendChild(actionsDiv);
    }

    row.appendChild(actionTd);
    tbody.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Double-confirmation modal — shared between Change 2 and Change 3 (Change 3.2)
// ---------------------------------------------------------------------------

/**
 * Open the shared #type-to-confirm-modal and drive the two-step confirmation flow.
 *
 * Step 1: Shows a summary message with Cancel and Continue buttons.
 * Step 2 (in-place transformation): Shows a type-to-confirm input. The finalConfirmBtn
 *         stays disabled until the typed value exactly matches confirmTargetText (case-sensitive).
 *
 * This single function powers both the user deactivation/activation flow (Change 2)
 * and the user creation flow (Change 3). It does NOT power the record delete flow
 * (Change 1) — that uses a simpler single-step confirmation modal in form.html.
 *
 * @param {object} options
 * @param {string} options.title              - Modal title text
 * @param {string} options.message            - Step 1 body message (plain text, set via textContent)
 * @param {string} options.confirmTargetText  - The exact string the user must type in Step 2
 * @param {string} options.confirmButtonLabel - Label for the final confirm button in Step 2
 * @param {function} options.onConfirmed      - Async callback invoked after typed confirmation matches
 */
function openTypeToConfirmModal({
  title,
  message,
  confirmTargetText,
  confirmButtonLabel,
  onConfirmed,
}) {
  const modalEl = document.getElementById("type-to-confirm-modal");
  if (!modalEl) return;

  // Retrieve shared sub-elements
  const titleEl    = document.getElementById("type-to-confirm-modal-title");
  const step1Body  = document.getElementById("confirm-modal-step1-body");
  const step2Body  = document.getElementById("confirm-modal-step2-body");
  const footer     = document.getElementById("confirm-modal-footer");
  const targetSpan = document.getElementById("confirmUsernameTarget");
  const inputEl    = document.getElementById("confirmUsernameInput");

  if (!titleEl || !step1Body || !step2Body || !footer || !targetSpan || !inputEl) return;

  // ── Reset modal to Step 1 state ──
  titleEl.textContent = title;

  // Clear and populate Step 1 body using textContent (never innerHTML with data)
  step1Body.textContent = "";
  const msgP = document.createElement("p");
  msgP.textContent = message;
  step1Body.appendChild(msgP);

  step1Body.classList.remove("d-none");
  step2Body.classList.add("d-none");

  // Reset Step 2 input
  inputEl.value = "";
  targetSpan.textContent = confirmTargetText;

  // ── Build Step 1 footer: Cancel + Continue ──
  footer.textContent = "";

  const cancelBtn1 = document.createElement("button");
  cancelBtn1.type = "button";
  cancelBtn1.className = "btn btn-secondary";
  cancelBtn1.setAttribute("data-bs-dismiss", "modal");
  cancelBtn1.textContent = "Cancel";
  footer.appendChild(cancelBtn1);

  const continueBtn = document.createElement("button");
  continueBtn.type = "button";
  continueBtn.className = "btn btn-primary";
  continueBtn.textContent = "Continue";
  footer.appendChild(continueBtn);

  // ── Step 1 → Step 2 transformation on Continue ──
  continueBtn.addEventListener("click", () => {
    // Transform body in-place
    step1Body.classList.add("d-none");
    step2Body.classList.remove("d-none");

    // Reset and focus the input
    inputEl.value = "";
    inputEl.focus();

    // ── Build Step 2 footer: Cancel + disabled Confirm ──
    footer.textContent = "";

    const cancelBtn2 = document.createElement("button");
    cancelBtn2.type = "button";
    cancelBtn2.className = "btn btn-secondary";
    cancelBtn2.setAttribute("data-bs-dismiss", "modal");
    cancelBtn2.textContent = "Cancel";
    footer.appendChild(cancelBtn2);

    const finalConfirmBtn = document.createElement("button");
    finalConfirmBtn.type = "button";
    finalConfirmBtn.className = "btn btn-danger";
    finalConfirmBtn.id = "finalConfirmBtn";
    finalConfirmBtn.textContent = confirmButtonLabel;
    finalConfirmBtn.disabled = true;
    footer.appendChild(finalConfirmBtn);

    // Enable final button only when typed value exactly matches — case-sensitive
    const onInput = () => {
      finalConfirmBtn.disabled = (inputEl.value !== confirmTargetText);
    };
    inputEl.addEventListener("input", onInput);

    // ── Final confirm click ──
    finalConfirmBtn.addEventListener("click", async () => {
      // Guard: only proceed if match is still exact (defensive)
      if (inputEl.value !== confirmTargetText) return;

      // Close the modal before executing the action
      const bsModal = bootstrap.Modal.getInstance(modalEl);
      if (bsModal) bsModal.hide();

      // Invoke the caller's confirmed callback
      if (onConfirmed) {
        await onConfirmed();
      }
    });
  });

  // ── Clean up input listener when modal is hidden ──
  const onHidden = () => {
    inputEl.removeEventListener("input", () => {});
    modalEl.removeEventListener("hidden.bs.modal", onHidden);
  };
  modalEl.addEventListener("hidden.bs.modal", onHidden);

  // ── Show the modal ──
  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();
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

// ---------------------------------------------------------------------------
// Equipment searchable dropdown
// ---------------------------------------------------------------------------

/**
 * Filter the equipment array and re-render the dropdown list.
 *
 * @param {Array<object>} equipment  - Full equipment array from the API
 * @param {string}        searchTerm - Current text in the visible search input
 * @param {HTMLElement}   listEl     - The <ul> dropdown list element
 * @param {HTMLInputElement} hiddenEl - The hidden input that holds the selected code
 * @param {HTMLInputElement} inputEl  - The visible search input
 */
function filterAndRenderEquipmentList(equipment, searchTerm, listEl, hiddenEl, inputEl) {
  // Clear list safely
  listEl.textContent = "";

  if (!searchTerm) {
    // Empty search — close list and clear the hidden value (selection is ambiguous)
    listEl.classList.remove("open");
    hiddenEl.value = "";
    inputEl.setAttribute("aria-expanded", "false");
    return;
  }

  const lower = searchTerm.toLowerCase();
  const matches = equipment.filter((item) =>
    item.code.toLowerCase().includes(lower)
  );

  if (matches.length === 0) {
    const li = document.createElement("li");
    li.className = "equipment-dropdown-empty";
    li.textContent = "No equipment found.";
    listEl.appendChild(li);
  } else {
    matches.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item.code;
      li.setAttribute("role", "option");
      li.setAttribute("tabindex", "-1"); // required: makes li focusable so e.relatedTarget in focusout points here, not null

      // Mark as selected if this code is already chosen
      if (hiddenEl.value === item.code) {
        li.classList.add("selected");
      }

      li.addEventListener("click", () => {
        hiddenEl.value = item.code;
        inputEl.value  = item.code;
        listEl.classList.remove("open");
        inputEl.setAttribute("aria-expanded", "false");
        // Clear any existing validation error on the equipment field
        clearFieldErrors();
      });

      listEl.appendChild(li);
    });
  }

  listEl.classList.add("open");
  inputEl.setAttribute("aria-expanded", "true");
}

/**
 * Initialise all event listeners for the searchable equipment dropdown.
 *
 * @param {Array<object>}   equipment - Full equipment array from the API
 * @param {HTMLInputElement} inputEl  - The visible search input (#equipmentSearch)
 * @param {HTMLElement}      listEl   - The <ul> dropdown list (#equipmentDropdownList)
 * @param {HTMLInputElement} hiddenEl - The hidden value input (#equipmentId)
 */
function buildEquipmentDropdown(equipment, inputEl, listEl, hiddenEl) {
  if (!inputEl || !listEl || !hiddenEl) return;

  // Re-filter and re-render on every keystroke in the search box
  inputEl.addEventListener("input", () => {
    filterAndRenderEquipmentList(equipment, inputEl.value, listEl, hiddenEl, inputEl);
  });

  // Show the list when the input is focused (if there is already a search term)
  inputEl.addEventListener("focus", () => {
    if (inputEl.value) {
      filterAndRenderEquipmentList(equipment, inputEl.value, listEl, hiddenEl, inputEl);
    }
  });

  // Close the dropdown when focus leaves the wrapper entirely.
  // relatedTarget check prevents premature close when clicking a list item
  // (the click event fires before the blur, so relatedTarget is the <li>).
  const wrapper = inputEl.closest(".equipment-dropdown-wrapper");
  if (wrapper) {
    wrapper.addEventListener("focusout", (e) => {
      if (!wrapper.contains(e.relatedTarget)) {
        listEl.classList.remove("open");
        inputEl.setAttribute("aria-expanded", "false");
      }
    });
  }
}

/**
 * Pre-populate the searchable equipment dropdown in edit mode.
 * Handles deactivated / unrecognised codes gracefully — displays the raw stored
 * value so the edit form never blanks out a previously saved equipment_id.
 *
 * @param {Array<object>}   equipment - Full equipment array from the API
 * @param {string}          code      - The equipment_id stored on the record
 * @param {HTMLInputElement} inputEl  - The visible search input (#equipmentSearch)
 * @param {HTMLInputElement} hiddenEl - The hidden value input (#equipmentId)
 */
function setEquipmentDropdownValue(equipment, code, inputEl, hiddenEl) {
  if (!code) return;

  // Find the matching item — may be absent if the equipment was deactivated
  const found = equipment.find((item) => item.code === code);

  // Whether found or not, display and preserve the stored code value
  if (inputEl)  inputEl.value  = code;
  if (hiddenEl) hiddenEl.value = code;

  // Suppress unused-variable lint — found is used only as a guard
  void found;
}

