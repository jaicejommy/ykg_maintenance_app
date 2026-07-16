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
 * Also calls initChangePasswordModal() to wire the avatar click handler
 * on every protected page.
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

  // New mobile elements — same logic, different IDs
  const mobileAvatarEl = document.getElementById("mobileUserAvatar");
  if (mobileAvatarEl && username) {
      mobileAvatarEl.textContent = username.charAt(0).toUpperCase();
  }

  // Show/hide Manage Users sidebar item based on role
  const manageUsersItem = document.getElementById("nav-manage-users-item");
  if (manageUsersItem) {
    manageUsersItem.classList.toggle("d-none", role !== ROLES.ADMIN);
  }

  // Hide New Record sidebar item for Viewers
  const newRecordNavItem = document.getElementById("nav-new-record-item");
  if (newRecordNavItem) {
    newRecordNavItem.classList.toggle("d-none", role === ROLES.VIEWER);
  }

  const trashNavItem = document.getElementById('nav-trash-item');
  if (trashNavItem) {
      trashNavItem.classList.toggle('d-none', role !== ROLES.ADMIN);
  }

  // Wire sidebar logout button
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearSession();
      window.location.href = "index.html";
    });
  }

  // New mobile logout — same action
  const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
  if (mobileLogoutBtn) {
    mobileLogoutBtn.addEventListener("click", () => {
      clearSession();
      window.location.href = "index.html";
    });
  }

  // Wire the avatar → change-password modal on every protected page
  initChangePasswordModal();
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
// CHANGE PASSWORD MODAL (self-service — all authenticated roles)
// ---------------------------------------------------------------------------

/**
 * Wire the change-password modal on every protected page.
 * Called from populateSidebar() so it runs once per page load.
 *
 * Flow:
 *   1. #sidebarUserAvatar click → open modal, clear all fields and errors.
 *   2. #changePasswordSubmitBtn click → client-side validate all fields
 *      simultaneously, then call api.changePassword() only if all pass.
 *   3. On success: close modal, clear fields, show success toast.
 *   4. On failure: show server detail toast, keep modal open.
 *   5. hidden.bs.modal event → clear all field values and error states.
 *
 * Password values are only ever assigned via .value property on input elements
 * (never innerHTML). All error messages are set via showFieldError() which uses
 * textContent internally.
 */
