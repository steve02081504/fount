function script:Invoke-FountCmdBackground {
	RequireMany passthrough win/wt
	$env:FOUNT_BACKGROUND = 1
	Invoke-DockerPassthrough -CurrentArgs $args
	$runargs = $args[1..$args.Count]
	if (Test-Path -Path "$FOUNT_DIR/.nobackground") {
		$windowsTerminalCommand = Get-WTfountCmd @runargs
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
		) + @($runargs)
		Start-Process -FilePath $pwshExe -ArgumentList $argList -WindowStyle Hidden
	}
	exit 0
}
