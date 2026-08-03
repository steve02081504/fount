function script:Invoke-FountCmdReboot {
	Invoke-FountBootstrapFull @args
	try {
		run @args
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
