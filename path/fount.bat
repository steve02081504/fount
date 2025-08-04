@echo off
setlocal enabledelayedexpansion
set POWERSHELL_UPDATECHECK=Off

where pwsh.exe >nul 2>&1
if not errorlevel 1 (
	pwsh.exe -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
	goto :exit_batch
)

where powershell.exe >nul 2>&1
if not errorlevel 1 (
	powershell.exe -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
	goto :exit_batch
)

if exist "%windir%\System32\WindowsPowerShell\v1.0\powershell.exe" (
	"%windir%\System32\WindowsPowerShell\v1.0\powershell.exe" -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
	goto :exit_batch
)

if exist "%windir%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" (
	"%windir%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
	goto :exit_batch
)

for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\PowerShell\3\PowerShellEngine" /v ApplicationBase ^| findstr /i "ApplicationBase"') do set PowerShellPath64=%%b
if defined PowerShellPath64 set PowerShellExe64="%PowerShellPath64%\powershell.exe"
if exist "%PowerShellExe64%" (
	"%PowerShellExe64%" -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
	goto :exit_batch
)

for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Wow6432Node\Microsoft\PowerShell\3\PowerShellEngine" /v ApplicationBase ^| findstr /i "ApplicationBase"') do set PowerShellPath32=%%b
if defined PowerShellPath32 set PowerShellExe32="%PowerShellPath32%\powershell.exe"
if exist "%PowerShellExe32%" (
	"%PowerShellExe32%" -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
	goto :exit_batch
)

for /f "delims=" %%i in ('where powershell.exe 2^>nul') do set PowerShellFullPathWhere=%%i
if defined PowerShellFullPathWhere (
	"%PowerShellFullPathWhere%" -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
	goto :exit_batch
)

echo Error: Neither pwsh.exe nor powershell.exe found. Please ensure PowerShell is installed and accessible.
exit /b 1

:exit_batch
exit /b %ERRORLEVEL%
@echo on
