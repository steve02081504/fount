function script:cmd_server {
	require debug win/app_restart terminal run
	bootstrap_server @args
	$commandArguments = @($args | Select-Object -Skip 1)
	try {
		Register-FountApplicationRestart
		if ($commandArguments.Count -gt 0 -and $commandArguments[0] -eq 'debug') {
			$commandArguments = @($commandArguments | Select-Object -Skip 1)
			debug_on
		}
		run_server_with_updates @commandArguments
	}
	finally {
		Unregister-FountApplicationRestart
		Write-TaskbarProgressClear
	}
}
