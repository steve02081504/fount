#!/usr/bin/env bash
get_i18n 'remove.removing.protocolHandler'
if [ "$OS_TYPE" = "Linux" ]; then
	fount_require unix/protocol.uninstall
	uninstall_fount_protocol_linux
fi
