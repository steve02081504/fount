#!/usr/bin/env bash
get_i18n 'remove.removing.protocolHandler'
if [ "$OS_TYPE" = "Linux" ]; then
	require unix/protocol.uninstall
	uninstall_fount_protocol_linux
fi
