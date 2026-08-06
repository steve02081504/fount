function script:cmd_server {
	require debug win/app_restart terminal run
	bootstrap_server @args
	$commandArguments = @($args | Select-Object -Skip 1)
	try {
		Register-FountApplicationRestart
		run_server @commandArguments
	}
	finally {
		Unregister-FountApplicationRestart
		Write-TaskbarProgressClear
	}
}
