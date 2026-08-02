function Invoke-FountCmdBackground {
	param([string[]]$CommandArgs)
	Invoke-DockerPassthrough -CurrentArgs $CommandArgs
	$env:FOUNT_BACKGROUND = 1
	$runargs = $CommandArgs[1..$CommandArgs.Count]
	if (Test-Path -Path "$FOUNT_DIR/.nobackground") {
		$TargetPath = "powershell.exe"
		$runargs = $runargs | ForEach-Object { ($_ -replace '\', '\\') -replace '"', '\"' }
		$Arguments = "-noprofile -nologo -ExecutionPolicy Bypass -File `"$FOUNT_DIR\path\fount.ps1`" `"$($runargs -join '" "')`""
		if (Get-AppxPackage -Name "Microsoft.WindowsTerminal") {
			$TargetPath = "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe"
			$Arguments = "-p fount powershell.exe $Arguments"
		}
		Start-Process -FilePath $TargetPath -ArgumentList $Arguments
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
