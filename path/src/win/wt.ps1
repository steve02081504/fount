# Single string for Start-Process -ArgumentList (array form nests/empties and blows up on bind).
function script:Get-FountPs1ArgumentList {
	# Per-arg Windows CommandLineToArgvW escaping, then join into one -ArgumentList string.
	"-noprofile -nologo -ExecutionPolicy Bypass -File `"$FOUNT_DIR\path\fount.ps1`" $(($args | ForEach-Object {
		$a = "$_"
		if ($a -notmatch '[\s"]' -and $a.Length) { $a }
		else { '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }
	}) -join ' ')"
}

function script:Get-WTfountCmd {
	$ArgumentList = Get-FountPs1ArgumentList @args
	$FilePath = "powershell.exe"
	if (Get-AppxPackage -Name "Microsoft.WindowsTerminal") {
		if (!(Test-Path -Path "$FOUNT_DIR/node_modules")) {
			Register-FountTerminalProfile
		}
		$FilePath = "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe"
		$ArgumentList = "-p fount powershell.exe $ArgumentList"
	}
	return @{
		FilePath     = $FilePath
		ArgumentList = $ArgumentList
	}
}

function script:Start-WTfountCmd {
	$wtCmd = Get-WTfountCmd @args
	Start-Process -FilePath $wtCmd.FilePath -ArgumentList $wtCmd.ArgumentList
}

function script:Register-FountTerminalProfile {
	$WTjsonDirPath = "$env:LOCALAPPDATA/Microsoft/Windows Terminal/Fragments/fount"
	if (!(Test-Path $WTjsonDirPath)) {
		New-Item -ItemType Directory -Force -Path $WTjsonDirPath | Out-Null
	}
	$WTjsonPath = "$WTjsonDirPath/fount.json"
	$jsonContent = [ordered]@{
		'$help'   = "https://aka.ms/terminal-documentation"
		'$schema' = "https://aka.ms/terminal-profiles-schema"
		profiles  = @(
			[ordered]@{
				name              = "fount"
				guid              = "{780ca695-2d01-5e08-834e-1e9bfd14d3ee}"
				tabTitle          = "𝓯𝓸𝓾𝓷𝓽"
				tabColor          = "#0e3c5c"
				commandline       = "fount.bat"
				startingDirectory = $FOUNT_DIR
				icon              = "$FOUNT_DIR\src\public\pages\favicon.ico"
				font              = @{
					face   = "FiraCode Nerd Font"
					weight = "semi-light"
				}
				historySize = 100000
				opacity     = 72
				"experimental.retroTerminalEffect" = $true
			}
		)
	} | ConvertTo-Json -Depth 100 -Compress
	$existing = Get-Content -LiteralPath $WTjsonPath -Raw -ErrorAction Ignore
	if ($jsonContent -ne $existing) {
		Set-Content -Path $WTjsonPath -Value $jsonContent -Encoding UTF8
	}
}
