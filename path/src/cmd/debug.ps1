function script:cmd_debug {
	bootstrap_full @args
	try {
		$rest = @($args | Select-Object -Skip 1)
		& (Join-Path $FOUNT_DIR 'path/fount.ps1') keepalive debug @rest
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
