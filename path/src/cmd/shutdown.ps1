function script:cmd_shutdown {
	require terminal run
	bootstrap_full @args
	try {
		run @args
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
