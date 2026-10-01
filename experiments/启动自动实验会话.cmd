@echo off
cd /d "%~dp0"
where pythonw >nul 2>nul
if not errorlevel 1 (
    start "" pythonw "%~dp0api_session.py"
    exit /b
)
where python >nul 2>nul
if not errorlevel 1 (
    start "" /b python "%~dp0api_session.py"
    exit /b
)
echo Python was not found. Please install Python and try again.
pause
