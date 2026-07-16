/**
 * frontend/js/api.js
 * API client — one exported async function per endpoint.
 *
 * Rules:
 *  - Every function attaches "Authorization: Bearer <token>" on non-login calls.
 *  - On non-2xx responses, throws an Error with the server's "detail" message.
 *  - Never catches errors internally — callers handle them.
 */

/**
 * Build common request headers, including the JWT bearer token.
 * @returns {HeadersInit}
 */
function buildAuthHeaders() {
  return {
    Authorization: `Bearer ${getToken()}`,
  };
}

/**
 * Parse a non-2xx response and throw an Error with the server's detail message.
 * @param {Response} response
 */
async function throwResponseError(response) {
  let detail = `HTTP ${response.status}: ${response.statusText}`;
  try {
    const body = await response.json();
    if (body && body.detail) {
      if (Array.isArray(body.detail)) {
        // Pydantic validation error array
        detail = body.detail.map(e => e.msg).join(", ");
      } else {
        detail = body.detail;
      }
    }
  } catch (_) {
    // JSON parse failed — use the default status text
  }
  throw new Error(detail);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Authenticate a user and return the token payload.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{access_token: string, token_type: string, role: string, username: string}>}
 */
async function login(username, password) {
  const formData = new FormData();
  formData.append("username", username);
  formData.append("password", password);

  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Auth (continued)
// ---------------------------------------------------------------------------

/**
 * Change the currently authenticated user's own password.
 * Identity is derived from the JWT only — no user_id is sent.
 * @param {string} currentPassword
 * @param {string} newPassword
 * @param {string} confirmNewPassword
 * @returns {Promise<{detail: string}>}
 */
async function changePassword(currentPassword, newPassword, confirmNewPassword) {
  const response = await fetch(`${API_BASE}/api/auth/change-password`, {
    method: "PUT",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      current_password:     currentPassword,
      new_password:         newPassword,
      confirm_new_password: confirmNewPassword,
    }),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Create a new user account (Administrator only).
 * @param {{ username: string, password: string, role: string }} userData
 * @returns {Promise<object>}
 */
async function createUser(userData) {
  const response = await fetch(`${API_BASE}/api/users`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userData),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Fetch all user accounts (Administrator only).
 * @returns {Promise<Array>}
 */
async function getUsers() {
  const response = await fetch(`${API_BASE}/api/users`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Update a user's role, active status, or password (Administrator only).
 * @param {number} id
 * @param {{ role?: string, is_active?: boolean, password?: string }} userData
 * @returns {Promise<object>}
 */
async function updateUser(id, userData) {
  const response = await fetch(`${API_BASE}/api/users/${id}`, {
    method: "PUT",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userData),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * Fetch all active maintenance records, with optional filters.
 * @param {{ type?: string, search?: string }} filters
 * @returns {Promise<Array>}
 */
async function getRecords(filters = {}) {
  const params = new URLSearchParams();
  if (filters.type)   params.append("type",   filters.type);
  if (filters.search) params.append("search", filters.search);
  if (filters.sortBy) params.append("sort_by", filters.sortBy);
  if (filters.sortOrder) params.append("sort_order", filters.sortOrder);

  const qs = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE}/api/records${qs}`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Create a new maintenance record (multipart/form-data).
 * Files must be appended to formData as "attachments" (multiple allowed).
 * @param {FormData} formData
 * @returns {Promise<object>}
 */
async function createRecord(formData) {
  const response = await fetch(`${API_BASE}/api/records`, {
    method: "POST",
    headers: buildAuthHeaders(), // Do NOT set Content-Type — browser sets multipart boundary
    body: formData,
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Update an existing maintenance record (multipart/form-data).
 * New files appended as "attachments" are ADDED to existing attachments.
 * @param {number} id
 * @param {FormData} formData
 * @returns {Promise<object>}
 */
async function updateRecord(id, formData) {
  const response = await fetch(`${API_BASE}/api/records/${id}`, {
    method: "PUT",
    headers: buildAuthHeaders(),
    body: formData,
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Soft-delete a record (Administrator only).
 * @param {number} id
 * @returns {Promise<object>}
 */
async function deleteRecord(id) {
  const response = await fetch(`${API_BASE}/api/records/${id}`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Fetch deleted maintenance records (Administrator only).
 * @returns {Promise<Array>}
 */
async function getDeletedRecords() {
  const response = await fetch(`${API_BASE}/api/records?status=deleted`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Restore a soft-deleted record (Administrator only).
 * @param {number} recordId
 * @returns {Promise<object>}
 */
async function restoreRecord(recordId) {
  const response = await fetch(`${API_BASE}/api/records/${recordId}/restore`, {
    method: "PATCH",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Fetch the list of attachments for a record.
 * Returns an array of AttachmentOut objects (id, record_id, original_filename,
 * file_size_bytes, uploaded_by, uploaded_date).
 * @param {number} recordId
 * @returns {Promise<Array>}
 */
async function getRecordAttachments(recordId) {
  const response = await fetch(`${API_BASE}/api/records/${recordId}/attachments`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Trigger a file download for a specific attachment by its attachment_id.
 * Uses a temporary hidden <a> element with an object URL so the JWT header can be sent.
 * @param {number} attachmentId  — record_attachments.id (NOT the record's id)
 * @param {string} filename      — Suggested download filename
 */
async function downloadAttachment(attachmentId, filename) {
  const response = await fetch(`${API_BASE}/api/attachments/${attachmentId}`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename || `attachment_${attachmentId}`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();

  // Cleanup
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    document.body.removeChild(anchor);
  }, 100);
}

/**
 * Delete a specific attachment by its attachment_id (Bug 2 fix).
 * Calls DELETE /api/attachments/{attachmentId} — keyed by attachment_id,
 * not by record_id. Engineers may only delete from records they created.
 * @param {number} attachmentId  — record_attachments.id (NOT the record's id)
 * @returns {Promise<object>}
 */
async function deleteAttachment(attachmentId) {
  const response = await fetch(`${API_BASE}/api/attachments/${attachmentId}`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// CSV data
// ---------------------------------------------------------------------------

/**
 * Fetch CSV data for a record.
 * Returns { headers: string[], rows: string[][] } or throws on non-2xx.
 * The thrown Error has a `.status` property set to the HTTP status code so
 * callers can distinguish 404 (no CSV yet) from genuine server errors.
 * @param {number} recordId
 * @returns {Promise<{headers: string[], rows: string[][]}>}
 */
async function getCsvData(recordId) {
  const response = await fetch(`${API_BASE}/api/csv/${recordId}`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const body = await response.json();
      if (body && body.detail) detail = body.detail;
    } catch (_) {
      // JSON parse failed — use the default status text
    }
    const err = new Error(detail);
    err.status = response.status; // attach status for caller to check
    throw err;
  }
  return response.json();
}

/**
 * Upload a CSV file for a record (multipart/form-data).
 * @param {number} recordId
 * @param {FormData} formData - must include field "csv_file"
 * @returns {Promise<{headers: string[], rows: string[][], row_count: number, col_count: number}>}
 */
async function uploadCsv(recordId, formData) {
  const response = await fetch(`${API_BASE}/api/csv/${recordId}`, {
    method: "POST",
    headers: buildAuthHeaders(), // Do NOT set Content-Type — browser sets multipart boundary
    body: formData,
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Save edited CSV grid data for a record.
 * @param {number} recordId
 * @param {{ headers: string[], rows: string[][] }} data
 * @returns {Promise<{headers: string[], rows: string[][]}>}
 */
async function saveCsvData(recordId, data) {
  const response = await fetch(`${API_BASE}/api/csv/${recordId}`, {
    method: "PUT",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Download the CSV file for a record.
 * Checks response.ok before reading as Blob; surfaces error detail if not ok.
 * Creates a temporary <a> element, triggers click, then immediately revokes the object URL.
 * @param {number} recordId
 */
async function downloadCsv(recordId) {
  const response = await fetch(`${API_BASE}/api/csv/${recordId}/download`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    // Read error as JSON to extract the detail message
    let detail = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const body = await response.json();
      if (body && body.detail) detail = body.detail;
    } catch (_) {
      // ignore JSON parse failure
    }
    throw new Error(detail);
  }

  const blob      = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const filename  = `record_${recordId}_data.csv`;

  const anchor = document.createElement("a");
  anchor.setAttribute("href", objectUrl);
  anchor.setAttribute("download", filename);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();

  // Revoke immediately after click
  URL.revokeObjectURL(objectUrl);
  document.body.removeChild(anchor);
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

/**
 * Fetch the active equipment list from the master table.
 * @param {string} search
 * @param {boolean} activeOnly
 * @returns {Promise<Array>}
 */
async function getEquipmentList(search = '', activeOnly = true) {
  const params = new URLSearchParams();
  if (search) params.append("search", search);
  params.append("active_only", activeOnly.toString());

  const response = await fetch(`${API_BASE}/api/equipment?${params.toString()}`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Create a new equipment in the master hierarchy.
 * @param {object} data
 * @returns {Promise<object>}
 */
async function createEquipment(data) {
  const response = await fetch(`${API_BASE}/api/equipment`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Update an existing equipment (e.g. toggle active status).
 * @param {number} id
 * @param {object} data
 * @returns {Promise<object>}
 */
async function updateEquipment(id, data) {
  const response = await fetch(`${API_BASE}/api/equipment/${id}`, {
    method: "PUT",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Delete an equipment from the master hierarchy.
 * @param {number} id
 * @returns {Promise<object>}
 */
async function deleteEquipment(id) {
  const response = await fetch(`${API_BASE}/api/equipment/${id}`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// PDF Export
// ---------------------------------------------------------------------------

/**
 * Export a single maintenance record as a PDF and trigger a browser download.
 * Calls GET /api/export/{recordId}/pdf with a JWT Bearer header.
 * On success, triggers an in-browser download of the returned PDF blob.
 * On non-2xx, extracts the server's detail message and throws an Error.
 * The temporary <a> element is removed immediately after .click() and the
 * object URL is revoked immediately to prevent memory leaks.
 * @param {number} recordId
 */
async function exportRecordPdf(recordId) {
  const response = await fetch(`${API_BASE}/api/export/${recordId}/pdf`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    let detail = "PDF export failed.";
    try {
      const err = await response.json();
      if (err.detail) detail = err.detail;
    } catch (_) {
      // JSON parse failed — use the default message
    }
    throw new Error(detail);
  }

  const blob = await response.blob();

  // Trigger download via temporary <a> element
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.setAttribute("href", url);
  a.setAttribute("download", `record_${recordId}_export.pdf`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoke immediately after the click to avoid memory leaks
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Bulk Operations
// ---------------------------------------------------------------------------

/**
 * Bulk soft-delete a list of records (Administrator only).
 * DELETE /api/records/bulk
 * Body: JSON { "record_ids": [...] }
 * Returns: { "deleted": n, "skipped": n }
 * Throws Error(detail) on non-2xx.
 * @param {number[]} recordIds
 * @returns {Promise<{deleted: number, skipped: number}>}
 */
async function bulkDeleteRecords(recordIds) {
  const response = await fetch(`${API_BASE}/api/records/bulk`, {
    method: "DELETE",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ record_ids: recordIds }),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

/**
 * Export multiple records as PDFs by calling exportRecordPdf() sequentially.
 * No API call of its own — delegates to exportRecordPdf() per record.
 * A 600 ms delay between downloads prevents the browser from blocking them.
 * Never throws — per-record errors are caught internally and counted.
 * onProgress(completed, total) is called after each record (success or failure).
 * @param {number[]} recordIds
 * @param {function(number, number)|undefined} onProgress
 * @returns {Promise<{succeeded: number, failed: number}>}
 */
async function exportRecordsPdfBulk(recordIds, onProgress) {
  let succeeded = 0;
  let failed    = 0;
  const total   = recordIds.length;

  for (let i = 0; i < recordIds.length; i++) {
    try {
      await exportRecordPdf(recordIds[i]);
      succeeded++;
    } catch (_) {
      failed++;
    }
    if (onProgress) onProgress(i + 1, total);
    // Delay between downloads to prevent browser from blocking them
    if (i < recordIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 600));
    }
  }
  return { succeeded, failed };
}

/**
 * Upload a CSV file containing multiple equipment entries (Administrator only).
 * Content-Type is intentionally omitted — the browser sets multipart/form-data
 * with the correct boundary automatically when the body is a FormData object.
 * On 422, err.errors contains the per-row validation error array.
 * @param {FormData} formData - must include field "file" (.csv)
 * @returns {Promise<{detail: string, inserted: number, skipped: number, total: number}>}
 */
async function bulkUploadEquipment(formData) {
    // POST /api/equipment/bulk
    // Body: FormData with field "file"
    // IMPORTANT: Do NOT set Content-Type header manually.
    //            The browser sets it automatically with the correct
    //            multipart boundary when sending FormData.
    const response = await fetch(`${API_BASE}/api/equipment/bulk`, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + getToken()
            // Content-Type intentionally omitted
        },
        body: formData,
    });

    if (!response.ok) {
        let message = 'Bulk upload failed.';
        let errors  = null;
        try {
            const err = await response.json();
            // Handle nested validation error structure from 422 responses
            if (err.detail && typeof err.detail === 'object') {
                message = err.detail.message || message;
                errors  = err.detail.errors  || null;
            } else if (err.detail) {
                message = err.detail;
            }
        } catch (_) { /* response was not JSON — use fallback message */ }

        const error   = new Error(message);
        error.errors  = errors; // attach errors array for caller to display
        throw error;
    }

    return response.json();
}
