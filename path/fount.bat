: '"
@echo off
goto Batch
"
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
exec "$(command -v sh || echo /bin/sh)" "$SCRIPT_DIR/fount" "$@"
exit $?

:Batch
setlocal enabledelayedexpansion

where powershell.exe >nul 2>&1
if not errorlevel 1 goto :PsFromPath
if exist "%windir%\System32\WindowsPowerShell\v1.0\powershell.exe" goto :PsSys32
if exist "%windir%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" goto :PsSysWow
for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\PowerShell\3\PowerShellEngine" /v ApplicationBase ^| findstr /i "ApplicationBase"') do set PowerShellPath64=%%b
if defined PowerShellPath64 set "PowerShellExe64=%PowerShellPath64%\powershell.exe"
if defined PowerShellExe64 if exist "%PowerShellExe64%" goto :PsReg64
for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Wow6432Node\Microsoft\PowerShell\3\PowerShellEngine" /v ApplicationBase ^| findstr /i "ApplicationBase"') do set PowerShellPath32=%%b
if defined PowerShellPath32 set "PowerShellExe32=%PowerShellPath32%\powershell.exe"
if defined PowerShellExe32 if exist "%PowerShellExe32%" goto :PsReg32
for /f "delims=" %%i in ('where powershell.exe 2^>nul') do set PowerShellFullPathWhere=%%i
if defined PowerShellFullPathWhere goto :PsWhereFull
where pwsh.exe >nul 2>&1
if not errorlevel 1 goto :PsPwsh
echo Error: Neither powershell.exe nor pwsh.exe found. Please ensure PowerShell is installed and accessible.
exit /b 1

:PsFromPath
powershell.exe -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
goto :exit_batch

:PsSys32
"%windir%\System32\WindowsPowerShell\v1.0\powershell.exe" -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
goto :exit_batch

:PsSysWow
"%windir%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
goto :exit_batch

:PsReg64
"%PowerShellExe64%" -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
goto :exit_batch

:PsReg32
"%PowerShellExe32%" -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
goto :exit_batch

:PsWhereFull
"%PowerShellFullPathWhere%" -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
goto :exit_batch

:PsPwsh
set POWERSHELL_UPDATECHECK=Off
pwsh.exe -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
goto :exit_batch

:exit_batch
exit /b %ERRORLEVEL%
@echo on
