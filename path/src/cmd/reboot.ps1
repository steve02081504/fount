function script:cmd_reboot {
	bootstrap_full @args
	try {
		run @args
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
