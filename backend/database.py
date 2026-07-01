# backend/database.py
# Database connection factory, table initialization, seeding, and parameterized query helpers.
# All database access in the application MUST go through these four helper functions.

import logging
import os
import sqlite3
from datetime import datetime, timezone

from passlib.context import CryptContext

from backend.constants import ROLES

logger = logging.getLogger(__name__)

# Bcrypt context — shared with auth.py indirectly; used here only for seeding.
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

DB_PATH = os.path.join("backend", "storage", "maintenance.db")

# ---------------------------------------------------------------------------
# Connection factory
# ---------------------------------------------------------------------------

def get_connection() -> sqlite3.Connection:
    """Return a configured SQLite connection with row_factory set to sqlite3.Row."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


# ---------------------------------------------------------------------------
# Table initialization
# ---------------------------------------------------------------------------

def init_db() -> None:
    """Create all tables if they do not already exist. Called once at app startup."""
    conn = get_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                username         TEXT    NOT NULL UNIQUE,
                hashed_password  TEXT    NOT NULL,
                role             TEXT    NOT NULL
                                     CHECK(role IN ('Administrator', 'Engineer / Operator', 'Viewer')),
                is_active        INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS maintenance_records (
                id                       INTEGER PRIMARY KEY AUTOINCREMENT,
                maintenance_type         TEXT    NOT NULL
                                             CHECK(maintenance_type IN ('Planned', 'Conducted')),
                created_time             TEXT    NOT NULL,
                equipment_id             TEXT    NOT NULL,
                operating_conditions     TEXT,
                inventory_consumables    TEXT,
                responsible_person       TEXT    NOT NULL,
                planned_start            TEXT,
                planned_end              TEXT,
                last_updated_time        TEXT,
                remarks                  TEXT,
                attachment_path          TEXT,
                attachment_original_name TEXT,
                created_by               TEXT    NOT NULL,
                created_date             TEXT    NOT NULL,
                updated_by               TEXT,
                updated_date             TEXT,
                deleted_by               TEXT,
                deleted_date             TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS record_csv_data (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id     INTEGER NOT NULL UNIQUE,
                headers       TEXT NOT NULL,
                rows          TEXT NOT NULL,
                uploaded_by   TEXT NOT NULL,
                uploaded_date TEXT NOT NULL,
                updated_by    TEXT,
                updated_date  TEXT,
                FOREIGN KEY (record_id) REFERENCES maintenance_records(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS record_attachments (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id         INTEGER NOT NULL,
                file_path         TEXT    NOT NULL,
                original_filename TEXT    NOT NULL,
                file_size_bytes   INTEGER,
                uploaded_by       TEXT    NOT NULL,
                uploaded_date     TEXT    NOT NULL,
                FOREIGN KEY (record_id) REFERENCES maintenance_records(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS migrations_applied (
                migration_name TEXT PRIMARY KEY,
                applied_at     TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS equipment (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                code          TEXT    NOT NULL UNIQUE,
                name          TEXT    NOT NULL,
                category      TEXT    NOT NULL,
                is_active     INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.commit()
        logger.info("Database tables initialized successfully.")
    finally:
        conn.close()

    seed_equipment()

    # Migrate existing databases — add new columns if absent.
    # The old date_time column is intentionally left on existing installations
    # (SQLite DROP COLUMN is not reliably supported in older versions).
    # No code anywhere reads from or writes to date_time going forward.
    add_column_if_not_exists("maintenance_records", "created_time", "TEXT")
    add_column_if_not_exists("maintenance_records", "planned_start", "TEXT")
    add_column_if_not_exists("maintenance_records", "planned_end", "TEXT")
    add_column_if_not_exists("maintenance_records", "last_updated_time", "TEXT")

    # One-time data migration: copy legacy single-attachment data to record_attachments.
    _run_attachment_migration_v1()


# ---------------------------------------------------------------------------
# Equipment seed data
# ---------------------------------------------------------------------------

def seed_equipment() -> None:
    """Insert the canonical equipment list if the equipment table is empty.

    Idempotent: checks for existing rows before inserting and skips entirely
    if any rows are present. Safe to call on every startup.
    """
    existing = fetch_one("SELECT COUNT(*) as count FROM equipment", ())
    if existing and existing["count"] > 0:
        logger.info("Equipment table already seeded — skipping.")
        return

    equipment_seed = [
        # FIC series
        ("FIC-100", "FIC-100", "FIC"),
        ("FIC-101", "FIC-101", "FIC"),
        ("FIC-102", "FIC-102", "FIC"),
        ("FIC-103", "FIC-103", "FIC"),
        ("FIC-104", "FIC-104", "FIC"),
        ("FIC-105", "FIC-105", "FIC"),
        ("FIC-106", "FIC-106", "FIC"),
        ("FIC-107", "FIC-107", "FIC"),
        ("FIC-108", "FIC-108", "FIC"),
        ("FIC-109", "FIC-109", "FIC"),
        ("FIC-110", "FIC-110", "FIC"),
        ("FIC-111", "FIC-111", "FIC"),
        ("FIC-112", "FIC-112", "FIC"),
        ("FIC-113", "FIC-113", "FIC"),
        ("FIC-114", "FIC-114", "FIC"),
        ("FIC-115", "FIC-115", "FIC"),
        ("FIC-116", "FIC-116", "FIC"),
        ("FIC-117", "FIC-117", "FIC"),
        ("FIC-118", "FIC-118", "FIC"),
        ("FIC-119", "FIC-119", "FIC"),
        ("FIC-120", "FIC-120", "FIC"),
        # ROS series
        ("ROS-100", "ROS-100", "ROS"),
        ("ROS-101", "ROS-101", "ROS"),
        ("ROS-102", "ROS-102", "ROS"),
        ("ROS-103", "ROS-103", "ROS"),
        ("ROS-104", "ROS-104", "ROS"),
        ("ROS-105", "ROS-105", "ROS"),
        ("ROS-106", "ROS-106", "ROS"),
        ("ROS-107", "ROS-107", "ROS"),
        ("ROS-108", "ROS-108", "ROS"),
        ("ROS-109", "ROS-109", "ROS"),
        ("ROS-110", "ROS-110", "ROS"),
        # KYC series
        ("KYC-100", "KYC-100", "KYC"),
        ("KYC-101", "KYC-101", "KYC"),
        ("KYC-102", "KYC-102", "KYC"),
        ("KYC-103", "KYC-103", "KYC"),
        ("KYC-104", "KYC-104", "KYC"),
        ("KYC-105", "KYC-105", "KYC"),
        ("KYC-106", "KYC-106", "KYC"),
        ("KYC-107", "KYC-107", "KYC"),
        ("KYC-108", "KYC-108", "KYC"),
        ("KYC-109", "KYC-109", "KYC"),
        ("KYC-110", "KYC-110", "KYC"),
        ("KYC-111", "KYC-111", "KYC"),
        ("KYC-112", "KYC-112", "KYC"),
        ("KYC-113", "KYC-113", "KYC"),
        ("KYC-114", "KYC-114", "KYC"),
        ("KYC-115", "KYC-115", "KYC"),
        ("KYC-116", "KYC-116", "KYC"),
        ("KYC-117", "KYC-117", "KYC"),
        ("KYC-118", "KYC-118", "KYC"),
        ("KYC-119", "KYC-119", "KYC"),
        ("KYC-120", "KYC-120", "KYC"),
    ]
    for code, name, category in equipment_seed:
        execute(
            "INSERT INTO equipment (code, name, category) VALUES (?, ?, ?)",
            (code, name, category),
        )
    logger.info("Equipment table seeded with %d entries.", len(equipment_seed))


# ---------------------------------------------------------------------------
# One-time data migration
# ---------------------------------------------------------------------------

def _run_attachment_migration_v1() -> None:
    """Copy legacy attachment_path / attachment_original_name data into record_attachments.

    This migration is guarded by the migrations_applied table: it runs exactly
    once per database and is a no-op on all subsequent startups.  The original
    attachment_path and attachment_original_name columns on maintenance_records
    are left untouched — this is an additive, non-destructive migration.
    """
    conn = get_connection()
    try:
        applied = conn.execute(
            "SELECT 1 FROM migrations_applied WHERE migration_name = ?",
            ("attachment_migration_v1",),
        ).fetchone()

        if applied:
            logger.info("Attachment migration v1 already applied — skipping.")
            return

        legacy_rows = conn.execute(
            "SELECT id, attachment_path, attachment_original_name, created_by, created_date "
            "FROM maintenance_records WHERE attachment_path IS NOT NULL"
        ).fetchall()

        for row in legacy_rows:
            conn.execute(
                "INSERT INTO record_attachments "
                "(record_id, file_path, original_filename, uploaded_by, uploaded_date) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    row["id"],
                    row["attachment_path"],
                    row["attachment_original_name"] or "",
                    row["created_by"],
                    row["created_date"] or "",
                ),
            )

        conn.execute(
            "INSERT INTO migrations_applied (migration_name, applied_at) VALUES (?, ?)",
            ("attachment_migration_v1", datetime.now(tz=timezone.utc).isoformat()),
        )
        conn.commit()
        logger.info(
            "Attachment migration v1 complete: %d legacy attachment(s) migrated.",
            len(legacy_rows),
        )
    except Exception:
        logger.exception("Attachment migration v1 failed — will retry on next startup.")
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Schema migration helper
# ---------------------------------------------------------------------------

def add_column_if_not_exists(table: str, column: str, definition: str) -> None:
    """Add a column to an existing table only if it does not already exist.

    Uses PRAGMA table_info to inspect the current schema — safe to call
    on every startup without duplicating columns.
    """
    existing = fetch_all(f"PRAGMA table_info({table})", ())
    column_names = [row["name"] for row in existing]
    if column not in column_names:
        execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}", ())


# ---------------------------------------------------------------------------
# Default admin seeding
# ---------------------------------------------------------------------------

def seed_default_admin() -> None:
    """Insert a default Administrator account if the users table is empty.

    Credentials are loaded from the DEFAULT_ADMIN_USER and DEFAULT_ADMIN_PASSWORD
    environment variables. Logs a warning if either variable is not set.
    """
    default_user = os.getenv("DEFAULT_ADMIN_USER")
    default_password = os.getenv("DEFAULT_ADMIN_PASSWORD")

    if not default_user:
        logger.warning(
            "DEFAULT_ADMIN_USER is not set. Skipping default admin seeding."
        )
        return
    if not default_password:
        logger.warning(
            "DEFAULT_ADMIN_PASSWORD is not set. Skipping default admin seeding."
        )
        return

    existing = fetch_one("SELECT id FROM users LIMIT 1", ())
    if existing is not None:
        logger.info("Users table is not empty — skipping default admin seeding.")
        return

    hashed = _pwd_context.hash(default_password)
    execute(
        "INSERT INTO users (username, hashed_password, role) VALUES (?, ?, ?)",
        (default_user, hashed, ROLES["ADMIN"]),
    )
    logger.info("Default administrator account '%s' created.", default_user)


# ---------------------------------------------------------------------------
# Parameterized query helpers
# ---------------------------------------------------------------------------

def fetch_one(query: str, params: tuple):
    """Execute a SELECT query and return the first row, or None if no rows match."""
    conn = get_connection()
    try:
        cursor = conn.execute(query, params)
        row = cursor.fetchone()
        return row
    finally:
        conn.close()


def fetch_all(query: str, params: tuple) -> list:
    """Execute a SELECT query and return all matching rows."""
    conn = get_connection()
    try:
        cursor = conn.execute(query, params)
        rows = cursor.fetchall()
        return rows
    finally:
        conn.close()


def execute(query: str, params: tuple) -> int:
    """Execute an INSERT, UPDATE, or DELETE query and return the lastrowid."""
    conn = get_connection()
    try:
        cursor = conn.execute(query, params)
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()
