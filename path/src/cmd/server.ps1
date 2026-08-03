function script:Invoke-FountCmdServer {
	param([string[]]$CommandArgs)
	. $FountRequireMany debug win/app_restart terminal run
	Invoke-FountBootstrapServer -CommandArgs $CommandArgs
	$runargs = @($CommandArgs | Select-Object -Skip 1)
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
