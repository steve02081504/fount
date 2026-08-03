#!/usr/bin/env bash
cmd_remove() {
	require_mid
	trap_terminal_teardown
	source_uninstall_hooks
	get_i18n 'remove.fountUninstallationComplete'
	exit 0
}
