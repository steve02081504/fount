#!/usr/bin/env bash
fount_cmd_remove() {
	fount_require_mid
	fount_trap_terminal_teardown
	fount_source_uninstall_hooks
	get_i18n 'remove.fountUninstallationComplete'
	exit 0
}
