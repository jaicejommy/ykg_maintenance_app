# Maintenance Management System (MMS)

A robust, intranet-based CRUD (Create, Read, Update, Delete) web application designed for capturing, tracking, and managing manual maintenance records and equipment data within a plant environment. Built with a modern **FastAPI (Python)** backend and a pure HTML5/CSS3/JavaScript frontend, requiring absolutely zero build steps.

---

## 🚀 Key Features

- **Hierarchical Equipment Master:** Manage plant equipment using a tree structure (Enterprise > Site > Area > Work Center > Work Unit > Equipment ID). Supports bulk uploads via CSV.
- **Maintenance Records:** Digitize inspection logs, record operating conditions, consumables, and remarks.
- **File & CSV Attachments:** Attach physical files (PDF, Images, Excel) and parse structured tabular data directly from CSV files to render interactive data grids in the browser.
- **PDF Export:** Auto-generate beautifully formatted PDF reports for any maintenance record.
- **Role-Based Access Control (RBAC):** Secure endpoints tailored for Administrators, Engineers/Operators, and Viewers.
- **Offline Capable Installer:** Fully independent installer scripts to deploy the system in air-gapped, isolated network environments without an internet connection.

---

## 🛠️ Technology Stack

- **Backend:** Python 3.11+, FastAPI, Uvicorn (ASGI)
- **Database:** SQLite3 (Write-Ahead Logging enabled for high concurrency)
- **Security:** JWT (JSON Web Tokens), Bcrypt Password Hashing
- **Frontend:** Vanilla JS (ES6+), HTML5, custom CSS3, Bootstrap 5
- **Exporting:** ReportLab for Python (PDF Generation)

---

## 📦 Prerequisites

- **OS:** Windows, Linux, or macOS (Host server)
- **Runtime:** Python 3.11 or later
- **Package Manager:** `pip` (bundled with Python)

---

## ⚙️ Installation & Setup

1. **Clone or copy the project** to the host machine.
2. **Create a virtual environment:**
   ```bash
   python -m venv venv
   # Windows: .\venv\Scripts\Activate.ps1
   # Linux/macOS: source venv/bin/activate
   ```
3. **Install dependencies:**
   ```bash
   pip install -r backend/requirements.txt
   ```
4. **Configuration:**
   Copy the example environment file and update it as needed.
   ```bash
   cp .env.example .env
   ```
   *(Ensure you configure your environment variables securely.)*

---

## 🚦 Running the Server

Start the application using Uvicorn:

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

- **Access the App:** Open a web browser on the local network and navigate to `http://<host-ip>:8000`
- **Interactive API Docs:** Available out-of-the-box at `http://<host-ip>:8000/api/docs`


## 💾 Data Storage & Backups

The SQLite database (`maintenance.db`) is generated automatically upon initial startup within the `backend/storage/` directory.

To properly **backup** the system to prevent data loss, ensure you back up the following paths regularly:
1. `backend/storage/maintenance.db` (The core relational database)
2. `backend/storage/attachments/` (The physical folder containing user file uploads)

---

## 👥 User Roles

- **Administrator:** Full system access. Create, edit, and soft-delete all records, manage the equipment hierarchy, and manage user accounts/passwords.
- **Engineer / Operator:** Standard users capable of creating maintenance records and editing *only their own* records.
- **Viewer:** Read-only access. Capable of viewing records, reports, and dashboards.
