@echo off
cd /d "%~dp0"
title Stop ShaLom WPH Recorder

if not exist "WPH-records\.recorder.lock" (
  echo WPH recorder is not running.
  pause
  exit /b 0
)

type nul > "WPH-records\.stop-request"
echo Stop requested. The recorder will close within 10 seconds.
timeout /t 11 /nobreak >nul

if exist "WPH-records\.recorder.lock" (
  echo The recorder is still closing. Please try again shortly.
) else (
  echo WPH recorder stopped.
)
pause
