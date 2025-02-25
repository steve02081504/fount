@echo off
setlocal enabledelayedexpansion
powershell.exe -noprofile -executionpolicy bypass -file "%~dp0fount.ps1" %*
exit /b %ERRORLEVEL%
@echo on
