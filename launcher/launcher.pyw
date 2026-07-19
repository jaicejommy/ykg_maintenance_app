# launcher/launcher.pyw
# Run with pythonw.exe — no console window appears.
# This file is placed in the installation directory by the installer.
# The desktop shortcut points to:
#     pythonw.exe launcher.pyw
# from the installation directory.

import subprocess
import sys
import time
import webbrowser
import urllib.request
import urllib.error
import os
import signal
import atexit
from pathlib import Path

# ── Configuration ────────────────────────────────────────────────────────────
HOST          = "0.0.0.0"
PORT          = 8000
OPEN_URL      = f"http://localhost:{PORT}/index.html"
HEALTH_URL    = f"http://localhost:{PORT}/index.html"
MAX_WAIT_SEC  = 30       # seconds to wait for server to become ready
POLL_INTERVAL = 0.5      # seconds between health check attempts

# ── Paths ────────────────────────────────────────────────────────────────────
# The launcher lives in the installation root alongside backend/ and frontend/
INSTALL_DIR   = Path(__file__).parent.resolve()
VENV_PYTHON   = INSTALL_DIR / "venv" / "Scripts" / "python.exe"
UVICORN       = INSTALL_DIR / "venv" / "Scripts" / "uvicorn.exe"

# ── Start the server ─────────────────────────────────────────────────────────
def start_server():
    """Start Uvicorn as a detached background process."""
    cmd = [
        str(UVICORN),
        "backend.main:app",
        "--host", HOST,
        "--port", str(PORT),
        "--no-access-log",           # suppress access log output
    ]
    process = subprocess.Popen(
        cmd,
        cwd=str(INSTALL_DIR),        # working directory is the install root
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,  # no console window on Windows
    )
    return process

# ── Wait for server to be ready ───────────────────────────────────────────────
def wait_for_server(timeout: int) -> bool:
    """Poll the health URL until the server responds or timeout is reached."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(POLL_INTERVAL)
    return False

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    server_process = start_server()

    # Register cleanup — kill the server when the launcher process exits
    def cleanup():
        try:
            server_process.terminate()
        except Exception:
            pass

    atexit.register(cleanup)

    # Wait for server to be ready
    ready = wait_for_server(MAX_WAIT_SEC)

    if not ready:
        # Server did not start in time — show a basic error using Windows msgbox
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            f"The application server could not be started within {MAX_WAIT_SEC} seconds.\n\n"
            f"Please check that port {PORT} is not in use by another application\n"
            f"and try launching again.\n\n"
            f"If the problem persists, contact your system administrator.",
            "Maintenance Management System — Startup Error",
            0x10  # MB_ICONERROR
        )
        server_process.terminate()
        sys.exit(1)

    # Open the browser
    webbrowser.open(OPEN_URL)

    # Keep the launcher process alive so atexit cleanup runs on exit
    # The launcher stays running in the background (no window) while the
    # server is active. The server stops when the launcher is closed.
    try:
        server_process.wait()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
