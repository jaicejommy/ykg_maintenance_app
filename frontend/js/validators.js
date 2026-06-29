/**
 * frontend/js/validators.js
 * Pure validation functions — no DOM side effects.
 * Each function takes a value and returns { valid: boolean, message: string }.
 */

/**
 * Validate that a value is non-empty (after trimming).
 * @param {string} value
 * @param {string} fieldName
 * @returns {{ valid: boolean, message: string }}
 */
function validateRequired(value, fieldName) {
  const trimmed = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!trimmed) {
    return { valid: false, message: `${fieldName} is required.` };
  }
  return { valid: true, message: "" };
}

/**
 * Validate that a string does not exceed a maximum character length.
 * @param {string} value
 * @param {number} max
 * @param {string} fieldName
 * @returns {{ valid: boolean, message: string }}
 */
function validateMaxLength(value, max, fieldName) {
  if (value && value.length > max) {
    return {
      valid: false,
      message: `${fieldName} must be at most ${max} characters (currently ${value.length}).`,
    };
  }
  return { valid: true, message: "" };
}

/**
 * Validate that a datetime-local value is a non-empty, parsable date string.
 * @param {string} value
 * @returns {{ valid: boolean, message: string }}
 */
function validateDatetime(value) {
  if (!value || !value.trim()) {
    return { valid: false, message: "Date / Time is required." };
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return { valid: false, message: "Date / Time is not a valid date." };
  }
  return { valid: true, message: "" };
}

/**
 * Validate that a maintenance type is one of the allowed values.
 * @param {string} value
 * @returns {{ valid: boolean, message: string }}
 */
function validateMaintenanceType(value) {
  if (!value || !MAINTENANCE_TYPES.includes(value)) {
    return {
      valid: false,
      message: `Maintenance Type must be one of: ${MAINTENANCE_TYPES.join(", ")}.`,
    };
  }
  return { valid: true, message: "" };
}

/**
 * Validate that a File object has an allowed extension.
 * @param {File} file
 * @returns {{ valid: boolean, message: string }}
 */
function validateFileType(file) {
  if (!file) return { valid: true, message: "" };

  const name = file.name || "";
  const dotIndex = name.lastIndexOf(".");
  const ext = dotIndex !== -1 ? name.slice(dotIndex).toLowerCase() : "";

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      message: `File type "${ext || "(none)"}" is not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }
  return { valid: true, message: "" };
}

/**
 * Validate that a File object does not exceed the maximum size in megabytes.
 * @param {File} file
 * @param {number} maxMB
 * @returns {{ valid: boolean, message: string }}
 */
function validateFileSize(file, maxMB) {
  if (!file) return { valid: true, message: "" };

  const maxBytes = maxMB * 1024 * 1024;
  if (file.size > maxBytes) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      message: `File size (${sizeMB} MB) exceeds the maximum allowed size of ${maxMB} MB.`,
    };
  }
  return { valid: true, message: "" };
}

/**
 * Validate that a role value is one of the allowed roles.
 * @param {string} value
 * @returns {{ valid: boolean, message: string }}
 */
function validateRole(value) {
  const validRoles = Object.values(ROLES);
  if (!value || !validRoles.includes(value)) {
    return {
      valid: false,
      message: `Role must be one of: ${validRoles.join(", ")}.`,
    };
  }
  return { valid: true, message: "" };
}

/**
 * Validate a username for the user-management form.
 * Required, max 50 chars, only alphanumeric characters and underscores.
 * @param {string} value
 * @returns {{ valid: boolean, message: string }}
 */
function validateUsername(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return { valid: false, message: "Username is required." };
  }
  if (trimmed.length > 50) {
    return { valid: false, message: "Username must be at most 50 characters." };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return {
      valid: false,
      message: "Username may only contain letters, numbers, and underscores.",
    };
  }
  return { valid: true, message: "" };
}

/**
 * Validate a password for the user-management form.
 * Required, minimum 8 characters.
 * @param {string} value
 * @returns {{ valid: boolean, message: string }}
 */
function validatePassword(value) {
  if (!value) {
    return { valid: false, message: "Password is required." };
  }
  if (value.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters." };
  }
  return { valid: true, message: "" };
}

/**
 * Validate that the confirm-password field matches the password field.
 * @param {string} password
 * @param {string} confirmPassword
 * @returns {{ valid: boolean, message: string }}
 */
function validateConfirmPassword(password, confirmPassword) {
  if (!confirmPassword) {
    return { valid: false, message: "Please confirm your password." };
  }
  if (password !== confirmPassword) {
    return { valid: false, message: "Passwords do not match." };
  }
  return { valid: true, message: "" };
}
