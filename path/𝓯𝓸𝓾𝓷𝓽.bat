: '"
@echo off
goto Batch
"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SH_EXEC=$(command -v sh)
"$SH_EXEC" "$SCRIPT_DIR/fount" "$@"
exit $?

:Batch
setlocal enabledelayedexpansion
%~dp0/fount.bat %*
exit /b %ERRORLEVEL%
@echo on
