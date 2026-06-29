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
    """Create both tables if they do not already exist. Called once at app startup."""
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
                operating_conditions     TEXT,
                inventory_consumables    TEXT,
                equipment_id             TEXT    NOT NULL,
                date_time                TEXT    NOT NULL,
                responsible_person       TEXT    NOT NULL,
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
        conn.commit()
        logger.info("Database tables initialized successfully.")
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
