# Yokogawa Maintenance Data Entry & Management System

A plant intranet CRUD application for capturing and managing manual maintenance records.
Built with **FastAPI** (Python) backend and a plain HTML5/CSS3/JavaScript frontend — zero build steps.

---

## ⚠️ Default Credentials Warning

> **IMPORTANT:** The system seeds a default Administrator account on first startup.
> **Change the default password immediately after your first login.**
> Failure to do so is a critical security risk.
> Default credentials are set via `DEFAULT_ADMIN_USER` / `DEFAULT_ADMIN_PASSWORD` in your `.env` file.

---

## 1. Prerequisites

| Requirement | Version |
|---|---|
| Python | 3.11 or later |
| pip | bundled with Python |

Check your version:
```bash
python --version
```

---

## 2. Installation

### Step 1 — Clone or copy the project

Place the `ykg_maintenance_app/` folder on the host machine that will serve the intranet.

### Step 2 — Create a virtual environment

```bash
# Windows (PowerShell)
cd ykg_maintenance_app
python -m venv venv
.\venv\Scripts\Activate.ps1

# Linux / macOS
cd ykg_maintenance_app
python3 -m venv venv
source venv/bin/activate
```

### Step 3 — Install Python dependencies

```bash
pip install -r backend/requirements.txt
```

### Step 4 — Bootstrap JS/CSS assets (already included)

The `frontend/css/bootstrap.min.css` and `frontend/js/bootstrap.bundle.min.js` files are
included in the repository. **No CDN access is required** — the application is fully
self-contained for air-gapped plant networks.

---

## 3. Configuration

### Step 1 — Create your `.env` file

```bash
cp .env.example .env
```

### Step 2 — Edit `.env` and set real values

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | **Yes** | Long random string (min 32 chars) for signing JWTs. Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ALGORITHM` | No | JWT algorithm. Default: `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | Session length in minutes. Default: `480` (8 hours) |
| `DEFAULT_ADMIN_USER` | **Yes** | Username for the seeded admin account |
| `DEFAULT_ADMIN_PASSWORD` | **Yes** | Password for the seeded admin account — **change after first login** |
| `MAX_UPLOAD_SIZE_MB` | No | Max file upload size in MB. Default: `10` |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins. Leave blank to allow all (intranet only). |

---

## 4. Database Initialization

The SQLite database (`backend/storage/maintenance.db`) is **created automatically** on first
startup. Both tables (`users` and `maintenance_records`) are created with `CREATE TABLE IF NOT EXISTS`.

If the `users` table is empty when the server starts, a default Administrator account is seeded
using the `DEFAULT_ADMIN_USER` and `DEFAULT_ADMIN_PASSWORD` values from `.env`.

You do not need to run any migrations or seed scripts manually.

---

## 5. Running the Server

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

- `--host 0.0.0.0` — listens on all network interfaces (required for LAN access).
- `--port 8000` — change if port 8000 is in use.
- `--reload` — auto-restarts on code changes. **Remove this flag in production.**

For production (no auto-reload):
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 2
```

---

## 6. Accessing the Application on the Network

### Find the host machine's local IP address

**Windows:**
```powershell
ipconfig
# Look for "IPv4 Address" under your active adapter (Ethernet or Wi-Fi)
```

**Linux:**
```bash
ip addr show
# or
hostname -I
```

Once you have the IP (e.g. `192.168.1.100`), any machine on the same LAN can access the app at:
```
http://192.168.1.100:8000
```

### Setting a Static IP (recommended for plant use)

Using a static IP ensures the URL never changes.

**Windows (via Settings):**
1. Open **Settings → Network & Internet → Ethernet (or Wi-Fi) → IP settings**
2. Change IP assignment to **Manual**
3. Enter: IP address, Subnet mask (`255.255.255.0`), Gateway (your router IP)
4. Click Save

**Windows (via PowerShell — requires Administrator):**
```powershell
New-NetIPAddress -InterfaceAlias "Ethernet" -IPAddress 192.168.1.100 -PrefixLength 24 -DefaultGateway 192.168.1.1
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses 8.8.8.8
```

**Linux (NetworkManager / nmcli):**
```bash
nmcli con mod "Wired connection 1" ipv4.addresses 192.168.1.100/24
nmcli con mod "Wired connection 1" ipv4.gateway 192.168.1.1
nmcli con mod "Wired connection 1" ipv4.method manual
nmcli con up "Wired connection 1"
```

**Linux (systemd-networkd — `/etc/systemd/network/10-eth0.network`):**
```ini
[Match]
Name=eth0

[Network]
Address=192.168.1.100/24
Gateway=192.168.1.1
```

---

## 7. Backup Procedure

All persistent data lives in two locations. Back up **both** together.

| Item | Path |
|---|---|
| SQLite database | `backend/storage/maintenance.db` |
| Uploaded attachments | `backend/storage/attachments/` |

**Recommended backup steps:**
1. Stop the server (or ensure no writes are in progress).
2. Copy `backend/storage/maintenance.db` to external media.
3. Copy the entire `backend/storage/attachments/` directory.
4. Verify the copy with a file size or checksum check.
5. Restart the server.

**Example (Windows PowerShell):**
```powershell
$backup = "D:\backups\ykg_maintenance_$(Get-Date -Format 'yyyyMMdd_HHmm')"
New-Item -ItemType Directory -Path $backup
Copy-Item backend\storage\maintenance.db $backup\
Copy-Item backend\storage\attachments\ $backup\attachments\ -Recurse
```

**Example (Linux):**
```bash
BACKUP="/mnt/usb/ykg_backup_$(date +%Y%m%d_%H%M)"
mkdir -p "$BACKUP"
cp backend/storage/maintenance.db "$BACKUP/"
cp -r backend/storage/attachments/ "$BACKUP/attachments/"
```

---

## 8. User Roles

| Role | Create Records | Edit Own Records | Edit All Records | Delete Records | Manage Users |
|---|---|---|---|---|---|
| **Administrator** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Engineer / Operator** | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Viewer** | ✗ | ✗ | ✗ | ✗ | ✗ |

---

## 9. API Documentation

When the server is running, interactive API docs are available at:
- **Swagger UI:** `http://<host>:8000/api/docs`
- **ReDoc:**      `http://<host>:8000/api/redoc`

---

## Quick Start

```bash
# 1. Navigate into the project directory
cd ykg_maintenance_app

# 2. Create and activate virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1        # Windows
# source venv/bin/activate          # Linux/macOS

# 3. Install dependencies
pip install -r backend/requirements.txt

# 4. Configure environment
cp .env.example .env
# Edit .env and set SECRET_KEY and DEFAULT_ADMIN_PASSWORD

# 5. Start the server
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# 6. Open in browser
# http://localhost:8000
# Login with your DEFAULT_ADMIN_USER / DEFAULT_ADMIN_PASSWORD
# CHANGE THE PASSWORD IMMEDIATELY
```
