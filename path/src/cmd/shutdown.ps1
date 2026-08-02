function Invoke-FountCmdShutdown {
	param([string[]]$CommandArgs)
	Invoke-FountBootstrapFull -CommandArgs $CommandArgs
	try {
		run @CommandArgs
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
