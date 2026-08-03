function script:cmd_remove {
	require_mid
	require i18n terminal
	trap_terminal_teardown
	source_uninstall_hooks
	Write-Host (Get-I18n -key 'remove.fountUninstallationComplete')
	terminal_teardown
	exit 0
}
