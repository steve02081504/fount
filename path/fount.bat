@echo off
setlocal enabledelayedexpansion
set fount_dir=%~dp0/..
if not exist node_modules (
	npm install --prefix %fount_dir% --no-optional
)
npm run --prefix %fount_dir% start %*
@echo on
