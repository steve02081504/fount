: '"
@echo off
goto Batch
"'
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SH_EXEC=$(command -v sh)
"$SH_EXEC" "$SCRIPT_DIR/run.sh" "$@"
exit 0

:Batch
if "%1"=="" (
	cmd /c "%~dp0/path/fount.bat" open keepalive
) else (
	cmd /c "%~dp0/path/fount.bat" %*
)
if %ERRORLEVEL% NEQ 0 if %ERRORLEVEL% NEQ 255 pause
exit /b %ERRORLEVEL%
@echo on
