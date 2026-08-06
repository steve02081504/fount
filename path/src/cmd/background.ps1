function script:cmd_background {
	require passthrough win/wt
	$env:FOUNT_BACKGROUND = 1
	handle_docker_passthrough @args
	$cmdArgs = @($args | Select-Object -Skip 1)
	$ErrorNumber = $Error.Count
	if (Test-Path -Path "$FOUNT_DIR/.nobackground") {
		$windowsTerminalCommand = Get-WTfountCmd @cmdArgs
		Start-Process -FilePath $windowsTerminalCommand.FilePath -ArgumentList $windowsTerminalCommand.ArgumentList
	}
	else {
		$pwshExe = (Get-Process -Id $PID).Path
		Start-Process -FilePath $pwshExe -ArgumentList (Get-FountPs1ArgumentList @cmdArgs) -WindowStyle Hidden
	}
	if ($Error.Count -gt $ErrorNumber) {
		exit 1
	}
	exit 0
}
