function script:Invoke-FountCmdShutdown {
	Invoke-FountBootstrapFull @args
	try {
		run @args
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
