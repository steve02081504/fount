$FOUNT_DIR = Split-Path -Parent $PSScriptRoot

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
	$UserPath = [System.Environment]::GetEnvironmentVariable('PATH', [System.EnvironmentVariableTarget]::User)
	$UserPath = $UserPath -split ';'
	if ($UserPath -notcontains "$FOUNT_DIR\path") {
		$UserPath += "$FOUNT_DIR\path"
	}
	$UserPath = $UserPath -join ';'
	[System.Environment]::SetEnvironmentVariable('PATH', $UserPath, [System.EnvironmentVariableTarget]::User)
	$env:PATH = $path
}

if ($args.Count -gt 0 -and $args[0] -eq 'open') {
	if (!(Get-Module fount-pwsh -ListAvailable)) {
		Install-Module -Name fount-pwsh -Scope CurrentUser -Force
	}
	$runargs = $args[1..$args.Count]
	Start-Job -ScriptBlock {
		while (-not (Test-FountRunning)) {
			Start-Sleep -Seconds 1
		}
		Start-Process 'https://steve02081504.github.io/fount/protocol'
	}
	$runargs = $args[1..$args.Count]
	fount @runargs
	exit
}
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

# 新建一个背景job用于后台更新所需的pwsh模块
Start-Job -ScriptBlock {
	@('ps12exe', 'fount-pwsh') | ForEach-Object {
		# 先获取本地模块的版本号，若是0.0.0则跳过更新（开发版本）
		$localVersion = (Get-Module $_ -ListAvailable).Version
		if ("$localVersion" -eq '0.0.0') { return }
		$latestVersion = (Find-Module $_).Version
		if ("$latestVersion" -ne "$localVersion") {
			Install-Module -Name $_ -Scope CurrentUser -Force
		}
	}
} | Out-Null

# 向用户的$Profile中注册导入fount-pwsh
if ($Profile -and (Get-Module fount-pwsh -ListAvailable)) {
	$ProfileContent = Get-Content $Profile -ErrorAction Ignore
	$ProfileContent = $ProfileContent -split "`n"
	$ProfileContent = $ProfileContent | Where-Object { $_ -notmatch 'Import-Module fount-pwsh' }
	$ProfileContent = $ProfileContent -join "`n"
	$ProfileContent += "`nImport-Module fount-pwsh`n"
	$ProfileContent = $ProfileContent -replace '\n+Import-Module fount-pwsh', "`nImport-Module fount-pwsh"
	if ($ProfileContent -ne (Get-Content $Profile -ErrorAction Ignore)) {
		Set-Content -Path $Profile -Value $ProfileContent
	}
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
			commandline       = "fount.bat keepalive"
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

function fount_upgrade {
	if (!(Get-Command git -ErrorAction SilentlyContinue)) {
		Write-Host "Git is not installed, skipping git pull"
		return
	}
	if (!(Test-Path -Path "$FOUNT_DIR/.git")) {
		Remove-Item -Path "$FOUNT_DIR/.git-clone" -Recurse -Force -ErrorAction SilentlyContinue
		New-Item -ItemType Directory -Path "$FOUNT_DIR/.git-clone"
		git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR/.git-clone" --no-checkout --depth 1
		Move-Item -Path "$FOUNT_DIR/.git-clone/.git" -Destination "$FOUNT_DIR/.git"
		Remove-Item -Path "$FOUNT_DIR/.git-clone" -Recurse -Force
		git -C "$FOUNT_DIR" fetch origin
		git -C "$FOUNT_DIR" clean -fd
		git -C "$FOUNT_DIR" reset --hard "origin/master"
		git -C "$FOUNT_DIR" checkout master
	}

	if (!(Test-Path -Path "$FOUNT_DIR/.git")) {
		Write-Host "Repository not found, skipping git pull"
	}
	else {
		git -C "$FOUNT_DIR" fetch origin
		$currentBranch = git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD
		if ($currentBranch -eq 'HEAD') {
			Write-Host "Not on a branch, switching to 'master'..."
			git -C "$FOUNT_DIR" clean -fd
			git -C "$FOUNT_DIR" reset --hard "origin/master"
			git -C "$FOUNT_DIR" checkout master
			$currentBranch = git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD
		}
		$remoteBranch = git -C "$FOUNT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
		if (-not $remoteBranch) {
			Write-Warning "No upstream branch configured for '$currentBranch'. Setting upstream to 'origin/master'."
			git -C "$FOUNT_DIR" branch --set-upstream-to origin/master
		}
		$mergeBase = git -C "$FOUNT_DIR" merge-base $currentBranch $remoteBranch
		$localCommit = git -C "$FOUNT_DIR" rev-parse $currentBranch
		$remoteCommit = git -C "$FOUNT_DIR" rev-parse $remoteBranch
		$status = git -C "$FOUNT_DIR" status --porcelain
		if ($status) {
			Write-Warning "Working directory is not clean.  Stash or commit your changes before updating."
		}

		if ($localCommit -ne $remoteCommit) {
			if ($mergeBase -eq $localCommit) {
				Write-Host "Updating from remote repository..."
				git -C "$FOUNT_DIR" fetch origin
				git -C "$FOUNT_DIR" reset --hard $remoteBranch
			}
			elseif ($mergeBase -eq $remoteCommit) {
				Write-Host "Local branch is ahead of remote. No update needed."
			}
			else {
				Write-Host "Local and remote branches have diverged. Force updating..."
				git -C "$FOUNT_DIR" fetch origin
				git -C "$FOUNT_DIR" reset --hard $remoteBranch
			}
		}
		else {
			Write-Host "Already up to date."
		}
	}
}

if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
	Write-Host "Skipping fount update due to .noupdate file"
}
else {
	fount_upgrade
}

