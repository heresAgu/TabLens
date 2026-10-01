@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "$tabLensPython = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source; if (-not $tabLensPython) { $tabLensPython = (Get-Command python.exe -ErrorAction Stop).Source }; Start-Process -FilePath $tabLensPython -ArgumentList @('app/server.py','--open-browser') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden"
