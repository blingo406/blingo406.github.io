@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\blog-manager\start.ps1"
if errorlevel 1 pause