# Deno 安装
if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
	Write-Host "Deno missing, auto installing..."
	Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
	$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		Write-Host "Deno installation failed, attempting auto installing to fount's path folder..."
		$url = "https://github.com/denoland/deno/releases/latest/download/deno-" + (if ($IsWindows) {
			"x86_64-pc-windows-msvc.zip"
		} elseif ($IsMacOS) {
			if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
				"aarch64-apple-darwin.zip"
			}
			else {
				"x86_64-apple-darwin.zip"
			}
		} else {
			"x86_64-unknown-linux-gnu.zip"
		})
		Invoke-WebRequest -Uri $url -OutFile "$env:TEMP/deno.zip"
		Expand-Archive -Path "$env:TEMP/deno.zip" -DestinationPath "$FOUNT_DIR/path"
		Remove-Item -Path "$env:TEMP/deno.zip" -Force
	}
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		Write-Host "Deno missing, you cant run fount without deno"
		exit 1
	}
}

# Deno 更新
function deno_upgrade() {
	$deno_ver = deno -V
	if (!$deno_ver) {
		deno upgrade -q
		$deno_ver = deno -V
	}
	if (!$deno_ver) {
		Write-Error "For some reason deno doesn't work, you may need to join https://discord.gg/deno to get support" -ErrorAction Ignore
		exit
	}
	$deno_update_channel = "stable"
	if ($deno_ver.Contains("+")) {
		$deno_update_channel = "canary"
	}
	elseif ($deno_ver.Contains("-rc")) {
		$deno_update_channel = "rc"
	}
	deno upgrade -q $deno_update_channel
}

if ($IN_DOCKER) {
	Write-Host "Skipping deno upgrade in Docker environment"
}
else {
	deno_upgrade
}

deno -V

# 安装依赖
if (!(Test-Path -Path "$FOUNT_DIR/node_modules") -or ($args.Count -gt 0 -and $args[0] -eq 'init')) {
	Write-Host "Installing dependencies..."
	deno install --reload --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
	Write-Host "======================================================" -ForegroundColor Green
	Write-Warning "DO NOT install any untrusted fount parts on your system, they can do ANYTHING."
	Write-Host "======================================================" -ForegroundColor Green
	# 生成 桌面快捷方式
	if ($IsWindows) {
		$shell = New-Object -ComObject WScript.Shell
		$desktop = [Environment]::GetFolderPath("Desktop")
		$shortcut = $shell.CreateShortcut("$desktop\fount.lnk")
		if (Test-Path "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe") {
			$shortcut.TargetPath = "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe"
			$shortcut.Arguments = "-p fount powershell.exe -noprofile -nologo -ExecutionPolicy Bypass -File $FOUNT_DIR\path\fount.ps1 open keepalive"
		}
		else {
			$shortcut.TargetPath = "powershell.exe"
			$shortcut.Arguments = "-noprofile -nologo -ExecutionPolicy Bypass -File $FOUNT_DIR\path\fount.ps1 open keepalive"
		}
		$shortcut.IconLocation = "$FOUNT_DIR\src\public\favicon.ico"
		$shortcut.Save()
	}
}

