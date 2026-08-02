function Invoke-FountCmdDefault {
	param([string[]]$CommandArgs)
	$originalTitle = Get-Title
	try {
		if ($CommandArgs[0]) {
			run @CommandArgs
		} else {
			Write-TaskbarProgress -Percent 25
			Set-Title "𝓯"
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') background keepalive @CommandArgs
			Set-Title "𝓯𝓸"
			Write-TaskbarProgress
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') log
		}
	}
	finally {
		Set-Title $originalTitle
		Write-TaskbarProgressClear
	}
}
