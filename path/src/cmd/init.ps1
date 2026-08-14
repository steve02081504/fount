function script:cmd_init {
	if ($args[1] -eq 'force') {
		require fs init_force
		exit (fount_handle_init_force $FOUNT_DIR)
	}
	bootstrap_full init
	$exitCode = $LastExitCode
	Write-TaskbarProgressClear
	exit $exitCode
}
