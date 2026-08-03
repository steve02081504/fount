function script:cmd_server {
	require debug win/app_restart terminal run
	bootstrap_server @args
	$cmdArgs = @($args | Select-Object -Skip 1)
	try {
		Register-FountApplicationRestart
		if ($cmdArgs.Count -gt 0 -and $cmdArgs[0] -eq 'debug') {
			$cmdArgs = @($cmdArgs | Select-Object -Skip 1)
			debug_on
		}
		run_server_with_updates @cmdArgs
	}
	finally {
		Unregister-FountApplicationRestart
		Write-TaskbarProgressClear
	}
}
