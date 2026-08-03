function script:cmd_shutdown {
	bootstrap_full @args
	try {
		run @args
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
