function script:Invoke-FountCmdDefault {
	RequireMany terminal env run
	Invoke-FountBootstrapFull @args
	$originalTitle = Get-Title
	try {
		if ($args[0]) {
			run @args
		}
		elseif (Test-InContainer) {
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') keepalive @args
		}
		else {
			Write-TaskbarProgress -Percent 25
			Set-Title "𝓯"
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') background keepalive @args
			Set-Title "𝓯𝓸"
			Write-TaskbarProgress
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') log
		}
		exit $LastExitCode
	}
	finally {
		Set-Title $originalTitle
		Write-TaskbarProgressClear
	}
}
