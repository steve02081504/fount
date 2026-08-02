function Invoke-FountCmdDebug {
	param([string[]]$CommandArgs)
	$runargs = $CommandArgs[1..$CommandArgs.Count]
	try {
		& (Join-Path $FOUNT_DIR 'path/fount.ps1') keepalive debug @runargs
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
