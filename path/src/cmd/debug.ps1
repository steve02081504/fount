function script:cmd_debug {
	bootstrap_full @args
	$args = @($args | Select-Object -Skip 1)
	try {
		& (Join-Path $FOUNT_DIR 'path/fount.ps1') keepalive debug @args
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