function initChangePasswordModal() {
  const modalEl   = document.getElementById("changePasswordModal");
  const avatarEl  = document.getElementById("sidebarUserAvatar");
  const submitBtn = document.getElementById("changePasswordSubmitBtn");

  // Guard: modal must be present on the page (all protected pages have it)
  if (!modalEl) return;

  // ── Helper: clear all fields and error states in the modal ──
  function clearModalFields() {
    const fields = ["currentPassword", "newPassword", "confirmNewPassword"];
    fields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
      // Clear is-invalid on the input
      if (el) el.classList.remove("is-invalid");
      // Clear the error span
      const errEl = document.getElementById(id + "-error");
      if (errEl) {
        errEl.textContent = "";
        errEl.classList.remove("visible");
      }
    });
  }

  function _openChangePasswordModal() {
    clearModalFields();
    const bsModal = new bootstrap.Modal(modalEl);
    bsModal.show();
  }

  // ── 1. Avatar click: open modal and clear stale values ──
  if (avatarEl) {
    avatarEl.addEventListener("click", () => {
      _openChangePasswordModal();
    });
  }

  // New mobile avatar — same action
  const mobileAvatar = document.getElementById("mobileUserAvatar");
  if (mobileAvatar) {
    mobileAvatar.addEventListener("click", () => {
      _openChangePasswordModal();
    });
  }

  // ── 3. hidden.bs.modal: always clear fields when modal is dismissed ──
  modalEl.addEventListener("hidden.bs.modal", () => {
    clearModalFields();
  });

  // ── 2. Submit button click ──
  if (!submitBtn) return;

  submitBtn.addEventListener("click", async () => {
    // Read current values via .value — never innerHTML
    const currentPwEl  = document.getElementById("currentPassword");
    const newPwEl      = document.getElementById("newPassword");
    const confirmPwEl  = document.getElementById("confirmNewPassword");

    const currentPassword  = currentPwEl  ? currentPwEl.value  : "";
    const newPassword      = newPwEl      ? newPwEl.value      : "";
    const confirmNewPw     = confirmPwEl  ? confirmPwEl.value  : "";

    // Clear previous error states before re-validating
    ["currentPassword", "newPassword", "confirmNewPassword"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("is-invalid");
      const errEl = document.getElementById(id + "-error");
      if (errEl) { errEl.textContent = ""; errEl.classList.remove("visible"); }
    });

    // ── Client-side validation — collect all errors simultaneously ──
    const validations = [
      { fieldId: "currentPassword",   result: validateRequired(currentPassword, "Current Password") },
      { fieldId: "newPassword",        result: validateRequired(newPassword, "New Password") },
      { fieldId: "newPassword",        result: validatePassword(newPassword) },
      { fieldId: "confirmNewPassword", result: validateConfirmPassword(newPassword, confirmNewPw) },
    ];

    let hasErrors = false;
    validations.forEach(({ fieldId, result }) => {
      if (!result.valid) {
        showFieldError(fieldId, result.message);
        hasErrors = true;
      }
    });

    if (hasErrors) return;

    // ── API call ──
    setLoading(submitBtn, true);
    try {
      await changePassword(currentPassword, newPassword, confirmNewPw);

      // Success: close modal, clear fields, show toast
      const bsModal = bootstrap.Modal.getInstance(modalEl);
      if (bsModal) bsModal.hide();
      clearModalFields();
      showToast("Password changed successfully.", "success");
    } catch (err) {
      // Failure: show server detail, keep modal open so user can correct input
      showToast(err.message || "Failed to change password.", "error");
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

// ---------------------------------------------------------------------------
// SHARED PAGINATOR FACTORY
// ---------------------------------------------------------------------------

/**
 * Create a client-side paginator instance for a table.
 *
 * Returns { setData, render, reset }.
 *   setData(items) — replace the full data array and reset to page 1.
 *   render()       — render the current page and rebuild the control bar.
 *   reset()        — reset to page 1 without replacing data.
 *
 * onRender(pageItems, allItems) is called on every render:
 *   pageItems — the slice for the current page
 *   allItems  — the full (filtered) array, used for stats / empty-state
 *
 * The control bar is injected into the element whose id is `containerId`.
 * It is hidden automatically when all rows fit on one page.
 *
 * @param {object}   options
 * @param {string}   options.containerId   - id of the pagination bar container
 * @param {number}   [options.pageSize=25] - initial rows per page
 * @param {function} options.onRender      - callback(pageItems, allItems)
 * @returns {{ setData: function, render: function, reset: function }}
 */
function _createPaginator({ containerId, pageSize: initialPageSize = 25, onRender }) {
  let _allItems = [];
  let _page     = 1;
  let _pageSize = initialPageSize;

  function _totalPages() {
    return Math.max(1, Math.ceil(_allItems.length / _pageSize));
  }

  function _getPageItems() {
    const start = (_page - 1) * _pageSize;
    return _allItems.slice(start, start + _pageSize);
  }

  function _buildControls() {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.textContent = ''; // clear — never innerHTML

    const total      = _allItems.length;
    const totalPages = _totalPages();

    if (total === 0 || totalPages <= 1) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';

    // "Showing X–Y of Z"
    const rangeStart = (_page - 1) * _pageSize + 1;
    const rangeEnd   = Math.min(_page * _pageSize, total);
    const infoEl     = document.createElement('span');
    infoEl.className   = 'pagination-info';
    infoEl.textContent = `Showing ${rangeStart}\u2013${rangeEnd} of ${total}`;
    container.appendChild(infoEl);

    // Right-side controls
    const controls = document.createElement('div');
    controls.className = 'pagination-controls';

    // "Rows per page" label
    const sizeLabel = document.createElement('span');
    sizeLabel.className   = 'pagination-page-size';
    sizeLabel.textContent = 'Rows per page:';
    controls.appendChild(sizeLabel);

    // Page-size selector
    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'pagination-size-select';
    sizeSelect.setAttribute('aria-label', 'Rows per page');
    [10, 25, 50, 100].forEach(size => {
      const opt = document.createElement('option');
      opt.value       = String(size);
      opt.textContent = String(size);
      if (size === _pageSize) opt.selected = true;
      sizeSelect.appendChild(opt);
    });
    sizeSelect.addEventListener('change', () => {
      _pageSize = parseInt(sizeSelect.value, 10);
      _page     = 1;
      _renderPage();
    });
    controls.appendChild(sizeSelect);

    // Prev button
    const prevBtn = document.createElement('button');
    prevBtn.type      = 'button';
    prevBtn.className = 'pagination-btn';
    prevBtn.setAttribute('aria-label', 'Previous page');
    prevBtn.textContent = '\u2190 Prev';
    prevBtn.disabled    = (_page <= 1);
    prevBtn.addEventListener('click', () => {
      if (_page > 1) { _page--; _renderPage(); }
    });
    controls.appendChild(prevBtn);

    // Page indicator: "Page N of M"
    const pageEl = document.createElement('span');
    pageEl.className   = 'pagination-page-indicator';
    pageEl.textContent = `Page ${_page} of ${totalPages}`;
    controls.appendChild(pageEl);

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.type      = 'button';
    nextBtn.className = 'pagination-btn';
    nextBtn.setAttribute('aria-label', 'Next page');
    nextBtn.textContent = 'Next \u2192';
    nextBtn.disabled    = (_page >= totalPages);
    nextBtn.addEventListener('click', () => {
      if (_page < _totalPages()) { _page++; _renderPage(); }
    });
    controls.appendChild(nextBtn);

    container.appendChild(controls);
  }

  function _renderPage() {
    if (typeof onRender === 'function') {
      onRender(_getPageItems(), _allItems);
    }
    _buildControls();
  }

  return {
    /** Replace the full data array and reset to page 1. */
    setData(items) {
      _allItems = Array.isArray(items) ? items : [];
      _page     = 1;
    },
    /** Re-render the current page and rebuild the control bar. */
    render() {
      _renderPage();
    },
    /** Reset to page 1 without replacing data. */
    reset() {
      _page = 1;
    },
  };
}

// ---------------------------------------------------------------------------
// DASHBOARD PAGE
// ---------------------------------------------------------------------------

let pendingDeleteId   = null;
let pendingDeleteRow  = null;

// Map of record id -> full record object, used by the row-click detail handler
let _recordsMap = {};

/**
 * Pure filter function — applies three simultaneous filters to the in-memory
 * records array. Extracts the logic into one place so all three filter event
 * listeners share identical behaviour without duplication.
 *
 * @param {Array<object>} records - The full unfiltered records array
 * @param {{ type: string, category: string, equipment: string }} filters
 * @returns {Array<object>} Filtered records
 */
function applyDashboardFilters(records, filters) {
  return records.filter((record) => {
    const typeMatch = !filters.type ||
      record.maintenance_type === filters.type;
    const equipmentMatch = !filters.equipment ||
      (record.equipment_id || '').toLowerCase().includes(filters.equipment.toLowerCase()) ||
      (record.equipment_full_path || '').toLowerCase().includes(filters.equipment.toLowerCase());
    return typeMatch && equipmentMatch;
  });
}

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
  if (newRecordBtn) {
    newRecordBtn.classList.toggle("d-none", role === ROLES.VIEWER);
  }

  const searchInput    = document.getElementById("search-input");
  const typeFilter     = document.getElementById("type-filter");
  const equipmentFilter = document.getElementById("equipmentFilter");

  // Full unfiltered records — loaded once on page load, filtered in memory
  let allRecords = [];

  let _sortBy    = 'id';
  let _sortOrder = 'desc';

  function _getCurrentFilters() {
    return {
      type:       typeFilter      ? typeFilter.value      : "",
      equipment:  equipmentFilter ? equipmentFilter.value : "",
      search:     searchInput     ? searchInput.value     : "",
      sortBy:     _sortBy,
      sortOrder:  _sortOrder,
    };
  }

  function _updateSortIndicators() {
    document.querySelectorAll('th[data-sort-by]').forEach(th => {
        const col       = th.getAttribute('data-sort-by');
        const indicator = th.querySelector('.sort-indicator');
        if (!indicator) return;

        if (col === _sortBy) {
            indicator.textContent = _sortOrder === 'asc' ? ' ▲' : ' ▼';
            th.classList.add('sort-active');
        } else {
            indicator.textContent = '';
            th.classList.remove('sort-active');
        }
    });
  }

  const thead = document.querySelector('#recordsTable thead');
  if (thead) {
      thead.addEventListener('click', async (e) => {
          const th = e.target.closest('th[data-sort-by]');
          if (!th) return;

          if (typeof window._dashboardClearSelection === "function") {
              window._dashboardClearSelection();
          }

          const column = th.getAttribute('data-sort-by');

          if (_sortBy === column) {
              // Same column — toggle direction
              _sortOrder = _sortOrder === 'desc' ? 'asc' : 'desc';
          } else {
              // New column — default to ascending
              _sortBy    = column;
              _sortOrder = 'asc';
          }

          _updateSortIndicators();
          await _fetchAndRenderRecords();
      });
  }

  // Paginator for the maintenance records table — 25 rows per page by default.
  const dashPaginator = _createPaginator({
    containerId: 'dashboard-pagination',
    pageSize:    25,
    onRender(pageItems, allItems) {
      // Render only the current page's rows into the table
      renderRecordsTable(pageItems, role, username);

      // Override stats to reflect the FULL filtered set, not just the visible page
      const statsTotal    = document.getElementById('stat-total');
      const statPlanned   = document.getElementById('stat-planned');
      const statConducted = document.getElementById('stat-conducted');
      if (statsTotal)    statsTotal.textContent    = String(allItems.length);
      if (statPlanned)   statPlanned.textContent   = String(allItems.filter(r => r.maintenance_type === 'Planned').length);
      if (statConducted) statConducted.textContent = String(allItems.filter(r => r.maintenance_type === 'Conducted').length);

      attachRowClickListeners(role, username);

      // Clear stale selection state whenever the page changes
      if (typeof window._dashboardClearSelection === 'function') {
        window._dashboardClearSelection();
      }
      _initBulkActions();
    },
  });

  async function _fetchAndRenderRecords() {
    try {
      const filters = _getCurrentFilters();
      const data    = await getRecords(filters);
      allRecords    = Array.isArray(data) ? data : (data.records || []);

      _recordsMap = {};
      allRecords.forEach((r) => { _recordsMap[r.id] = r; });

      const filtered = applyDashboardFilters(allRecords, filters);
      dashPaginator.setData(filtered);
      dashPaginator.render();
      _updateSortIndicators();
    } catch (err) {
      showToast(err.message || 'Failed to load records.', 'error');
    }
  }

  // Wire search — re-fetches from the API (server-side text search)
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(_fetchAndRenderRecords, 350);
    });
  }

  // Wire type filter — client-side + server-side
  if (typeFilter) {
    typeFilter.addEventListener("change", _fetchAndRenderRecords);
  }


  // Wire equipment ID filter — client-side + server-side
  if (equipmentFilter) {
    let equipDebounce;
    equipmentFilter.addEventListener("input", () => {
      clearTimeout(equipDebounce);
      equipDebounce = setTimeout(_fetchAndRenderRecords, 200);
    });
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
        _fetchAndRenderRecords();
      } catch (err) {
        showToast(err.message || "Failed to delete record.", "error");
      } finally {
        setLoading(confirmDeleteBtn, false);
        pendingDeleteId  = null;
        pendingDeleteRow = null;
      }
    });
  }

  // Initial load — _initBulkActions is now called inside dashPaginator.onRender
  _fetchAndRenderRecords();
}

/**
 * Wire all multi-record selection and bulk action behaviour on the dashboard.
 * Called once after the initial table render inside initDashboardPage().
 * Re-called after a bulk delete reloads the table.
 *
 * State is scoped inside this function — _selectedIds is not a global variable.
 */
