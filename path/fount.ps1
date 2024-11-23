$FOUNT_DIR = Split-Path -Parent $PSScriptRoot
$ErrorCount = $Error.Count

if (!(Get-Command fount -ErrorAction SilentlyContinue)) {
	$path = $env:PATH -split ';'
	if ($path -notcontains "$FOUNT_DIR\path") {
		$path += "$FOUNT_DIR\path"
	}
	$path = $path -join ';'
	[System.Environment]::SetEnvironmentVariable('PATH', $path, [System.EnvironmentVariableTarget]::User)
}

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
	if (!(Get-Command winget -ErrorAction SilentlyContinue)) {
		Import-Module Appx
		Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
	}
	if (Get-Command winget -ErrorAction SilentlyContinue) {
		winget install --id Git.Git -e --source winget
	}
}
if (Get-Command git -ErrorAction SilentlyContinue) {
	if (!(Test-Path -Path "$FOUNT_DIR/.git")) {
		Remove-Item -Path "$FOUNT_DIR/.git-clone" -Recurse -Force -ErrorAction SilentlyContinue
		New-Item -ItemType Directory -Path "$FOUNT_DIR/.git-clone"
		git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR/.git-clone" --no-checkout --depth 1
		Move-Item -Path "$FOUNT_DIR/.git-clone/.git" -Destination "$FOUNT_DIR/.git"
		Remove-Item -Path "$FOUNT_DIR/.git-clone" -Recurse -Force
		git -C "$FOUNT_DIR" fetch origin
		git -C "$FOUNT_DIR" reset --hard origin/master
		git -C "$FOUNT_DIR" checkout origin/master
	}
	git -C "$FOUNT_DIR" pull
}
else {
	Write-Host "Git is not installed, skipping git pull"
}

if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
	Invoke-RestMethod bun.sh/install.ps1 | Invoke-Expression
	if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
		Write-Host "Bun missing, you cant run fount without bun"
		exit 1
	}
}

bun run "$FOUNT_DIR/src/server/index.mjs" @args

if ($ErrorCount -ne $Error.Count -or $LASTEXITCODE -ne 0) {
	Pause
	exit $LASTEXITCODE
}
