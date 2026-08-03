function script:Invoke-FountCmdClean {
	param([string[]]$CommandArgs)
	. $FountRequireMany i18n run win/keep_awake win/file_attrs terminal deno
	Invoke-FountBootstrapFull -CommandArgs @('clean')
	if (Test-Path -Path "$FOUNT_DIR/node_modules") {
		run shutdown
		if ($CommandArgs[1] -eq 'force') {
			Write-Host (Get-I18n -key 'clean.removingCaches')
			Get-ChildItem -Path "$FOUNT_DIR" -Filter "*_cache.json" -Recurse | Remove-Item -Force -ErrorAction Ignore
		}
	}
	Restore-FountTestKeepAwakeArchive
	Remove-Item -Path "$FOUNT_DIR/data/test" -Recurse -Force -ErrorAction Ignore
	Write-Host (Get-I18n -key 'clean.cleaningDenoCaches')
	deno clean -e "$FOUNT_DIR/src/server/index.mjs"
	Write-Host (Get-I18n -key 'clean.cleaningOldPwshModules')
	foreach ($module in Get-InstalledModule -Name @('ps12exe', 'fount-pwsh') -ErrorAction Ignore) {
		Get-InstalledModule -Name $module.Name -AllVersions | Where-Object { $_.Version -ne $module.Version } | Uninstall-Module
	}
	if (-not (Test-Path "$FOUNT_DIR/node_modules/desktop.ini")) {
		Copy-Item "$FOUNT_DIR/default/node_modules_desktop.ini" "$FOUNT_DIR/node_modules/desktop.ini" -Force
	}
	Set-FountFileAttributes
	Write-TaskbarProgressClear
}
