#!/usr/bin/env bash
# ===================================================
# UniGaia: Land Litigation Intelligence Platform
# Linux / macOS / VPS Multi-Service Launcher
# ===================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting Case API on port 8000..."
cd "$ROOT_DIR/module - case integration" && uvicorn app.main:app --host 0.0.0.0 --port 8000 &
PID_CASE=$!

echo "Starting Land Records Bridge on port 8001..."
cd "$ROOT_DIR/land-litigation-dashboard/bridge" && python3 module1_bridge.py &
PID_BRIDGE=$!

echo "Starting GIS Integration on port 8002..."
cd "$ROOT_DIR/GIS Integration" && python3 run.py --no-browser --host 0.0.0.0 --port 8002 &
PID_GIS=$!

echo "Starting Frontend on port 5173..."
cd "$ROOT_DIR/land-litigation-dashboard/frontend" && npm run dev &
PID_FRONT=$!

echo "All services running in background."
echo "PIDs: Case API ($PID_CASE), Land Bridge ($PID_BRIDGE), GIS ($PID_GIS), Frontend ($PID_FRONT)"

trap "kill $PID_CASE $PID_BRIDGE $PID_GIS $PID_FRONT; exit" SIGINT SIGTERM
wait
