function script:Invoke-FountCmdInit {
	if ($args[1] -eq 'force') {
		RequireMany fs init_force
		exit (Invoke-FountInitForce $FOUNT_DIR)
	}
	Invoke-FountBootstrapFull init
	Write-TaskbarProgressClear
	exit 0
}
