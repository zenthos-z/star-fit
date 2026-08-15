@echo off
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :43111') do (
    taskkill /F /PID %%a 2>nul
)
echo Done
