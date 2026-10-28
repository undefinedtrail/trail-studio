@echo off
title Trail Studio Server
cd /d "%~dp0"
echo ===================================================
echo   Trail Studio - Running on http://localhost:3000
echo ===================================================
echo.
echo Login Credentials:
echo   Customer:      user@gmail.com   / user123
echo   Administrator: admin@gmail.com  / admin123
echo.
echo Starting server...
node server.js
pause
