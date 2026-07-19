============================================================
 Maintenance Management System — Installer Build Guide
============================================================

OVERVIEW
--------
This guide explains how to build the setup.exe installer for
the Maintenance Management System. Follow every step in order.
Only needs to be done once per release.


PREREQUISITES (on your development machine)
-------------------------------------------
1. Python 3.11 installed (https://www.python.org/downloads/)
2. Inno Setup 6 installed (https://jrsoftware.org/isdl.php)
   - Download "Inno Setup 6.x.x setup" and install with defaults
3. Internet access (for downloading Python installer and wheels)


STEP 1 — Download the Python 3.11 Installer
--------------------------------------------
Download the 64-bit Python 3.11 installer from:
https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe

Save it to:
   installer\python-3.11.9-amd64.exe

(This file is NOT committed to version control — it is too large.
 Download it fresh for each release build.)


STEP 2 — Download All Dependency Wheels (Offline Bundle)
---------------------------------------------------------
Run the following script on a machine WITH internet access:

   installer\download_wheels.bat

This downloads all required Python packages as .whl files into:
   installer\wheels\

These wheel files are bundled into the installer so that the
target plant computer requires ZERO internet access during
installation.


STEP 3 — Provide an Application Icon (Optional)
------------------------------------------------
If you have an .ico file for the application:
   - Copy it to: installer\setup_icon.ico
   - Also copy it to: frontend\favicon.ico

If no icon is provided, remove the IconFilename lines from
setup.iss before compiling (Inno Setup will use a default icon).


STEP 4 — Initialize a Blank Database
--------------------------------------
Before building the installer, ensure a clean blank database
exists at:
   backend\storage\maintenance.db

To create a fresh blank database:
1. Run the application once on your development machine
2. The database is created automatically on first startup
3. Do NOT include a database with real records in the installer

The installer copies this blank database to the target machine
only if no database already exists there (safe for updates).


STEP 5 — Compile the Installer
-------------------------------
1. Open Inno Setup Compiler (installed in Step 0)
2. File → Open → select: installer\setup.iss
3. Review the [Setup] section — update AppVersion if needed
4. Build → Compile (or press Ctrl+F9)
5. Wait for compilation to complete (usually under 60 seconds)
6. The output file appears at:
      installer\Output\MMS_Setup_v1.0.exe


STEP 6 — Test the Installer
-----------------------------
Before copying to USB:
1. Copy MMS_Setup_v1.0.exe to a test machine (or a VM)
2. Run the installer as Administrator
3. Verify:
   - Python installs silently
   - Virtual environment is created
   - Dependencies install without internet
   - Desktop shortcut appears
   - Clicking the shortcut opens the browser
   - The application loads correctly
   - Login page appears


STEP 7 — Copy to USB
---------------------
Copy only MMS_Setup_v1.0.exe to the USB drive.
The installer is self-contained — no other files are needed.

Recommended USB structure:
   USB Drive\
   ├── MMS_Setup_v1.0.exe
   └── README.txt   (brief instructions for the plant engineer)


WHAT THE INSTALLER DOES (in order)
------------------------------------
1. Shows a welcome screen with application name and description
2. Asks for installation directory (default: C:\ykg_maintenance)
3. Installs Python 3.11 silently (no user interaction required)
4. Creates a Python virtual environment at {install}\venv\
5. Installs all dependencies from bundled wheels (no internet)
6. Copies application files (backend, frontend, launcher)
7. Copies a blank database (only if none exists — safe for updates)
8. Creates a desktop shortcut
9. Offers to launch the application immediately


WHAT THE UNINSTALLER DOES
--------------------------
- Removes all installed application files
- Removes the virtual environment
- Removes the desktop shortcut
- Does NOT delete the database or attachments (data is preserved)
- The installer log and {app}\backend\storage\ folder remain


UPDATING AN EXISTING INSTALLATION
-----------------------------------
To update the application on a machine that already has it:
1. Build a new setup.exe with the updated application files
2. Run the new setup.exe — it installs over the existing installation
3. The existing database and attachments are preserved
   (the [Files] entry for maintenance.db uses "onlyifdoesntexist")
4. Users do not lose any data


PORT CONFIGURATION
-------------------
The application runs on port 8000 by default.
If port 8000 is in use on the target machine, edit:
   {install}\launcher\launcher.pyw
Change PORT = 8000 to an available port number.
No other changes are needed.


TROUBLESHOOTING
---------------
Problem: "Python installation failed"
Solution: Ensure the setup.exe is run as Administrator.
          Check Windows Event Viewer for details.

Problem: "The application server could not be started"
Solution: Check if port 8000 is already in use.
          Run: netstat -ano | findstr :8000
          Kill the process using that port, then try again.

Problem: "pip install failed during setup"
Solution: Ensure download_wheels.bat was run successfully
          and the installer\wheels\ directory is not empty.

Problem: Browser opens but shows "connection refused"
Solution: The server is still starting. Wait 10 seconds
          and refresh the browser. If it persists, check
          Windows Firewall is not blocking port 8000.
