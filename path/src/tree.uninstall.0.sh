#!/usr/bin/env bash
get_i18n 'remove.removing.fount.installationDir'
set_title "𝓯"
write_taskbar_progress 75
set_title ""
write_taskbar_progress 90
rm -rf "$FOUNT_DIR"
parent_dir=$(dirname "$FOUNT_DIR")
while rmdir "$parent_dir" 2>/dev/null; do
	parent_dir=$(dirname "$parent_dir")
done
get_i18n 'remove.fountInstallationDirRemoved'

