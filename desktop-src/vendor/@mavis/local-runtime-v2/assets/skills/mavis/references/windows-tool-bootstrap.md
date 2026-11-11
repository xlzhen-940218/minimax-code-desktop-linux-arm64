# Windows Tool Bootstrap — Git Bash + Dependency Auto-Install

When `platform` is `win32`, skill scripts (`.sh` files) require **Git Bash** (bundled with Git for
Windows). Other tools (`python`, `jq`, `pdfinfo`, etc.) must also be on PATH.

This reference teaches agents how to detect missing tools and install them automatically. Run the
detection commands in PowerShell (the agent's native shell on Windows); installation uses `winget`
(preferred) or direct installers.

## Detection + Install Table

Run the detection command first. If it fails (non-zero exit or "not recognized"), execute the
install command. After install, verify by re-running detection.

| Tool | Detection (PowerShell) | Install (PowerShell) | Notes |
|------|------------------------|----------------------|-------|
| **Git + Git Bash** | `bash --version` | `winget install Git.Git --accept-source-agreements --accept-package-agreements` | Detection checks `bash` not `git` — some Git installs expose `git.exe` on PATH but not `bash.exe`. If `git` is found but `bash` is not, the Git install may need repair or the Git `bin/` dir (containing `bash.exe`) must be added to PATH manually. After install, refresh PATH: `$env:PATH = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')` |
| **Python** | `python --version` | `winget install Python.Python.3.12 --accept-source-agreements --accept-package-agreements` | Use `python` not `python3` on Windows. After install, refresh PATH. |
| **Node.js** | `node --version` | `winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements` | Required for render scripts, pptxgenjs, etc. |
| **jq** | `jq --version` | `winget install jqlang.jq --accept-source-agreements --accept-package-agreements` | Required by mavis-doctor. |
| **SQLite3** | `sqlite3 --version` | `winget install SQLite.SQLite --accept-source-agreements --accept-package-agreements` | Required by mavis-session-log. |
| **Poppler (pdfinfo/pdftotext)** | `pdfinfo -v 2>&1` | Download from https://github.com/oschwartz10612/poppler-windows/releases — extract to `C:\tools\poppler\` and add `C:\tools\poppler\Library\bin` to PATH. Or: `scoop install poppler` if scoop is available. | No winget package currently. |
| **LibreOffice (soffice)** | `soffice --version` | `winget install TheDocumentFoundation.LibreOffice --accept-source-agreements --accept-package-agreements` | Required by xlsx recalc and docx conversion. |

## How to Invoke Bash Scripts from PowerShell

On Windows, the agent's shell is PowerShell. To run `.sh` scripts, use the `bash` command (provided
by Git Bash and available on PATH after Git is installed):

```powershell
# Single script invocation
bash scripts/make.sh render --in page.html --out out.pdf --format A4

# Script with complex arguments
bash scripts/make.sh fill probe form.pdf

# Inline bash one-liner (for pipes, heredocs, etc.)
bash -c "pdfinfo out.pdf | grep 'Page size'"
bash -c "pdfimages -list out.pdf | tail -n +3 | wc -l"
```

### Key differences from direct bash

1. **Paths**: PowerShell passes Windows paths (`C:\Users\...`) to bash. Git Bash handles this
   transparently in most cases. If a script breaks on paths, use forward slashes:
   ```powershell
   bash scripts/make.sh render --in "C:/Users/me/page.html" --out "C:/Users/me/out.pdf"
   ```

2. **`/tmp/` mapping**: Git Bash maps `/tmp/` to a temp directory automatically (typically
   `C:\Users\<user>\AppData\Local\Temp` or the MSYS tmp dir). Scripts using `/tmp/` will work
   without modification.

3. **`python3` vs `python`**: Inside Git Bash, if Python is on PATH, both `python` and `python3`
   may or may not be available depending on install method. The safest approach for scripts is to
   check and alias:
   ```bash
   PY="${PYTHON:-$(command -v python3 || command -v python)}"
   ```

4. **Environment variables**: PowerShell `$env:VAR` does not propagate into bash subprocesses.
   Pass as inline vars if needed:
   ```powershell
   bash -c "WORK=$env:TEMP/pdf-work && mkdir -p `$WORK && echo `$WORK"
   ```
   Or simpler — let the bash script use its own defaults (Git Bash provides `$TMPDIR` / `/tmp/`).

## Auto-Bootstrap Flow (for agents)

When a skill requires bash scripts or Unix tools, follow this flow:

```
1. Try the command directly (e.g., `bash scripts/make.sh check`)
2. If "bash" is not recognized:
   → Install Git for Windows (see table above)
   → Refresh PATH
   → Retry
3. If the script fails because a tool is missing (e.g., "python3: command not found"):
   → Identify the missing tool from the error message
   → Install it (see table above)
   → Refresh PATH
   → Retry the script
```

The agent SHOULD attempt the command first and only install on failure — don't pre-emptively
install tools that may already be available.

## PATH Refresh (critical on Windows)

After installing any tool via `winget`, the current PowerShell session does NOT see the new PATH
entries. Always refresh:

```powershell
$env:PATH = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
```

## pip packages

Python packages (`openpyxl`, `pypdf`, `pdfplumber`, etc.) install the same way on all platforms:

```powershell
python -m pip install openpyxl pypdf pdfplumber markdown-it-py
```

Note: use `python -m pip` not `pip` directly — avoids PATH issues with multiple Python installs.
