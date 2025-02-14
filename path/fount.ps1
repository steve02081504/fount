$FOUNT_DIR = Split-Path -Parent $PSScriptRoot

if ($args.Count -gt 0 -and $args[0] -eq 'background') {
	if (!(Get-Command ps12exe -ErrorAction Ignore)) {
		Install-Module -Name ps12exe -Scope CurrentUser -Force
	}
	$TempDir = [System.IO.Path]::GetTempPath()
	$exepath = Join-Path $TempDir "fount-background.exe"
	if (!(Test-Path $exepath)) {
		ps12exe -inputFile "$FOUNT_DIR/src/runner/background.ps1" -outputFile $exepath
	}
	$runargs = $args[1..$args.Count]
	Start-Process -FilePath $exepath -ArgumentList $runargs
	exit
}

$ErrorCount = $Error.Count

# Docker 检测
$IN_DOCKER = $false

# fount 路径设置
if (!(Get-Command fount -ErrorAction SilentlyContinue)) {
	$path = $env:PATH -split ';'
	if ($path -notcontains "$FOUNT_DIR\path") {
		$path += "$FOUNT_DIR\path"
	}
	$path = $path -join ';'
	[System.Environment]::SetEnvironmentVariable('PATH', $path, [System.EnvironmentVariableTarget]::User)
}
# fount Terminal注册
$WTjsonDirPath = "$env:LOCALAPPDATA/Microsoft/Windows Terminal/Fragments/fount"
if (!(Test-Path $WTjsonDirPath)) {
	New-Item -ItemType Directory -Force -Path $WTjsonDirPath
}
$WTjsonPath = "$WTjsonDirPath/fount.json"
$jsonContent = [ordered]@{
	'$help'   = "https://aka.ms/terminal-documentation"
	'$schema' = "https://aka.ms/terminal-profiles-schema"
	profiles  = @(
		[ordered]@{
			name              = "fount"
			commandline       = "fount.bat"
			startingDirectory = $FOUNT_DIR
			icon              = Join-Path $FOUNT_DIR src/public/favicon.ico
		}
	)
} | ConvertTo-Json -Depth 100 -Compress
if ($jsonContent -ne (Get-Content $WTjsonPath -ErrorAction Ignore)) {
	Set-Content -Path $WTjsonPath -Value $jsonContent
}

# Git 安装和更新
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
	Write-Host "Git is not installed, attempting to install..."
	if (!(Get-Command winget -ErrorAction SilentlyContinue)) {
		Import-Module Appx
		Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
	}
	if (Get-Command winget -ErrorAction SilentlyContinue) {
		winget install --id Git.Git -e --source winget
	}
	$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
	if (!(Get-Command git -ErrorAction SilentlyContinue)) {
		Write-Host "Failed to install Git, please install it manually."
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

	if ($IN_DOCKER) {
		Write-Host "Skipping git pull in Docker environment"
	}
	else {
		git -C "$FOUNT_DIR" pull -f --allow-unrelated-histories
	}
}
else {
	Write-Host "Git is not installed, skipping git pull"
}

# Deno 安装
if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
	Write-Host "Deno missing, auto installing..."
	Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
	$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		Write-Host "Deno missing, you cant run fount without deno"
		exit 1
	}
}

# Deno 更新
if ($IN_DOCKER) {
	Write-Host "Skipping deno upgrade in Docker environment"
}
else {
	deno upgrade -q
}

deno -V

# 安装依赖
if (!(Test-Path -Path "$FOUNT_DIR/node_modules") -or ($args.Count -gt 0 -and $args[0] -eq 'init')) {
	Write-Host "Installing dependencies..."
	deno install --reload --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
}

# 执行 fount
function run {
	if ($args.Count -gt 0 -and $args[0] -eq 'debug') {
		$newargs = $args[1..$args.Count]
		deno run --allow-scripts --allow-all --inspect-brk "$FOUNT_DIR/src/server/index.mjs" @newargs
	}
	else {
		deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" @args
	}
}
if ($args.Count -gt 0 -and $args[0] -eq 'geneexe') {
	$exepath = $args[1]
	if (!$exepath) { $exepath = "fount.exe" }
	$exepath = Join-Path $pwd $exepath
	if (!(Get-Command ps12exe -ErrorAction Ignore)) {
		Install-Module -Name ps12exe -Scope CurrentUser -Force
	}
	ps12exe -inputFile "$FOUNT_DIR/src/runner/main.ps1" -outputFile $exepath
	exit $LastExitCode
}
elseif ($args.Count -gt 0 -and $args[0] -eq 'init') {
	exit 0
}
elseif ($args.Count -gt 0 -and $args[0] -eq 'keepalive') {
	$runargs = $args[1..$args.Count]
	run @runargs
	while ($LastExitCode) { run }
}
else {
	run @args
}

if ($ErrorCount -ne $Error.Count) { exit 1 }
exit $LastExitCode
