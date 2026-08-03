function script:Invoke-FountCmdDebug {
	Invoke-FountBootstrapFull @args
	$runargs = $args[1..$args.Count]
	try {
		& (Join-Path $FOUNT_DIR 'path/fount.ps1') keepalive debug @runargs
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
