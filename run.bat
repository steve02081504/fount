@echo off
if "%1"=="" (
	cmd /c "%~dp0/path/fount.bat" open keepalive
) else (
	cmd /c "%~dp0/path/fount.bat" %*
)
if %ERRORLEVEL% NEQ 0 if %ERRORLEVEL% NEQ 255 pause
exit /b %ERRORLEVEL%
@echo on
