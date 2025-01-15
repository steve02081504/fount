@echo off
call "%~dp0/path/fount.bat" %*
if %ERRORLEVEL% NEQ 0 && %ERRORLEVEL% NEQ 255 pause
exit %ERRORLEVEL%
@echo on
