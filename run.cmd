: '"
@echo off
goto Batch
"'
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
exec "$(command -v sh || echo /bin/sh)" "$SCRIPT_DIR/run.sh" "$@"
exit $?

:Batch
if "%1"=="" goto :BatchOpen
"%~dp0path\fount.bat" %*
goto :BatchExit

:BatchOpen
set FOUNT_CLICK=1
call "%~dp0path\fount.bat" open

:BatchExit
if "%1"=="" if %ERRORLEVEL% NEQ 0 if %ERRORLEVEL% NEQ 130 if %ERRORLEVEL% NEQ 255 pause
exit /b %ERRORLEVEL%
@echo on
