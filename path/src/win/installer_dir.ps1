function script:New-InstallerDir {
	New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
}
