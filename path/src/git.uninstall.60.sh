#!/usr/bin/env bash
get_i18n 'remove.removing.fount.fromGitSafeDir'
if command -v git &>/dev/null && git config --global --get-all safe.directory | grep -q -xF "$FOUNT_DIR"; then
	git config --global --unset safe.directory "$FOUNT_DIR"
fi

set_title "𝓯𝓸𝓾"
write_taskbar_progress 45
