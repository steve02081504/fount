function Invoke-FountCmdShutdown {
	param([string[]]$CommandArgs)
	try {
		run @CommandArgs
	}
	finally {
		Write-TaskbarProgressClear
	}
	exit $LastExitCode
}
