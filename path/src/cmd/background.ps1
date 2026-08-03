function script:cmd_background {
	require passthrough win/wt
	$env:FOUNT_BACKGROUND = 1
	handle_docker_passthrough @args
	$cmdArgs = @($args | Select-Object -Skip 1)
	if (Test-Path -Path "$FOUNT_DIR/.nobackground") {
		$windowsTerminalCommand = Get-WTfountCmd @cmdArgs
		Start-Process -FilePath $windowsTerminalCommand.FilePath -ArgumentList $windowsTerminalCommand.ArgumentList
	}
	else {
		$pwshExe = (Get-Process -Id $PID).Path
		$fountScript = "$FOUNT_DIR\path\fount.ps1"
		$argList = @(
			'-NoProfile',
			'-NoLogo',
			'-ExecutionPolicy', 'Bypass',
			'-File', $fountScript
		) + @($cmdArgs)
		Start-Process -FilePath $pwshExe -ArgumentList $argList -WindowStyle Hidden
	}
	exit 0
}
