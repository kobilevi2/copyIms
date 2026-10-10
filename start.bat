@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies for the first time, this may take a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. See the errors above.
    pause
    exit /b 1
  )
)

start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:4000"

echo Starting copyIms on http://localhost:4000
echo Press Ctrl+C to stop the server.
echo.
node server.js

echo.
echo Server stopped.
pause
