function Invoke-FountCmdInit {
	param([string[]]$CommandArgs)
	if ($CommandArgs[1] -eq 'force') {
		. $FountRequireMany fs init_force
		exit (Invoke-FountInitForce -FountDir $FOUNT_DIR)
	}
	Invoke-FountBootstrapFull -CommandArgs @('init')
	Write-TaskbarProgressClear
	exit 0
}
