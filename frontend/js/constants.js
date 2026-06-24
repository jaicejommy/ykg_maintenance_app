/**
 * frontend/js/constants.js
 * Shared frontend constants — mirrors backend/constants.py.
 * Import or reference this file before any other JS module.
 */

const ROLES = {
  ADMIN:    "Administrator",
  ENGINEER: "Engineer / Operator",
  VIEWER:   "Viewer",
};

const MAINTENANCE_TYPES = ["Planned", "Conducted"];

const ALLOWED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".jpg", ".jpeg", ".png"];

// Max upload size in MB (overridden dynamically from the server; used as a default fallback)
const DEFAULT_MAX_UPLOAD_MB = 10;

// Field character limits — must match backend/constants.py
const MAX_EQUIPMENT_ID_LENGTH      = 100;
const MAX_RESPONSIBLE_PERSON_LENGTH = 100;
const MAX_TEXT_FIELD_LENGTH        = 500;
const MAX_REMARKS_LENGTH           = 2000;

// Session storage keys
const SESSION_KEYS = {
  TOKEN:    "ykg_token",
  ROLE:     "ykg_role",
  USERNAME: "ykg_username",
};

// API base — same origin as the served frontend
const API_BASE = "";

// Toast auto-dismiss delay (ms)
const TOAST_DURATION_MS = 4000;

// Redirect delay after successful form submission (ms)
const SUCCESS_REDIRECT_DELAY_MS = 1500;
