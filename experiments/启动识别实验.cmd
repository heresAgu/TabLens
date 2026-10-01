@echo off
cd /d "%~dp0"
where pythonw >nul 2>nul
if errorlevel 1 (
    echo Python was not found. Open this file from an environment with Python installed.
    pause
    exit /b 1
)
start "" pythonw "%~dp0recognition_lab.py"
