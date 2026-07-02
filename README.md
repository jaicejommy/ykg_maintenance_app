# Maintenance Management System

A plant intranet CRUD application for capturing and managing manual maintenance records.
Built with **FastAPI** (Python) backend and a plain HTML5/CSS3/JavaScript frontend — zero build steps.

## Prerequisites

- Python 3.11 or later
- pip (bundled with Python)

## Installation & Setup

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
   *Note: Ensure you configure your environment variables securely.*

## Running the Server

Start the application:
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```
- Access the app on your LAN at `http://<host-ip>:8000`
- Interactive API Docs are available at `http://<host-ip>:8000/api/docs`

## Data Storage & Backups

The SQLite database (`backend/storage/maintenance.db`) is created automatically on startup. 
To backup your data, regularly copy:
1. `backend/storage/maintenance.db`
2. `backend/storage/attachments/` directory

## User Roles

- **Administrator:** Create, Edit All, Delete Records, Manage Users
- **Engineer / Operator:** Create, Edit Own Records
- **Viewer:** View only
