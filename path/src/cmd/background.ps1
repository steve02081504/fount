function script:Invoke-FountCmdBackground {
	param([string[]]$CommandArgs)
	. $FountRequireMany passthrough win/wt
	$env:FOUNT_BACKGROUND = 1
	Invoke-DockerPassthrough -CurrentArgs $CommandArgs
	$runargs = $CommandArgs[1..$CommandArgs.Count]
	if (Test-Path -Path "$FOUNT_DIR/.nobackground") {
		$cmd = Get-WTfountCmd -ArgumentList $runargs
		Start-Process -FilePath $cmd.FilePath -ArgumentList $cmd.ArgumentList
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
