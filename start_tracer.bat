@echo off
rem Double-click to start the Stuoragurra scarp tracer in your browser.
rem It runs a small local web server on port 8765 (needed to read the elevation tiles).
rem Keep this window open while you work; close it to stop. Requires Python 3 (python.org).
cd /d "%~dp0"
start "" "http://localhost:8765/"
echo Stuoragurra scarp tracer: http://localhost:8765/
echo Keep this window open while you work. Close it to stop the server.
python -m http.server 8765 --bind 127.0.0.1
if errorlevel 1 py -m http.server 8765 --bind 127.0.0.1
