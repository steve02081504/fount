function script:Invoke-FountCmdDebug {
	param([string[]]$CommandArgs)
	Invoke-FountBootstrapFull -CommandArgs $CommandArgs
	$runargs = $CommandArgs[1..$CommandArgs.Count]
	try {
		& (Join-Path $FOUNT_DIR 'path/fount.ps1') keepalive debug @runargs
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
