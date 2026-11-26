@echo off
cd /d "%~dp0"
if not exist "node_modules\next\package.json" (
 call npm.cmd ci
 if errorlevel 1 goto :failed
)
call npm.cmd run local
if errorlevel 1 goto :failed
exit /b 0
:failed
echo The desk stopped with an error. See the messages above.
pause
