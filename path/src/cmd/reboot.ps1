function script:Invoke-FountCmdReboot {
	param([string[]]$CommandArgs)
	Invoke-FountBootstrapFull -CommandArgs $CommandArgs
	. $FountRequire cmd/shutdown
	Invoke-FountCmdShutdown -CommandArgs $CommandArgs
}
