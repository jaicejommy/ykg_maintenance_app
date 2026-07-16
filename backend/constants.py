# backend/constants.py
# All named constants for the Yokogawa Maintenance Data Entry & Management System.
# Import from this module everywhere — never use inline strings or magic numbers.

# ---------------------------------------------------------------------------
# User roles
# ---------------------------------------------------------------------------
ROLES = {
    "ADMIN": "Administrator",
    "ENGINEER": "Engineer / Operator",
    "VIEWER": "Viewer",
}

# All valid role strings (used for validation)
VALID_ROLES = set(ROLES.values())

# ---------------------------------------------------------------------------
# Maintenance record types
# ---------------------------------------------------------------------------
MAINTENANCE_TYPES = ["Planned", "Conducted"]

# ---------------------------------------------------------------------------
# Sort configurations
# ---------------------------------------------------------------------------
ALLOWED_SORT_COLUMNS = {
    "id",
    "created_time",
    "planned_start",
    "planned_end",
    "last_updated_time",
    "equipment_id",
    "maintenance_type",
    "responsible_person",
}


# ---------------------------------------------------------------------------
# File upload constraints
# ---------------------------------------------------------------------------
ALLOWED_EXTENSIONS = {".pdf", ".xlsx", ".xls", ".jpg", ".jpeg", ".png"}

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "image/jpeg",
    "image/png",
}

# Maximum number of attachments allowed per maintenance record (create + edit combined).
MAX_ATTACHMENTS_PER_RECORD = 10

# ---------------------------------------------------------------------------
# Field length limits
# ---------------------------------------------------------------------------
MAX_USERNAME_LENGTH = 50
MAX_EQUIPMENT_ID_LENGTH = 100
MAX_RESPONSIBLE_PERSON_LENGTH = 100
MAX_TEXT_FIELD_LENGTH = 500
MAX_REMARKS_LENGTH = 2000

# ---------------------------------------------------------------------------
# Storage paths
# ---------------------------------------------------------------------------
ATTACHMENTS_DIR = "backend/storage/attachments"

# ---------------------------------------------------------------------------
# JWT / session constants (names only — actual values come from env)
# ---------------------------------------------------------------------------
TOKEN_TYPE = "bearer"

# ---------------------------------------------------------------------------
# HTTP status codes used throughout (for documentation clarity)
# ---------------------------------------------------------------------------
HTTP_200_OK = 200
HTTP_201_CREATED = 201
HTTP_401_UNAUTHORIZED = 401
HTTP_403_FORBIDDEN = 403
HTTP_404_NOT_FOUND = 404
HTTP_422_UNPROCESSABLE = 422
HTTP_500_INTERNAL = 500
