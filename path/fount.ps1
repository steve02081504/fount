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
	git -C "$FOUNT_DIR" pull -f
}
else {
	Write-Host "Git is not installed, skipping git pull"
}

if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
	Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		Write-Host "Deno missing, you cant run fount without deno"
		exit 1
	}
}

deno upgrade
if (!(Test-Path -Path "$FOUNT_DIR/node_modules")) {
	deno install --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
}
if ($args.Count -gt 0 -and $args[0] -eq 'debug') {
	$newargs = $args[1..$args.Count]
	deno run --allow-scripts --allow-all --inspect-brk "$FOUNT_DIR/src/server/index.mjs" @newargs
}
else {
	deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" @args
}

if ($ErrorCount -ne $Error.Count -or ($LASTEXITCODE -ne 0) -and ($LASTEXITCODE -ne 255)) {
	Pause
	exit $LASTEXITCODE
}
