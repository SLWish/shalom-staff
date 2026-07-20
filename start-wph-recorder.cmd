@echo off
cd /d "%~dp0"
title ShaLom WPH Recorder

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required.
  pause
  exit /b 1
)

node tools\wph-recorder.mjs
pause