function _initBulkActions() {
  // Selection state — Set of selected record IDs
  const _selectedIds = new Set();

  // Update the bulk action bar visibility and selected count display
  function _updateBulkActionBar() {
    const bar     = document.getElementById("bulkActionBar");
    const countEl = document.getElementById("selectedCount");
    const count   = _selectedIds.size;
    if (bar)     bar.style.display   = count > 0 ? "flex" : "none";
    if (countEl) countEl.textContent = String(count);
  }

  // Clear all selections and reset UI
  function _clearSelection() {
    _selectedIds.clear();
    const selectAll = document.getElementById("selectAllCheckbox");
    if (selectAll) selectAll.checked = false;
    // Uncheck all individual checkboxes
    document.querySelectorAll(".record-checkbox").forEach((cb) => {
      cb.checked = false;
    });
    _updateBulkActionBar();
  }

  // Expose _clearSelection so the outer applyFilters() can call it
  window._dashboardClearSelection = _clearSelection;

  // ── Event delegation on tbody for individual checkbox changes ──
  const tbody = document.getElementById("records-tbody");
  if (tbody) {
    // Remove any previously attached bulk-actions delegator to avoid duplicate listeners
    if (tbody._bulkActionsHandler) {
      tbody.removeEventListener("change", tbody._bulkActionsHandler);
    }
    tbody._bulkActionsHandler = (e) => {
      if (!e.target.classList.contains("record-checkbox")) return;
      const id = parseInt(e.target.getAttribute("data-record-id"), 10);
      if (e.target.checked) {
        _selectedIds.add(id);
        // Reflect row-selected class
        const row = e.target.closest("tr");
        if (row) row.classList.add("row-selected");
      } else {
        _selectedIds.delete(id);
        const row = e.target.closest("tr");
        if (row) row.classList.remove("row-selected");
        // Uncheck select-all if not all are selected
        const selectAll = document.getElementById("selectAllCheckbox");
        if (selectAll) selectAll.checked = false;
      }
      _updateBulkActionBar();
    };
    tbody.addEventListener("change", tbody._bulkActionsHandler);
  }

  // ── Select All checkbox ──
  const selectAll = document.getElementById("selectAllCheckbox");
  if (selectAll) {
    // Remove previous listener to avoid double-wiring on re-init
    const newSelectAll = selectAll.cloneNode(true);
    selectAll.parentNode.replaceChild(newSelectAll, selectAll);
    newSelectAll.addEventListener("change", () => {
      const checkboxes = document.querySelectorAll(".record-checkbox");
      checkboxes.forEach((cb) => {
        cb.checked = newSelectAll.checked;
        const id = parseInt(cb.getAttribute("data-record-id"), 10);
        const row = cb.closest("tr");
        if (newSelectAll.checked) {
          _selectedIds.add(id);
          if (row) row.classList.add("row-selected");
        } else {
          _selectedIds.delete(id);
          if (row) row.classList.remove("row-selected");
        }
      });
      _updateBulkActionBar();
    });
  }

  // ── Export Selected as PDF ──
  const exportBtn = document.getElementById("bulkExportBtn");
  if (exportBtn) {
    // Clone to remove any previous listener
    const newExportBtn = exportBtn.cloneNode(true);
    exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
    newExportBtn.addEventListener("click", async () => {
      if (_selectedIds.size === 0) return;
      const ids = Array.from(_selectedIds);
      setLoading(newExportBtn, true);
      const result = await exportRecordsPdfBulk(ids, (completed, total) => {
        newExportBtn.textContent = `Exporting ${completed}/${total}...`;
      });
      setLoading(newExportBtn, false);
      newExportBtn.textContent = "Export Selected as PDF"; // restore label
      if (result.failed === 0) {
        showToast(`${result.succeeded} PDF(s) exported successfully.`, "success");
      } else {
        showToast(`${result.succeeded} exported, ${result.failed} failed.`, "error");
      }
    });
  }

  // ── Bulk Delete (Administrator only) ──
  const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
  if (bulkDeleteBtn && getRole() === ROLES.ADMIN) {
    bulkDeleteBtn.style.display = "inline-block";

    // Clone to remove any previous listener
    const newBulkDeleteBtn = bulkDeleteBtn.cloneNode(true);
    bulkDeleteBtn.parentNode.replaceChild(newBulkDeleteBtn, bulkDeleteBtn);

    newBulkDeleteBtn.addEventListener("click", () => {
      if (_selectedIds.size === 0) return;
      const ids   = Array.from(_selectedIds);
      const count = ids.length;
      _openBulkDeleteConfirm(ids, count, _clearSelection);
    });
  }

  _updateBulkActionBar();
}

/**
 * Open the bulk delete confirmation modal and wire its confirm button.
 * Uses the dedicated #bulkDeleteModal added to dashboard.html.
 * @param {number[]} ids - Selected record IDs to delete
 * @param {number} count - Display count
 * @param {function} clearSelection - Callback to clear selection state after success
 */
function _openBulkDeleteConfirm(ids, count, clearSelection) {
  const modalEl   = document.getElementById("bulkDeleteModal");
  const countEl   = document.getElementById("bulkDeleteCount");
  const confirmBtn = document.getElementById("bulkDeleteConfirmBtn");
  if (!modalEl || !confirmBtn) return;

  if (countEl) countEl.textContent = String(count);

  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();

  // Clone confirm button to clear any prior listener
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

  newConfirmBtn.addEventListener("click", async () => {
    setLoading(newConfirmBtn, true);
    try {
      const result = await bulkDeleteRecords(ids);

      // Close modal
      bootstrap.Modal.getInstance(document.getElementById("bulkDeleteModal")).hide();

      // Clear selection
      if (clearSelection) clearSelection();

      showToast(`${result.deleted} record(s) deleted, ${result.skipped} skipped.`, "success");

      // Reload the table: dispatch a synthetic input on the search box which
      // triggers loadRecords() after its 350 ms debounce. We then wait 500 ms
      // to let the debounce + fetch + render complete, and re-initialise
      // bulk actions so event delegation works on the freshly-rendered rows.
      const searchInput = document.getElementById("search-input");
      if (searchInput) {
        searchInput.dispatchEvent(new Event("input"));
      }
      // Wait for debounce (350 ms) + fetch + render to settle before re-wiring
      setTimeout(() => {
        _initBulkActions();
      }, 500);
    } catch (err) {
      showToast(err.message || "Bulk delete failed.", "error");
    } finally {
      setLoading(newConfirmBtn, false);
    }
  });
}

/**
 * Attach click listeners to every tbody row.
 * Clicks on action buttons stop propagation so they don't trigger navigation.
 * Clicks on checkboxes or their cells are also ignored to prevent navigation.
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

    tr.addEventListener("click", (e) => {
      // Do not navigate when clicking a checkbox or the checkbox cell
      if (e.target.type === "checkbox" || e.target.classList.contains("col-checkbox")) {
        return;
      }
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
async function handleDownload(e, attachmentId, filename) {
  e.preventDefault();
  try {
    await downloadAttachment(attachmentId, filename);
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
 *
 * Changes added:
 *   - Change 1.5: Wire Delete button (edit mode + Administrator only)
 *   - Change 4.4: Wire Remove Attachment button
 *   - Change 4.5: Wire Clear file button
 */
