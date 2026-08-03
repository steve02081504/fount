function script:cmd_server {
	require debug win/app_restart terminal run
	bootstrap_server @args
	$args = @($args | Select-Object -Skip 1)
	try {
		Register-FountApplicationRestart
		if ($args.Count -gt 0 -and $args[0] -eq 'debug') {
			$args = @($args | Select-Object -Skip 1)
			debug_on
		}
		run_server_with_updates @args
	}
	finally {
		Unregister-FountApplicationRestart
		Write-TaskbarProgressClear
	}
}
