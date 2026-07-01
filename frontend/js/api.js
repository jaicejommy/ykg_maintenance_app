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
      detail = body.detail;
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
 * @param {number} recordId
 * @returns {Promise<{headers: string[], rows: string[][]}>}
 */
async function getCsvData(recordId) {
  const response = await fetch(`${API_BASE}/api/csv/${recordId}`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
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
 * @param {{ category?: string, active_only?: boolean }} params
 * @returns {Promise<Array>}
 */
async function getEquipment(params = {}) {
  const query = Object.keys(params).length
    ? "?" + new URLSearchParams(params).toString()
    : "";
  const response = await fetch(`${API_BASE}/api/equipment${query}`, {
    method: "GET",
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }
  return response.json();
}

