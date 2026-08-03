function script:cmd_remove {
	require_mid
	trap_terminal_teardown
	$completeMessage = Get-I18n -key 'remove.fountUninstallationComplete'
	source_uninstall_hooks
	Write-Host $completeMessage
	terminal_teardown
	exit 0
}
