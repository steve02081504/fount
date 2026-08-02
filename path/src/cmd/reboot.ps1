function Invoke-FountCmdReboot {
	param([string[]]$CommandArgs)
	. $FountRequire cmd/shutdown
	Invoke-FountCmdShutdown -CommandArgs $CommandArgs
}