async function initFormPage() {
  const form = document.getElementById("record-form");
  if (!form) return;

  guardPage();

  // Viewers have no business on this page — redirect immediately before any rendering
  if (getRole() === ROLES.VIEWER) {
    window.location.href = "dashboard.html";
    return; // stop execution immediately — no form rendering, no API calls
  }

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

  // ── Change 1.5: Delete button — visible only in edit mode for Administrators ──
  const deleteBtn = document.getElementById("btn-delete-record");
  if (deleteBtn) {
    const showDelete = isEdit && role === ROLES.ADMIN;
    deleteBtn.classList.toggle("d-none", !showDelete);
  }

  // ── Multi-attachment state ──
  // _newFiles: Files selected for upload in this session (not yet sent to the server)
  const _newFiles = [];
  // _pendingRemoveAttachmentId: attachment_id waiting for modal confirmation
  let _pendingRemoveAttachmentId = null;

  /**
   * Re-render the list of newly-selected (not yet uploaded) files.
   * Each entry shows name, size, inline validation warnings, and a per-entry Clear button.
   * Uses createElement/textContent only — no innerHTML with file data.
   */
  function renderNewFilesList() {
    const container = document.getElementById("new-attachments-list");
    if (!container) return;
    container.textContent = "";

    _newFiles.forEach((file, idx) => {
      const item = document.createElement("div");
      item.className = "attachment-item d-flex align-items-center gap-2 mb-1 flex-wrap";

      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "\uD83D\uDCC4";  // 📄
      item.appendChild(icon);

      const nameSpan = document.createElement("span");
      nameSpan.className = "file-info-name";
      nameSpan.textContent = file.name;
      item.appendChild(nameSpan);

      const sizeSpan = document.createElement("span");
      sizeSpan.className = "file-info-size";
      sizeSpan.style.fontSize = "var(--font-size-xs)";
      sizeSpan.textContent = `(${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
      item.appendChild(sizeSpan);

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "btn btn-sm btn-link p-0";
      clearBtn.style.fontSize = "var(--font-size-xs)";
      clearBtn.style.color = "var(--color-text-muted)";
      clearBtn.textContent = "Clear";
      clearBtn.addEventListener("click", () => {
        _newFiles.splice(idx, 1);
        renderNewFilesList();
      });
      item.appendChild(clearBtn);

      // Inline validation warnings
      const typeResult = validateFileType(file);
      const sizeResult = validateFileSize(file, DEFAULT_MAX_UPLOAD_MB);
      const warnings = [];
      if (!typeResult.valid) warnings.push(typeResult.message);
      if (!sizeResult.valid) warnings.push(sizeResult.message);
      if (warnings.length > 0) {
        const warnSpan = document.createElement("span");
        warnSpan.className = "file-warning";
        warnSpan.style.fontSize = "var(--font-size-xs)";
        warnSpan.textContent = warnings.join(" ");
        item.appendChild(warnSpan);
      }

      container.appendChild(item);
    });
  }

  /**
   * Fetch and render the list of existing (already uploaded) attachments for a record.
   * Shows/hides the currentAttachmentBlock based on whether any attachments exist.
   * Each entry has a download link and (for Admins and Engineers) a per-attachment Remove button.
   * @param {number} recordId
   */
  async function renderExistingAttachments(recordId) {
    const container  = document.getElementById("current-attachments-list");
    const attachBlock = document.getElementById("currentAttachmentBlock");

    let attachments = [];
    try {
      attachments = await getRecordAttachments(recordId);
    } catch (err) {
      if (attachBlock) attachBlock.classList.add("d-none");
      return;
    }

    if (!container) return;
    container.textContent = "";

    if (attachments.length === 0) {
      if (attachBlock) attachBlock.classList.add("d-none");
      return;
    }

    if (attachBlock) attachBlock.classList.remove("d-none");

    const canRemove = (role === ROLES.ADMIN) || (role === ROLES.ENGINEER);

    attachments.forEach((att) => {
      const item = document.createElement("div");
      item.className = "attachment-item d-flex align-items-center gap-2 mb-1 flex-wrap";

      // Download link — href="#", actual download triggered via API with auth header
      const link = document.createElement("a");
      link.setAttribute("href", "#");
      link.textContent = att.original_filename;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        downloadAttachment(att.id, att.original_filename).catch((err) => {
          showToast(err.message || "Failed to download file.", "error");
        });
      });
      item.appendChild(link);

      if (att.file_size_bytes) {
        const sizeSpan = document.createElement("span");
        sizeSpan.className = "file-info-size";
        sizeSpan.style.fontSize = "var(--font-size-xs)";
        sizeSpan.textContent = `(${(att.file_size_bytes / (1024 * 1024)).toFixed(2)} MB)`;
        item.appendChild(sizeSpan);
      }

      if (canRemove) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn btn-sm btn-link p-0";
        removeBtn.style.fontSize = "var(--font-size-xs)";
        removeBtn.style.color = "var(--color-danger)";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () => {
          _pendingRemoveAttachmentId = att.id;
          const modal = document.getElementById("remove-attachment-modal");
          if (modal) new bootstrap.Modal(modal).show();
        });
        item.appendChild(removeBtn);
      }

      container.appendChild(item);
    });
  }


  // DOM references for the searchable equipment dropdown
  const equipmentSearchEl = document.getElementById("equipmentSearch");
  const equipmentIdEl     = document.getElementById("equipmentId");
  const equipmentListEl   = document.getElementById("equipmentDropdownList");

  // Fetch the active equipment list and initialise the dropdown
  let equipmentList = [];
  try {
    equipmentList = await getEquipmentList("", true);
  } catch (err) {
    showToast(err.message || "Failed to load equipment list.", "error");
  }
  buildEquipmentDropdown(equipmentList, equipmentSearchEl, equipmentListEl, equipmentIdEl);

  // For edit mode, load and pre-populate the form then fetch existing attachments
  let editRecord = null;
  if (isEdit) {
    try {
      const records = await getRecords({});
      editRecord = records.find((r) => r.id === editId) || null;
      if (editRecord) {
        populateForm(editRecord);

        // Pre-populate the searchable equipment dropdown with the stored value
        setEquipmentDropdownValue(equipmentList, editRecord.equipment_id, equipmentSearchEl, equipmentIdEl);

        // Render existing attachments list (replaces old single-attachment block)
        await renderExistingAttachments(editId);
      } else {
        showToast("Record not found.", "error");
      }
    } catch (err) {
      showToast(err.message || "Failed to load record.", "error");
    }
  }

  // ── File input — accumulate selected files into _newFiles list ──
  const fileInput = document.getElementById("field-attachment");

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      // Merge newly-selected files into the pending list
      Array.from(fileInput.files).forEach((f) => _newFiles.push(f));
      // Reset the input so the same file can be re-selected after clearing
      fileInput.value = "";
      renderNewFilesList();
    });
  }

  // ── Delete button — wire to confirmation modal (unchanged logic) ──
  if (deleteBtn && isEdit && role === ROLES.ADMIN) {
    const formDeleteModal  = document.getElementById("form-delete-modal");
    const confirmDeleteBtn = document.getElementById("btn-confirm-delete-record");

    if (formDeleteModal && confirmDeleteBtn) {
      deleteBtn.addEventListener("click", () => {
        const bsModal = new bootstrap.Modal(formDeleteModal);
        bsModal.show();
      });

      confirmDeleteBtn.addEventListener("click", async () => {
        setLoading(confirmDeleteBtn, true);
        try {
          await deleteRecord(editId);
          const bsModal = bootstrap.Modal.getInstance(formDeleteModal);
          if (bsModal) bsModal.hide();
          showToast("Record deleted successfully.", "success");
          setTimeout(() => window.location.replace("dashboard.html"), SUCCESS_REDIRECT_DELAY_MS);
        } catch (err) {
          showToast(err.message || "Failed to delete record.", "error");
          setLoading(confirmDeleteBtn, false);
        }
      });
    }
  }

  // ── Remove Attachment confirm modal — driven by per-attachment Remove buttons ──
  // _pendingRemoveAttachmentId is set by each Remove button before the modal opens.
  const removeAttachmentModal  = document.getElementById("remove-attachment-modal");
  const confirmRemoveAttachBtn = document.getElementById("btn-confirm-remove-attachment");

  if (removeAttachmentModal && confirmRemoveAttachBtn) {
    confirmRemoveAttachBtn.addEventListener("click", async () => {
      if (!_pendingRemoveAttachmentId) return;
      const attachId = _pendingRemoveAttachmentId;
      setLoading(confirmRemoveAttachBtn, true);
      try {
        await deleteAttachment(attachId);
        const bsModal = bootstrap.Modal.getInstance(removeAttachmentModal);
        if (bsModal) bsModal.hide();
        _pendingRemoveAttachmentId = null;
        // Re-render the existing attachments list to reflect the deletion
        if (isEdit) await renderExistingAttachments(editId);
        showToast("Attachment removed successfully.", "success");
      } catch (err) {
        showToast(err.message || "Failed to remove attachment.", "error");
      } finally {
        setLoading(confirmRemoveAttachBtn, false);
      }
    });
  }

  // Form submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();

    const maintenanceType      = document.getElementById("field-maintenance-type")?.value;
    // Read the hidden input value — set only when the user explicitly clicks a list item
    const equipmentId          = document.getElementById("equipmentId")?.value ?? "";
    const equipmentFullPath    = document.getElementById("equipmentSearch")?.value ?? "";
    const responsiblePerson    = document.getElementById("field-responsible-person")?.value ?? "";
    const plannedStart         = document.getElementById("field-planned-start")?.value ?? "";
    const plannedEnd           = document.getElementById("field-planned-end")?.value ?? "";
    const operatingConditions  = document.getElementById("field-operating-conditions")?.value ?? "";
    const inventoryConsumables = document.getElementById("field-inventory-consumables")?.value ?? "";
    const remarks              = document.getElementById("field-remarks")?.value ?? "";
    // Run all per-field validators and collect errors
    const validations = [
      { fieldId: "field-maintenance-type", result: validateMaintenanceType(maintenanceType) },
      // Equipment: validate the hidden input — typing without selecting must fail
      {
        fieldId: "equipmentId",
        result: equipmentId
          ? { valid: true, message: "" }
          : { valid: false, message: "Please select an equipment ID from the list." },
      },
      { fieldId: "field-responsible-person",    result: validateRequired(responsiblePerson, "Responsible Person") },
      { fieldId: "field-responsible-person",    result: validateMaxLength(responsiblePerson, MAX_RESPONSIBLE_PERSON_LENGTH, "Responsible Person") },
      { fieldId: "field-planned-start",         result: validateDatetimeOptional(plannedStart, "Planned Start") },
      { fieldId: "field-planned-end",           result: validateDatetimeOptional(plannedEnd, "Planned End") },
      { fieldId: "field-operating-conditions",  result: validateMaxLength(operatingConditions, MAX_TEXT_FIELD_LENGTH, "Operating Conditions") },
      { fieldId: "field-inventory-consumables", result: validateMaxLength(inventoryConsumables, MAX_TEXT_FIELD_LENGTH, "Inventory / Consumables") },
      { fieldId: "field-remarks",               result: validateMaxLength(remarks, MAX_REMARKS_LENGTH, "Remarks") },
    ];

    // Validate each pending new file for type and size
    _newFiles.forEach((file) => {
      const typeResult = validateFileType(file);
      const sizeResult = validateFileSize(file, DEFAULT_MAX_UPLOAD_MB);
      if (!typeResult.valid) validations.push({ fieldId: "field-attachment", result: typeResult });
      if (!sizeResult.valid) validations.push({ fieldId: "field-attachment", result: sizeResult });
    });

    let hasErrors = false;
    validations.forEach(({ fieldId, result }) => {
      if (!result.valid) {
        showFieldError(fieldId, result.message);
        hasErrors = true;
      }
    });

    // Mirror is-invalid onto the visible search input when the hidden equipment field fails.
    // showFieldError targets the hidden #equipmentId; the user needs to see the border on #equipmentSearch.
    if (equipmentSearchEl && document.getElementById("equipmentId")?.classList.contains("is-invalid")) {
      equipmentSearchEl.classList.add("is-invalid");
    }

    // Cross-field: planned_end must not precede planned_start
    const windowResult = validatePlannedWindow(plannedStart, plannedEnd);
    if (!windowResult.valid) {
      showFieldError("field-planned-end", windowResult.message);
      hasErrors = true;
    }

    if (hasErrors) return;

    // Build FormData — field names match backend Form() parameter names
    const formData = new FormData();
    formData.append("maintenance_type",   maintenanceType);
    formData.append("equipment_id",       equipmentId.trim());
    formData.append("equipment_full_path", equipmentFullPath.trim());
    formData.append("responsible_person", responsiblePerson.trim());
    if (plannedStart)          formData.append("planned_start",          plannedStart);
    if (plannedEnd)            formData.append("planned_end",            plannedEnd);
    if (operatingConditions)   formData.append("operating_conditions",   operatingConditions);
    if (inventoryConsumables)  formData.append("inventory_consumables",  inventoryConsumables);
    if (remarks)               formData.append("remarks",                remarks);
    // Append each new file as a separate "attachments" field entry
    _newFiles.forEach((file) => formData.append("attachments", file));

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
 * Initialize the manage-users page.
 * Detects page by checking for #create-user-form.
 *
 * Changes:
 *   - Change 2: Existing users table extended with Action column + double-confirmation toggle
 *   - Change 3: Create User form intercepted for double-confirmation before API call
 *   - renderUsersTable() is now in ui.js (rewritten); the old version here is removed
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

  const submitBtn     = document.getElementById("btn-create-user");
  const currentUser   = getUsername();

  // ── Load (and re-load) the existing users table ──
  async function loadUsers() {
    try {
      const users = await getUsers();
      // Pass the current username, toggle callback, and reset-password callback
      renderUsersTable(users, currentUser, handleToggleClick, handleResetPasswordClick);
    } catch (err) {
      showToast(err.message || "Failed to load users.", "error");
    }
  }

  /**
   * Change 2.3 — Double-confirmation flow for Activate/Deactivate toggle.
   * Called by renderUsersTable when a toggle button is clicked.
   * @param {object} user - The user object from the users list
   */
  function handleToggleClick(user) {
    const newStatus   = !user.is_active;
    const actionVerb  = user.is_active ? "Deactivate" : "Activate";
    const actionLabel = user.is_active ? "Confirm Deactivation" : "Confirm Activation";
    const message     = user.is_active
      ? `Deactivate user '${user.username}'? They will be immediately unable to log in.`
      : `Activate user '${user.username}'? They will be able to log in immediately.`;

    openTypeToConfirmModal({
      title:             `${actionVerb} User`,
      message:           message,
      confirmTargetText: user.username,
      confirmButtonLabel: actionLabel,
      onConfirmed: async () => {
        try {
          await updateUser(user.id, { is_active: newStatus });
          showToast(
            `User "${user.username}" ${newStatus ? "activated" : "deactivated"} successfully.`,
            "success"
          );
          // Refresh the users table to reflect the updated status
          await loadUsers();
        } catch (err) {
          showToast(err.message || `Failed to ${actionVerb.toLowerCase()} user.`, "error");
        }
      },
    });
  }

  /**
   * Callback passed to renderUsersTable as onResetPasswordClick.
   * Delegates to the modal opener registered by initResetPasswordModal().
   * @param {object} user - The user object from the users list
   */
  function handleResetPasswordClick(user) {
    if (typeof window._openResetPasswordModal === "function") {
      window._openResetPasswordModal(user);
    }
  }

  // Initial load
  loadUsers();

  // Wire the Reset Password modal (Admin temporary password reset)
  initResetPasswordModal(loadUsers);

  // ── Change 3.1 — Create User form: intercept submit for double-confirmation ──
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();

    const usernameVal  = document.getElementById("new-username")?.value ?? "";
    const passwordVal  = document.getElementById("new-password")?.value ?? "";
    const confirmVal   = document.getElementById("new-confirm-password")?.value ?? "";
    const roleVal      = document.getElementById("new-role")?.value ?? "";

    // Run all validators first — do not proceed if any fail (unchanged validation logic)
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

    // Validation passed — open double-confirmation modal (Change 3.1)
    // The role shown in the modal is the human-readable label from the select, not a raw enum.
    const roleLabel = document.getElementById("new-role")?.options[
      document.getElementById("new-role")?.selectedIndex
    ]?.text || roleVal;

    const summaryMessage = `Create new user account?\n\nUsername: ${usernameVal.trim()}\nRole: ${roleLabel}`;

    openTypeToConfirmModal({
      title:             "Create New User",
      message:           summaryMessage,
      confirmTargetText: usernameVal.trim(),
      confirmButtonLabel: "Confirm Creation",
      onConfirmed: async () => {
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
          await loadUsers();
        } catch (err) {
          showToast(err.message || "Failed to create user.", "error");
        } finally {
          setLoading(submitBtn, false);
        }
      },
    });
  });
}

// ---------------------------------------------------------------------------
// ADMIN RESET PASSWORD MODAL (manage-users.html only)
// ---------------------------------------------------------------------------

/**
 * Wire the Reset Password modal on manage-users.html.
 * Called from initManageUsersPage() after initial loadUsers().
 *
 * @param {function} reloadUsers - Async callback to refresh the users table after
 *                                 a successful password reset (passed in from
 *                                 initManageUsersPage to avoid a circular dependency).
 *
 * Security notes:
 *  - The target userId is stored in a function-scoped local variable — never in a
 *    global variable and never in a DOM data attribute read back at submit time.
 *  - Validation (validatePassword + validateConfirmPassword) runs before every API call.
 *  - api.updateUser(userId, { new_password }) sends to PUT /api/users/{id} which is
 *    restricted to require_role(ROLES["ADMIN"]) server-side.
 *  - The success toast uses a captured username string — never innerHTML.
 */
function initResetPasswordModal(reloadUsers) {
  const modalEl   = document.getElementById("resetPasswordModal");
  const submitBtn = document.getElementById("resetPasswordSubmitBtn");

  if (!modalEl || !submitBtn) return;

  // userId is scoped here — set when a Reset Password button is clicked,
  // read only inside the submit handler of the same closure.
  let _targetUserId   = null;
  let _targetUsername = "";

  // ── Helper: clear fields and error states ──
  function clearResetFields() {
    ["tempPassword", "confirmTempPassword"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
      if (el) el.classList.remove("is-invalid");
      const errEl = document.getElementById(id + "-error");
      if (errEl) { errEl.textContent = ""; errEl.classList.remove("visible"); }
    });
  }

  // ── Expose an opener function that per-row Reset Password buttons call ──
  // This is the callback passed as onResetPasswordClick in renderUsersTable().
  // It is stored on the function object so renderUsersTable can invoke it.
  // The actual wiring of per-row buttons happens inside renderUsersTable (ui.js);
  // initManageUsersPage passes handleResetPasswordClick as the 4th argument.
  window._openResetPasswordModal = function(user) {
    _targetUserId   = user.id;
    _targetUsername = user.username;

    // Populate the username display — textContent only, never innerHTML
    const usernameEl = document.getElementById("resetPasswordUsername");
    if (usernameEl) usernameEl.textContent = _targetUsername;

    clearResetFields();
    const bsModal = new bootstrap.Modal(modalEl);
    bsModal.show();
  };

  // ── Clear fields when modal is dismissed ──
  modalEl.addEventListener("hidden.bs.modal", () => {
    clearResetFields();
    _targetUserId   = null;
    _targetUsername = "";
  });

  // ── Submit: validate → API call ──
  submitBtn.addEventListener("click", async () => {
    const tempPwEl    = document.getElementById("tempPassword");
    const confirmPwEl = document.getElementById("confirmTempPassword");

    const tempPassword    = tempPwEl    ? tempPwEl.value    : "";
    const confirmPassword = confirmPwEl ? confirmPwEl.value : "";

    // Clear previous error states
    ["tempPassword", "confirmTempPassword"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("is-invalid");
      const errEl = document.getElementById(id + "-error");
      if (errEl) { errEl.textContent = ""; errEl.classList.remove("visible"); }
    });

    // ── Validate simultaneously ──
    const validations = [
      { fieldId: "tempPassword",         result: validatePassword(tempPassword) },
      { fieldId: "confirmTempPassword",  result: validateConfirmPassword(tempPassword, confirmPassword) },
    ];

    let hasErrors = false;
    validations.forEach(({ fieldId, result }) => {
      if (!result.valid) {
        showFieldError(fieldId, result.message);
        hasErrors = true;
      }
    });

    if (hasErrors) return;
    if (!_targetUserId) return; // Guard: should never happen in normal flow

    // Capture username for the toast — reading from the variable, not the DOM
    const capturedUsername = _targetUsername;
    const capturedUserId   = _targetUserId;

    setLoading(submitBtn, true);
    try {
      await updateUser(capturedUserId, { new_password: tempPassword });

      // Success: close modal, clear fields, refresh table, show toast
      const bsModal = bootstrap.Modal.getInstance(modalEl);
      if (bsModal) bsModal.hide();
      clearResetFields();

      // Toast message — capturedUsername is a plain string variable, never innerHTML
      showToast(`Temporary password set for ${capturedUsername}.`, "success");

      if (reloadUsers) await reloadUsers();
    } catch (err) {
      // Failure: show server detail, keep modal open
      showToast(err.message || "Failed to set temporary password.", "error");
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

// ---------------------------------------------------------------------------
// RECORD DETAIL PAGE
// ---------------------------------------------------------------------------



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

  // --- Section 1: Populate record fields and attachments ---
  _populateDetailFields(record);
  // Attachments are fetched async and rendered after the main fields are set
  _populateDetailAttachments(record.id);

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

  // Wire the Export PDF button — all authenticated roles
  _initExportButton(recordId);

  // --- Section 2: Checklist panel ---
  let _allRows          = [];
  let _parsedCsv        = null;
  let _savedRows        = [];
  let _checklistEl      = null;
  let _isEditable       = false;
  let _hasUnsavedChanges = false;

  async function _loadChecklist(recordId, userRole) {
      _isEditable = (userRole === 'Administrator' || userRole === 'Engineer / Operator');

      const gridWrapEl   = document.getElementById('csv-grid-container');
      const emptyStateEl = document.getElementById('csv-placeholder');
      const downloadBtn  = document.getElementById('btn-csv-download');
      const saveBtn      = document.getElementById('btn-csv-save');
      const undoBtn      = document.getElementById('btn-csv-undo');

      try {
          const data    = await getCsvData(recordId);
          _allRows      = data.rows;
          _savedRows    = JSON.parse(JSON.stringify(_allRows));
          _parsedCsv    = window.csvSchema ? window.csvSchema.parseFullCsv(_allRows) : null;

          if (!_parsedCsv) {
              throw new Error('Could not parse checklist structure.');
          }

          _renderChecklist();

          if (emptyStateEl) emptyStateEl.style.display = 'none';
          if (downloadBtn)  downloadBtn.classList.remove("d-none");
          if (saveBtn)      saveBtn.disabled            = true;
          if (undoBtn)      undoBtn.disabled            = true;

      } catch (err) {
          if (emptyStateEl) emptyStateEl.style.display = '';
          if (gridWrapEl)   gridWrapEl.style.display   = 'none';
          if (downloadBtn)  downloadBtn.classList.add("d-none");
          if (saveBtn)      saveBtn.disabled  = true;
          if (undoBtn)      undoBtn.disabled  = true;
      }
  }

  function _renderChecklist() {
      const gridWrapEl = document.getElementById('csv-grid-container');
      if (!gridWrapEl || !_parsedCsv) return;

      gridWrapEl.textContent = '';
      _checklistEl = renderCsvGrid(_parsedCsv, _isEditable);
      gridWrapEl.appendChild(_checklistEl);
      gridWrapEl.style.display = '';

      if (_isEditable) {
          _checklistEl.addEventListener('input',  _onChecklistChange);
          _checklistEl.addEventListener('change', _onChecklistChange);
      }
  }

  function _onChecklistChange() {
      _hasUnsavedChanges = true;
      const saveBtn = document.getElementById('btn-csv-save');
      const undoBtn = document.getElementById('btn-csv-undo');
      if (saveBtn) saveBtn.disabled = false;
      if (undoBtn) undoBtn.disabled = false;
  }

  await _loadChecklist(recordId, role);

  const btnUpload   = document.getElementById("btn-csv-upload");
  const btnSave     = document.getElementById("btn-csv-save");
  const btnUndo     = document.getElementById("btn-csv-undo");
  const btnDownload = document.getElementById("btn-csv-download");
  const csvFileInput = document.getElementById("csvFileInput");

  if (role !== ROLES.VIEWER && btnUpload) {
      btnUpload.classList.remove("d-none");
  }
  if (role !== ROLES.VIEWER && btnSave) btnSave.classList.remove("d-none");
  if (role !== ROLES.VIEWER && btnUndo) btnUndo.classList.remove("d-none");

  if (btnUpload && csvFileInput) {
      btnUpload.addEventListener("click", () => csvFileInput.click());
      csvFileInput.addEventListener("change", async () => {
          const file = csvFileInput.files[0];
          if (!file) return;

          const formData = new FormData();
          formData.append("csv_file", file);

          setLoading(btnUpload, true);
          try {
              const result = await uploadCsv(recordId, formData);
              _allRows      = result.rows;
              _savedRows    = JSON.parse(JSON.stringify(_allRows));
              _parsedCsv    = window.csvSchema ? window.csvSchema.parseFullCsv(_allRows) : null;
              
              if (!_parsedCsv) throw new Error('Could not parse checklist structure.');
              
              _hasUnsavedChanges = false;
              _renderChecklist();
              
              const emptyStateEl = document.getElementById('csv-placeholder');
              if (emptyStateEl) emptyStateEl.style.display = 'none';
              if (btnDownload)  btnDownload.classList.remove("d-none");
              if (btnSave)      btnSave.disabled = true;
              if (btnUndo)      btnUndo.disabled = true;
              
              showToast(`Checklist uploaded successfully.`, "success");
          } catch (err) {
              showToast(err.message || "Failed to upload checklist.", "error");
          } finally {
              setLoading(btnUpload, false);
              csvFileInput.value = "";
          }
      });
  }

  if (btnSave) {
      btnSave.addEventListener("click", async () => {
          if (!_parsedCsv || !_checklistEl) return;
          const updatedDataRows = readCsvGridValues(_checklistEl, _parsedCsv);
          
          let isValid = true;
          let dataIdx = 0;
          
          for (const table of _parsedCsv) {
              for (let i = 0; i < table.dataRows.length; i++) {
                  if (dataIdx >= updatedDataRows.length) break;
                  const rowValues = updatedDataRows[dataIdx];
                  const schemaArray = table.schemaArray;
                  
                  for (let ci = 0; ci < schemaArray.length; ci++) {
                      const schema = schemaArray[ci];
                      const value = rowValues[ci];
                      let variantResolved = null;
                      if (schema.type === 'variant') {
                          const metaColIndex = schemaArray.findIndex(
                              s => s.type === 'meta' && s.key === schema.key + ':DataType'
                          );
                          const dataTypeValue = metaColIndex !== -1 ? (rowValues[metaColIndex] || '') : '';
                          variantResolved = window.csvSchema.resolveVariantType(dataTypeValue, table.optionsMap);
                      }
                      const result = window.csvSchema.validateCellValue(value, schema, variantResolved);
                      if (!result.valid) {
                          showToast(`Data Row ${dataIdx + 1}: ${result.message}`, "error");
                          isValid = false;
                          break;
                      }
                  }
                  if (!isValid) break;
                  dataIdx++;
              }
              if (!isValid) break;
          }
          if (!isValid) return;

          const rebuiltRows = window.csvSchema.rebuildAllRows(_allRows, updatedDataRows, _parsedCsv);

          setLoading(btnSave, true);
          try {
              await saveCsvData(recordId, { headers: [], rows: rebuiltRows });
              _allRows = rebuiltRows;
              _savedRows = JSON.parse(JSON.stringify(_allRows));
              _parsedCsv = window.csvSchema.parseFullCsv(_allRows);
              _hasUnsavedChanges = false;
              _renderChecklist();
              if (btnSave) btnSave.disabled = true;
              if (btnUndo) btnUndo.disabled = true;
              showToast("Checklist saved.", "success");
          } catch (err) {
              showToast(err.message || "Failed to save checklist.", "error");
          } finally {
              setLoading(btnSave, false);
          }
      });
  }

  if (btnUndo) {
      btnUndo.addEventListener("click", () => {
          _allRows = JSON.parse(JSON.stringify(_savedRows));
          _parsedCsv = window.csvSchema.parseFullCsv(_allRows);
          _renderChecklist();
          if (btnSave) btnSave.disabled = true;
          if (btnUndo) btnUndo.disabled = true;
          _hasUnsavedChanges = false;
          showToast("Changes undone.", "success");
      });
  }

  if (btnDownload) {
      btnDownload.addEventListener("click", async () => {
          try {
              await downloadCsv(recordId);
          } catch (err) {
              showToast(err.message || "Failed to download checklist.", "error");
          }
      });
  }

  window.addEventListener("beforeunload", (e) => {
      if (_hasUnsavedChanges) {
          e.preventDefault();
          e.returnValue = "";
      }
  });
}

/**
 * Wire the Export PDF button on the record detail page.
 * Page-private helper — prefixed with _ per codebase convention.
 * Uses ui.setLoading() to disable the button during the async PDF generation,
 * preventing double-clicks. Errors are surfaced via ui.showToast().
 * @param {number} recordId
 */
function _initExportButton(recordId) {
  const btn = document.getElementById("exportPdfBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    setLoading(btn, true);
    try {
      await exportRecordPdf(recordId);
    } catch (err) {
      showToast(err.message || "PDF export failed.", "error");
    } finally {
      setLoading(btn, false);
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
  set("detail-equipment-id", record.equipment_full_path || record.equipment_id);
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

  // Attachments are rendered asynchronously by _populateDetailAttachments()
  // called after this function returns — see initRecordDetailPage().
}

/**
 * Fetch and render the attachments list for the record detail page.
 * Populates #detail-attachment with a clickable list of attachment links.
 * Uses createElement and textContent only — no innerHTML with server data.
 * @param {number} recordId
 */
async function _populateDetailAttachments(recordId) {
  const attachEl = document.getElementById("detail-attachment");
  if (!attachEl) return;

  attachEl.textContent = "";

  let attachments = [];
  try {
    attachments = await getRecordAttachments(recordId);
  } catch (_) {
    attachEl.textContent = "\u2014";
    return;
  }

  if (attachments.length === 0) {
    attachEl.textContent = "\u2014";
    return;
  }

  const list = document.createElement("ul");
  list.style.listStyle = "none";
  list.style.padding = "0";
  list.style.margin = "0";

  attachments.forEach((att) => {
    const li = document.createElement("li");
    li.style.marginBottom = "6px";

    const link = document.createElement("a");
    link.setAttribute("href", "#");
    link.textContent = att.original_filename;
    link.className = "attachment-link";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      downloadAttachment(att.id, att.original_filename).catch((err) => {
        showToast(err.message || "Failed to download file.", "error");
      });
    });
    li.appendChild(link);

    if (att.file_size_bytes) {
      const meta = document.createElement("span");
      meta.style.fontSize = "var(--font-size-xs)";
      meta.style.marginLeft = "8px";
      meta.style.color = "var(--color-text-muted)";
      meta.textContent = "(" + (att.file_size_bytes / (1024 * 1024)).toFixed(2) + " MB)";
      li.appendChild(meta);
    }

    list.appendChild(li);
  });

  attachEl.appendChild(list);
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
// EQUIPMENT MASTER PAGE
// ---------------------------------------------------------------------------

async function initEquipmentMasterPage() {
  const tbody = document.getElementById("equipment-master-tbody");
  if (!tbody) return;

  guardPage();
  populateNavbar();
  applyNavbarRoleVisibility();
  populateSidebar();
  populateTopbarMeta();
  const activeMaster = document.getElementById("nav-equipment-master");
  if (activeMaster) activeMaster.classList.add("active");

  const role = getRole();
  const isAdmin = role === ROLES.ADMIN;

  const btnAdd = document.getElementById("btn-add-equipment");
  const actionsTh = document.getElementById("equipment-actions-th");

  if (isAdmin) {
    if (btnAdd) btnAdd.classList.remove("d-none");
    if (actionsTh) actionsTh.classList.remove("d-none");
  } else {
    if (actionsTh) actionsTh.classList.add("d-none");
  }

  const searchInput    = document.getElementById("equipment-search-input");
  const activeCheckbox = document.getElementById("equipment-active-only");

  // Paginator for the equipment list — 25 rows per page by default.
  // onRender references _onToggleEquipment and _onDeleteEquipment, which are
  // declared as consts below. They are only invoked when buttons are clicked
  // (after all consts in this scope are fully initialised), so the
  // temporal-dead-zone ordering is safe.
  const eqPaginator = _createPaginator({
    containerId: 'equipment-pagination',
    pageSize:    25,
    onRender(pageItems, allItems) {
      const emptyEl  = document.getElementById('equipment-empty-state');
      const oldTbody = document.getElementById('equipment-master-tbody');

      if (allItems.length === 0) {
        if (oldTbody) oldTbody.textContent = '';
        if (emptyEl)  emptyEl.style.display = '';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';

      const newTbody = renderEquipmentMasterTable(
        pageItems,
        getUsername(),
        isAdmin,
        _onToggleEquipment,
        _onDeleteEquipment
      );
      if (oldTbody) {
        newTbody.id = 'equipment-master-tbody';
        oldTbody.parentNode.replaceChild(newTbody, oldTbody);
      }
    },
  });

  // Toggle active status — references hoisted _fetchAndRenderEquipment declaration.
  const _onToggleEquipment = async (eq) => {
    try {
      await updateEquipment(eq.id, { is_active: !eq.is_active });
      showToast(
        `Equipment ${eq.equipment_id} ${eq.is_active ? 'deactivated' : 'activated'}.`,
        'success'
      );
      _fetchAndRenderEquipment();
    } catch (err) {
      showToast(err.message || 'Failed to update equipment.', 'error');
    }
  };

  const _onDeleteEquipment = async (eq) => {
    openTypeToConfirmModal({
      title:              'Delete Equipment',
      message:            `Are you sure you want to permanently delete equipment ID "${eq.equipment_id}"? This cannot be undone.`,
      confirmTargetText:  eq.equipment_id,
      confirmButtonLabel: 'Delete Equipment',
      onConfirmed: async () => {
        try {
          await deleteEquipment(eq.id);
          showToast(`Equipment ${eq.equipment_id} deleted.`, 'success');
          _fetchAndRenderEquipment();
        } catch (err) {
          showToast(err.message || 'Failed to delete equipment.', 'error');
        }
      },
    });
  };

  async function _fetchAndRenderEquipment() {
    try {
      const search     = searchInput     ? searchInput.value.trim() : '';
      const activeOnly = activeCheckbox  ? activeCheckbox.checked   : true;

      const equipmentList = await getEquipmentList(search, activeOnly);
      eqPaginator.setData(equipmentList);
      eqPaginator.render();
    } catch (err) {
      showToast(err.message || 'Failed to load equipment.', 'error');
    }
  }

  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(_fetchAndRenderEquipment, 300);
    });
  }

  if (activeCheckbox) {
    activeCheckbox.addEventListener("change", _fetchAndRenderEquipment);
  }

  if (btnAdd && isAdmin) {
    const addModalEl = document.getElementById("addEquipmentModal");
    const saveBtn = document.getElementById("btn-save-equipment");
    
    btnAdd.addEventListener("click", () => {
      // Clear form
      document.getElementById("add-equipment-form").reset();
      clearFieldErrors();
      new bootstrap.Modal(addModalEl).show();
    });

    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        clearFieldErrors();
        
        const enterprise = document.getElementById("eq-enterprise").value.trim();
        const site = document.getElementById("eq-site").value.trim();
        const area = document.getElementById("eq-area").value.trim();
        const workCenter = document.getElementById("eq-work-center").value.trim();
        const workUnit = document.getElementById("eq-work-unit").value.trim();
        const equipmentId = document.getElementById("eq-id").value.trim();

        const validations = [
          { fieldId: "eq-enterprise", result: validateRequired(enterprise, "Enterprise") },
          { fieldId: "eq-site", result: validateRequired(site, "Site") },
          { fieldId: "eq-area", result: validateRequired(area, "Area") },
          { fieldId: "eq-work-center", result: validateRequired(workCenter, "Work Center") },
          { fieldId: "eq-work-unit", result: validateRequired(workUnit, "Work Unit") },
          { fieldId: "eq-id", result: validateRequired(equipmentId, "Equipment ID") }
        ];

        let hasErrors = false;
        validations.forEach(({ fieldId, result }) => {
          if (!result.valid) {
            showFieldError(fieldId, result.message);
            hasErrors = true;
          }
        });

        if (hasErrors) return;

        setLoading(saveBtn, true);
        try {
          await createEquipment({
            enterprise_name: enterprise,
            site: site,
            area: area,
            work_center: workCenter,
            work_unit: workUnit,
            equipment_id: equipmentId
          });
          
          bootstrap.Modal.getInstance(addModalEl).hide();
          showToast("Equipment added successfully.", "success");
          _fetchAndRenderEquipment();
        } catch (err) {
          showToast(err.message || "Failed to add equipment.", "error");
        } finally {
          setLoading(saveBtn, false);
        }
      });
    }
  }

  // Initial load
  _fetchAndRenderEquipment();
  _initBulkUpload(_fetchAndRenderEquipment);
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
  initEquipmentMasterPage();
  if (document.getElementById('trashPage')) initTrashPage();
});

// ---------------------------------------------------------------------------
// TRASH PAGE
// ---------------------------------------------------------------------------

async function initTrashPage() {
    guardPage();

    // Administrator only — redirect non-admins immediately
    if (getRole() !== 'Administrator') {
        window.location.href = 'dashboard.html';
        return;
    }

    populateSidebar();

    // Set active nav link
    const navLink = document.getElementById('nav-trash-item');
    if (navLink) navLink.classList.add('active');

    // Set topbar meta
    const metaEl = document.getElementById('topbar-user-meta');
    if (metaEl) {
        metaEl.textContent = getUsername() + ' — ' + getRole();
    }

    await _loadDeletedRecords();
}

async function _loadDeletedRecords() {
    const tbody      = document.getElementById('trashTableBody');
    const emptyEl    = document.getElementById('trashEmpty');
    const countEl    = document.getElementById('trashRecordCount');

    try {
        const records = await getDeletedRecords();

        // Update count
        if (countEl) {
            countEl.textContent = records.length > 0
                ? records.length + ' record(s)'
                : '';
        }

        if (records.length === 0) {
            if (tbody)   tbody.textContent  = '';
            if (emptyEl) emptyEl.style.display = '';
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';
        _renderTrashTable(records);

    } catch (err) {
        showToast(err.message || 'Failed to load deleted records.', 'error');
    }
}

function _renderTrashTable(records) {
    const tbody = document.getElementById('trashTableBody');
    if (!tbody) return;

    tbody.textContent = ''; // clear

    records.forEach((record, index) => {
        const tr = document.createElement('tr');

        // Helper: append a plain text cell
        function appendCell(text) {
            const td = document.createElement('td');
            td.textContent = text || '—';
            tr.appendChild(td);
        }

        appendCell(String(index + 1));
        appendCell(record.equipment_id);
        appendCell(record.maintenance_type);
        appendCell(record.responsible_person);
        appendCell(record.created_by);
        appendCell(record.deleted_by);
        appendCell(record.deleted_date
            ? new Date(record.deleted_date).toLocaleString()
            : '—'
        );

        // Restore button cell
        const actionTd  = document.createElement('td');
        const restoreBtn = document.createElement('button');
        restoreBtn.type      = 'button';
        restoreBtn.className = 'btn btn-sm btn-outline-secondary';
        restoreBtn.textContent = 'Restore';
        restoreBtn.setAttribute('data-record-id', String(record.id));
        restoreBtn.addEventListener('click', () => _openRestoreConfirm(record));
        actionTd.appendChild(restoreBtn);
        tr.appendChild(actionTd);

        tbody.appendChild(tr);
    });
}

function _openRestoreConfirm(record) {
    const modal       = document.getElementById('restoreConfirmModal');
    const equipmentEl = document.getElementById('restoreEquipmentId');
    const confirmBtn  = document.getElementById('restoreConfirmBtn');

    if (!modal || !equipmentEl || !confirmBtn) return;

    // Populate modal content via textContent — never innerHTML
    equipmentEl.textContent = record.equipment_id;

    // Remove any previous listener before adding a new one
    // Clone-replace is the cleanest approach
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    newConfirmBtn.addEventListener('click', async () => {
        setLoading(newConfirmBtn, true);
        try {
            await restoreRecord(record.id);
            bootstrap.Modal.getInstance(modal).hide();
            showToast('Record restored successfully.', 'success');
            // Reload the table to reflect the change
            await _loadDeletedRecords();
        } catch (err) {
            showToast(err.message || 'Restore failed.', 'error');
        } finally {
            setLoading(newConfirmBtn, false);
        }
    });

    new bootstrap.Modal(modal).show();
}




function _initBulkUpload(reloadTable) {
    const fileInput   = document.getElementById('equipmentBulkFileInput');
    const selectBtn   = document.getElementById('equipmentBulkSelectBtn');
    const uploadBtn   = document.getElementById('equipmentBulkUploadBtn');
    const filenameEl  = document.getElementById('equipmentBulkFilename');
    const errorsEl    = document.getElementById('equipmentBulkErrors');
    const errListEl   = document.getElementById('equipmentBulkErrorList');
    const templateBtn = document.getElementById('downloadEquipmentTemplateBtn');

    // Guard — if elements are not on this page, do nothing
    if (!fileInput || !selectBtn || !uploadBtn) return;

    // ── "Choose CSV File" button ────────────────────────────
    selectBtn.addEventListener('click', () => {
        fileInput.value = ''; // reset so the same file can be re-selected
        fileInput.click();
    });

    // ── File selected ───────────────────────────────────────
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;

        // Client-side extension check — server also validates, this is UX only
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext !== 'csv') {
            showToast(
                'Only .csv files are supported. Save your Excel file as CSV first.',
                'error'
            );
            fileInput.value        = '';
            filenameEl.textContent = 'No file chosen';
            uploadBtn.disabled     = true;
            return;
        }

        filenameEl.textContent = file.name;
        uploadBtn.disabled     = false;

        // Clear any previous error list
        _clearBulkErrors(errorsEl, errListEl);
    });

    // ── Upload button ───────────────────────────────────────
    uploadBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        setLoading(uploadBtn, true);
        _clearBulkErrors(errorsEl, errListEl);

        try {
            const result = await bulkUploadEquipment(formData);

            showToast(result.detail, 'success');

            // Reset file input state
            fileInput.value        = '';
            filenameEl.textContent = 'No file chosen';
            uploadBtn.disabled     = true;

            // Reload the equipment table to show newly added entries
            // Use the exact function name found in investigation 1.3
            await reloadTable();

        } catch (err) {
            if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
                // Validation error — show inline error list
                _showBulkErrors(err.errors, errorsEl, errListEl);
                showToast('Validation failed. See errors below.', 'error');
            } else {
                // Generic error — toast only
                showToast(err.message || 'Upload failed.', 'error');
            }
        } finally {
            setLoading(uploadBtn, false);
        }
    });

    // ── Template download ───────────────────────────────────
    if (templateBtn) {
        templateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            _downloadEquipmentTemplate();
        });
    }
}

function _clearBulkErrors(errorsEl, errListEl) {
    if (errorsEl)  errorsEl.style.display = 'none';
    if (errListEl) errListEl.textContent  = ''; // clear — never innerHTML
}

function _showBulkErrors(errors, errorsEl, errListEl) {
    if (!errorsEl || !errListEl) return;

    errListEl.textContent = ''; // clear before building — never innerHTML

    errors.forEach(msg => {
        const li = document.createElement('li');
        li.textContent = msg; // textContent only — msg comes from server
        errListEl.appendChild(li);
    });

    errorsEl.style.display = '';
    // Scroll error list into view so user sees it without scrolling manually
    errorsEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function _downloadEquipmentTemplate() {
    const header  = 'Enterprise Name,Site,Area,Work Center,Work Unit,Equipment ID';
    const example = 'Bapco,Sitra Refinery,Crude Distillation Unit,CDU Train A,Boiler Unit,BX-101';
    const csv     = header + '\r\n' + example + '\r\n';

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', 'equipment_upload_template.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url); // revoke immediately after click
}
