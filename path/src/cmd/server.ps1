function Invoke-FountCmdServer {
	param([string[]]$CommandArgs)
	$runargs = $CommandArgs[1..$CommandArgs.Count]
	try {
		Register-FountApplicationRestart
		if ($runargs.Count -gt 0 -and $runargs[0] -eq 'debug') {
			$runargs = $runargs[1..$runargs.Count]
			debug_on
		}
		Invoke-FountRunServerWithUpdates @runargs
	}
	finally {
		Unregister-FountApplicationRestart
		Write-TaskbarProgressClear
	}
}
