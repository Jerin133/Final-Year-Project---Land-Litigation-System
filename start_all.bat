@echo off
title UniGaia — Multi-Module Launcher
echo ===================================================
echo   UniGaia: Land Litigation Intelligence Platform
echo   Starting all services...
echo ===================================================

echo [1/4] Launching Case Integration (Port 8000)...
start "UniGaia - Case API (8000)" cmd /k "cd /d "%~dp0module - case integration" && uvicorn app.main:app --host 0.0.0.0 --port 8000"

timeout /t 2 /nobreak >nul

echo [2/4] Launching Land Records Bridge (Port 8001)...
start "UniGaia - Land Bridge (8001)" cmd /k "cd /d "%~dp0land-litigation-dashboard\bridge" && python module1_bridge.py"

timeout /t 2 /nobreak >nul

echo [3/4] Launching GIS Integration (Port 8002)...
start "UniGaia - GIS Module (8002)" cmd /k "cd /d "%~dp0GIS Integration" && python run.py --no-browser --host 0.0.0.0 --port 8002"

timeout /t 2 /nobreak >nul

echo [4/4] Launching Frontend Web Dashboard...
start "UniGaia - Frontend (5173)" cmd /k "cd /d "%~dp0land-litigation-dashboard\frontend" && npm run dev"

echo.
echo ===================================================
echo   All 4 services launched!
echo   Frontend: http://localhost:5173
echo   Case API: http://localhost:8000/docs
echo   Land API: http://localhost:8001/villages
echo   GIS API:  http://localhost:8002/gis/villages
echo ===================================================
pause
