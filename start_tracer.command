#!/bin/bash
# Double-click to start the Stuoragurra scarp tracer in your browser.
# It runs a small local web server on port 8765 (needed to read the elevation tiles).
# Keep this window open while you work; close it (or press Ctrl+C) to stop.
cd "$(dirname "$0")"
PORT=8765
if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "The tracer server is already running."
else
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER=$!
  trap "kill $SERVER 2>/dev/null" EXIT
  sleep 1
fi
open "http://localhost:$PORT/"
echo "Stuoragurra scarp tracer: http://localhost:$PORT/"
echo "Keep this window open while you work. Close it to stop the server."
wait
