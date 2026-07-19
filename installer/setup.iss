; ── installer/setup.iss ──────────────────────────────────────────────────────
; Inno Setup 6 installer script for the Maintenance Data Entry & Management System
; Compile with: Inno Setup Compiler (https://jrsoftware.org/isinfo.php)
;
; BEFORE COMPILING:
; 1. Place the Python 3.11 installer at: installer\python-3.11.9-amd64.exe
;    Download from: https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
; 2. Pre-download all wheels: run installer\download_wheels.bat on a machine with internet
; 3. Open this file in Inno Setup Compiler and click Build > Compile
; 4. The output setup.exe appears in installer\Output\

[Setup]
AppName=Maintenance Management System
AppVersion=1.0
AppPublisher=Jaice Jommy
AppPublisherURL=https://github.com/jaicejommy
DefaultDirName=C:\ykg_maintenance
DefaultGroupName=Maintenance Management System
OutputDir=Output
OutputBaseFilename=MMS_Setup_v1.0
SetupIconFile=setup_icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0
DisableProgramGroupPage=yes
LicenseFile=
InfoBeforeFile=
InfoAfterFile=

; ── Installer appearance ──────────────────────────────────────────────────────
[Messages]
WelcomeLabel1=Welcome to the Maintenance Management System Installer
WelcomeLabel2=This will install the Maintenance Management System on your computer.%n%nThe application provides maintenance data entry and management for plant operations.%n%nClick Next to continue.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; ── Directory Permissions ──────────────────────────────────────────────────────
[Dirs]
Name: "{app}\backend\storage"; Permissions: users-modify

; ── Files to install ─────────────────────────────────────────────────────────
[Files]
; Application source files — copied from project root
; Adjust source paths to match your project structure
Source: "..\backend\*";           DestDir: "{app}\backend";    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\frontend\*";          DestDir: "{app}\frontend";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\launcher\launcher.pyw"; DestDir: "{app}";          Flags: ignoreversion
Source: "..\.env";                  DestDir: "{app}";          Flags: ignoreversion

; Pre-downloaded wheel files for offline pip install
Source: "wheels\*";               DestDir: "{app}\wheels";     Flags: ignoreversion recursesubdirs createallsubdirs

; Bundled Python installer — extracted and used silently during install
Source: "python-3.11.9-amd64.exe"; DestDir: "{tmp}";          Flags: deleteafterinstall

; Blank pre-initialized database — only installed if no database exists yet
Source: "..\backend\storage\maintenance.db"; DestDir: "{app}\backend\storage"; Flags: ignoreversion uninsneveruninstall onlyifdoesntexist
Source: "..\backend\storage\attachments\.gitkeep"; DestDir: "{app}\backend\storage\attachments"; Flags: ignoreversion

; ── Installer execution steps ─────────────────────────────────────────────────
[Run]
; Step 1: Install Python 3.11 silently
; /quiet = no UI, /norestart = no reboot prompt
; PrependPath=1 adds Python to system PATH
Filename: "{tmp}\python-3.11.9-amd64.exe"; \
  Parameters: "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0 Include_doc=0"; \
  StatusMsg: "Installing Python 3.11..."; \
  Flags: waituntilterminated

; Step 2: Create virtual environment in the install directory
Filename: "{cmd}"; \
  Parameters: "/c py -3.11 -m venv ""{app}\venv"""; \
  StatusMsg: "Creating virtual environment..."; \
  Flags: runhidden

; Step 3: Upgrade pip inside the venv (offline — from bundled wheel)
Filename: "{app}\venv\Scripts\pip.exe"; \
  Parameters: "install --upgrade pip --no-index --find-links ""{app}\wheels"""; \
  StatusMsg: "Upgrading pip..."; \
  Flags: runhidden

; Step 4: Install all application dependencies from bundled wheels
Filename: "{app}\venv\Scripts\pip.exe"; \
  Parameters: "install --no-index --find-links ""{app}\wheels"" -r ""{app}\backend\requirements.txt"""; \
  StatusMsg: "Installing application dependencies (this may take a minute)..."; \
  Flags: runhidden

; Step 5: Launch the application after install completes (optional — user can skip)
Filename: "{app}\venv\Scripts\pythonw.exe"; \
  Parameters: "launcher.pyw"; \
  WorkingDir: "{app}"; \
  Description: "Launch the Maintenance Management System now"; \
  Flags: postinstall skipifsilent nowait

; ── Shortcuts ────────────────────────────────────────────────────────────────
[Icons]
; Desktop shortcut
Name: "{autodesktop}\Maintenance Management System"; \
  Filename: "{app}\venv\Scripts\pythonw.exe"; \
  Parameters: "launcher.pyw"; \
  WorkingDir: "{app}"; \
  IconFilename: "{app}\frontend\favicon.ico"; \
  Comment: "Launch the Maintenance Management System"

; Start Menu shortcut
Name: "{group}\Maintenance Management System"; \
  Filename: "{app}\venv\Scripts\pythonw.exe"; \
  Parameters: "launcher.pyw"; \
  WorkingDir: "{app}"; \
  IconFilename: "{app}\frontend\favicon.ico"; \
  Comment: "Launch the Maintenance Management System"

; Start Menu uninstaller shortcut
Name: "{group}\Uninstall Maintenance Management System"; \
  Filename: "{uninstallexe}"

; ── Uninstaller behavior ──────────────────────────────────────────────────────
[UninstallRun]
; Kill any running Uvicorn / launcher processes before uninstalling
Filename: "{cmd}"; Parameters: "/c taskkill /F /IM pythonw.exe /T"; Flags: runhidden; RunOnceId: "KillLauncher"
Filename: "{cmd}"; Parameters: "/c taskkill /F /IM uvicorn.exe /T"; Flags: runhidden; RunOnceId: "KillUvicorn"

[UninstallDelete]
; Remove the venv and wheels directory (not covered by standard uninstall)
Type: filesandordirs; Name: "{app}\venv"
Type: filesandordirs; Name: "{app}\wheels"

; NOTE: The database and attachments are intentionally NOT deleted on uninstall.
; They remain at {app}\backend\storage\ for data preservation.
; An administrator can manually delete the entire {app} folder if a clean removal is needed.
