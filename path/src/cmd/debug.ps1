function script:cmd_debug {
	bootstrap_full @args
	try {
		& (Join-Path $FOUNT_DIR 'path/fount.ps1') keepalive debug @($args | Select-Object -Skip 1)
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