# 执行 fount
function isRoot {
	if ($IsWindows) {
		([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
	}
	else {
		$UID -eq 0
	}
}
function run {
	if (isRoot) {
		Write-Warning "Not Recommended: Running fount as root grants full system access for all fount parts."
		Write-Warning "Unless you know what you are doing, it is recommended to run fount as a common user."
	}
	if ($args.Count -gt 0 -and $args[0] -eq 'debug') {
		$newargs = $args[1..$args.Count]
		deno run --allow-scripts --allow-all --inspect-brk "$FOUNT_DIR/src/server/index.mjs" @newargs
	}
	else {
		deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" @args
	}
	if ($IsWindows) {
		Get-Process tray_windows_release -ErrorAction Ignore | Where-Object { $_.CPU -gt 0.5 } | Stop-Process
	}
}
if ($args.Count -gt 0 -and $args[0] -eq 'geneexe') {
	$exepath = $args[1]
	if (!$exepath) { $exepath = "fount.exe" }
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
	while ($LastExitCode) {
		deno_upgrade
		fount_upgrade
		run
	}
}
elseif ($args.Count -gt 0 -and $args[0] -eq 'remove') {
	run shutdown
	Write-Host "removing fount..."

	# Remove fount from PATH
	Write-Host "removing fount from PATH..."
	$path = $env:PATH -split ';'
	$path = $path | Where-Object { !$_.StartsWith("$FOUNT_DIR") }
	$env:Path = $path -join ';'
	$UserPath = [System.Environment]::GetEnvironmentVariable('PATH', [System.EnvironmentVariableTarget]::User)
	$UserPath = $UserPath -split ';'
	$UserPath = $UserPath | Where-Object { !$_.StartsWith("$FOUNT_DIR") }
	$UserPath = $UserPath -join ';'
	[System.Environment]::SetEnvironmentVariable('PATH', $UserPath, [System.EnvironmentVariableTarget]::User)
	Write-Host "fount removed from PATH."

	# Remove fount-pwsh from PowerShell Profile
	Write-Host "removing fount-pwsh from PowerShell Profile..."
	if (Test-Path $Profile) {
		$ProfileContent = Get-Content $Profile -ErrorAction Ignore
		$ProfileContent = $ProfileContent -split "`n"
		$ProfileContent = $ProfileContent | Where-Object { $_ -notmatch 'Import-Module fount-pwsh' }
		$ProfileContent = $ProfileContent -join "`n"
		if ($ProfileContent -ne ((Get-Content $Profile -ErrorAction Ignore) -split "`n" -join "`n")) {
			Set-Content -Path $Profile -Value $ProfileContent
		}
		Write-Host "fount-pwsh removed from PowerShell Profile."
	}
	else {
		Write-Host "powerShell Profile not found, skipping fount-pwsh removal from profile."
	}

	# uninstall fount-pwsh
	Write-Host "Uninstalling fount-pwsh..."
	try { Uninstall-Module -Name fount-pwsh -Scope CurrentUser -Force -ErrorAction Stop } catch {}

	# Remove Windows Terminal Profile
	Write-Host "removing Windows Terminal Profile..."
	$WTjsonDirPath = "$env:LOCALAPPDATA/Microsoft/Windows Terminal/Fragments/fount"
	if (Test-Path $WTjsonDirPath -PathType Container) {
		Remove-Item -Path $WTjsonDirPath -Force -Recurse
		Write-Host "Windows Terminal Profile directory removed."
	}
	else {
		Write-Host "Windows Terminal Profile directory not found."
	}

	# Remove Desktop Shortcut
	Write-Host "removing Desktop Shortcut..."
	$ShortcutPath = "$env:USERPROFILE\Desktop\fount.lnk"
	if (Test-Path $ShortcutPath) {
		Remove-Item -Path $ShortcutPath -Force
		Write-Host "Desktop Shortcut removed."
	}
	else {
		Write-Host "Desktop Shortcut not found."
	}

	# Remove fount installation directory
	Write-Host "removing fount installation directory..."
	Remove-Item -Path $FOUNT_DIR -Recurse -Force -ErrorAction SilentlyContinue
	Write-Host "fount installation directory removed."

	Write-Host "fount uninstallation complete."
	exit 0
}
else {
	run @args
}

if ($ErrorCount -ne $Error.Count) { exit 1 }
exit $LastExitCode
