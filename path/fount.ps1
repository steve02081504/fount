﻿$FOUNT_DIR = Split-Path -Parent $PSScriptRoot

$ErrorCount = $Error.Count

if ($PSEdition -eq "Desktop") {
	try { $IsWindows = $true } catch {}
}

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

$auto_installed_pwsh_modules = Get-Content "$FOUNT_DIR/data/installer/auto_installed_pwsh_modules" -Raw -ErrorAction Ignore
if (!$auto_installed_pwsh_modules) { $auto_installed_pwsh_modules = '' }
$auto_installed_pwsh_modules = $auto_installed_pwsh_modules.Split(';') | Where-Object { $_ }

function Test-PWSHModule([string]$ModuleName) {
	Get-PackageProvider -Name "NuGet" -Force | Out-Null
	if (!(Get-Module $ModuleName -ListAvailable)) {
		$auto_installed_pwsh_modules += $ModuleName
		New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
		Set-Content "$FOUNT_DIR/data/installer/auto_installed_pwsh_modules" $($auto_installed_pwsh_modules -join ';')
		Install-Module -Name $ModuleName -Scope CurrentUser -Force
	}
}

if ($args.Count -gt 0 -and $args[0] -eq 'open') {
	if ($IN_DOCKER) {
		$runargs = $args[1..$args.Count]
		fount @runargs
		exit
	}
	Test-PWSHModule fount-pwsh
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
elseif ($args.Count -gt 0 -and $args[0] -eq 'background') {
	if ($IN_DOCKER) {
		$runargs = $args[1..$args.Count]
		fount @runargs
		exit
	}
	Test-PWSHModule ps12exe
	$TempDir = [System.IO.Path]::GetTempPath()
	$exepath = Join-Path $TempDir "fount-background.exe"
	if (!(Test-Path $exepath)) {
		ps12exe -inputFile "$FOUNT_DIR/src/runner/background.ps1" -outputFile $exepath
	}
	$runargs = $args[1..$args.Count]
	Start-Process -FilePath $exepath -ArgumentList $runargs
	exit
}
elseif ($args.Count -gt 0 -and $args[0] -eq 'protocolhandle') {
	if ($IN_DOCKER) {
		$runargs = $args[1..$args.Count]
		fount @runargs
		exit
	}
	# 新增 protocolhandle 逻辑
	$protocolUrl = $args[1]
	if (-not $protocolUrl) {
		Write-Error "Error: No URL provided for protocolhandle."
		exit 1
	}
	# 编码 URL 参数，防止特殊字符问题，确保传入的 URL 能正确作为查询参数
	$encodedUrl = [uri]::EscapeDataString($protocolUrl)
	$targetUrl = "https://steve02081504.github.io/fount/protocol/?url=$encodedUrl"

	Test-PWSHModule fount-pwsh
	Start-Job -ScriptBlock {
		param ($targetUrl)
		while (-not (Test-FountRunning)) {
			Start-Sleep -Seconds 1
		}
		Start-Process $targetUrl
	} -ArgumentList $targetUrl
	$runargs = $args[2..$args.Count]
	fount @runargs
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
			if (!(Get-Module $_ -ListAvailable)) {
				$auto_installed_pwsh_modules += $_
				New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
				Set-Content "$FOUNT_DIR/data/installer/auto_installed_pwsh_modules" $($auto_installed_pwsh_modules -join ';')
			}
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

if (!$IsWindows) {
	bash $FOUNT_DIR/path/fount.sh @args
	exit $LastExitCode
}

# Git 安装和更新
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
	Write-Host "Git is not installed, attempting to install..."
	if (!(Get-Command winget -ErrorAction SilentlyContinue)) {
		Import-Module Appx
		Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
		New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
		Set-Content "$FOUNT_DIR/data/installer/auto_installed_winget" '1'
	}
	$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
	if (Get-Command winget -ErrorAction SilentlyContinue) {
		winget install --id Git.Git -e --source winget
		New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
		Set-Content "$FOUNT_DIR/data/installer/auto_installed_git" '1'
	}
	else {
		Write-Host "Failed to install Git because Winget is failed to install, please install it manually."
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
		New-Item -ItemType Directory -Path "$FOUNT_DIR/.git-clone" | Out-Null
		git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR/.git-clone" --no-checkout --depth 1 --single-branch
		if ($LastExitCode) {
			Remove-Item -Path "$FOUNT_DIR/.git-clone" -Recurse -Force
			Write-Host "Failed to clone fount repository, skipping update"
			return
		}
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
	if (Test-Path "$HOME/.deno/bin/deno.exe") {
		$env:PATH = $env:PATH + ";$HOME/.deno/bin"
		[System.Environment]::SetEnvironmentVariable("PATH", [System.Environment]::GetEnvironmentVariable("PATH", "User") + ";$HOME/.deno/bin", [System.EnvironmentVariableTarget]::User)
	}
}
if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
	Write-Host "Deno missing, auto installing..."
	Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
	}
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		Write-Host "Deno installation failed, attempting auto installing to fount's path folder..."
		$url = "https://github.com/denoland/deno/releases/latest/download/deno-" + $(if ($IsWindows) {
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
	New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
	Set-Content "$FOUNT_DIR/data/installer/auto_installed_deno" '1'
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
	if ($IsWindows) {
		Get-Process tray_windows_release -ErrorAction Ignore | Where-Object { $_.CPU -gt 0.5 } | Stop-Process
	}
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
}

# 安装依赖
if (!(Test-Path -Path "$FOUNT_DIR/node_modules") -or ($args.Count -gt 0 -and $args[0] -eq 'init')) {
	Write-Host "Installing dependencies..."
	if (Test-Path -Path "$FOUNT_DIR/node_modules") {
		run shutdown
	}
	New-Item -Path "$FOUNT_DIR/node_modules" -ItemType Directory -ErrorAction Ignore -Force | Out-Null
	deno install --reload --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
	Write-Host "======================================================" -ForegroundColor Green
	Write-Warning "DO NOT install any untrusted fount parts on your system, they can do ANYTHING."
	Write-Host "======================================================" -ForegroundColor Green
	# 生成 桌面快捷方式 和 Start Menu 快捷方式
	$shell = New-Object -ComObject WScript.Shell

	$shortcutTargetPath = "powershell.exe"
	$shortcutArguments = "-noprofile -nologo -ExecutionPolicy Bypass -File `"$FOUNT_DIR\path\fount.ps1`" open keepalive"
	if (Test-Path "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe") {
		$shortcutTargetPath = "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe"
		$shortcutArguments = "-p fount powershell.exe $shortcutArguments" # Prepend -p fount to existing arguments
	}
	$shortcutIconLocation = "$FOUNT_DIR\src\public\favicon.ico"

	# 创建桌面快捷方式
	$desktopPath = [Environment]::GetFolderPath("Desktop")
	$desktopShortcut = $shell.CreateShortcut("$desktopPath\fount.lnk")
	$desktopShortcut.TargetPath = $shortcutTargetPath
	$desktopShortcut.Arguments = $shortcutArguments
	$desktopShortcut.IconLocation = $shortcutIconLocation
	$desktopShortcut.Save()
	Write-Host "Desktop shortcut created at $desktopPath\fount.lnk"

	# 创建开始菜单快捷方式
	$startMenuPath = [Environment]::GetFolderPath("StartMenu")
	$startMenuShortcut = $shell.CreateShortcut("$startMenuPath\fount.lnk")
	$startMenuShortcut.TargetPath = $shortcutTargetPath
	$startMenuShortcut.Arguments = $shortcutArguments
	$startMenuShortcut.IconLocation = $shortcutIconLocation
	$startMenuShortcut.Save()
	Write-Host "Start Menu shortcut created at $startMenuPath\fount.lnk"

	# fount 协议注册
	$protocolName = "fount"
	$protocolDescription = "URL:fount Protocol"
	# 使用 fount.bat 作为协议处理程序，因为它是Windows上的主入口点
	$command = "`"$FOUNT_DIR\path\fount.bat`" protocolhandle `"%1`""
	try {
		# 创建目录
		New-Item -Path "HKCU:\Software\Classes\$protocolName" -Force | Out-Null
		# 设置协议根键
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName" -Name "(Default)" -Value $protocolDescription -ErrorAction Stop
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName" -Name "URL Protocol" -Value "" -ErrorAction Stop
		# 创建 shell\open\command 子键
		New-Item -Path "HKCU:\Software\Classes\$protocolName\shell\open\command" -Force | Out-Null
		# 设置协议处理命令
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName\shell\open\command" -Name "(Default)" -Value $command -ErrorAction Stop
	}
	catch {
		Write-Warning "Failed to register fount:// protocol handler: $($_.Exception.Message)"
	}

	# fount Terminal注册
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
				commandline       = "fount.bat keepalive"
				startingDirectory = $FOUNT_DIR
				icon              = Join-Path $FOUNT_DIR src/public/favicon.ico
			}
		)
	} | ConvertTo-Json -Depth 100 -Compress
	if ($jsonContent -ne (Get-Content $WTjsonPath -ErrorAction Ignore)) {
		Set-Content -Path $WTjsonPath -Value $jsonContent
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
	Write-Host "Removing fount..."

	# Remove fount from PATH
	Write-Host "Removing fount from PATH..."
	$path = $env:PATH -split ';'
	$path = $path | Where-Object { !$_.StartsWith("$FOUNT_DIR") }
	$env:Path = $path -join ';'
	$UserPath = [System.Environment]::GetEnvironmentVariable('PATH', [System.EnvironmentVariableTarget]::User)
	$UserPath = $UserPath -split ';'
	$UserPath = $UserPath | Where-Object { !$_.StartsWith("$FOUNT_DIR") }
	$UserPath = $UserPath -join ';'
	[System.Environment]::SetEnvironmentVariable('PATH', $UserPath, [System.EnvironmentVariableTarget]::User)
	Write-Host "Fount removed from PATH."

	# Remove fount-pwsh from PowerShell Profile
	Write-Host "Removing fount-pwsh from PowerShell Profile..."
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
		Write-Host "PowerShell Profile not found, skipping fount-pwsh removal from profile."
	}

	# Uninstall fount-pwsh
	Write-Host "Uninstalling fount-pwsh..."
	try { Uninstall-Module -Name fount-pwsh -Scope CurrentUser -Force -ErrorAction Stop } catch {}

	# Remove fount protocol handler (新增)
	if (-not $IN_DOCKER) {
		Write-Host "Removing fount:// protocol handler..."
		try {
			# 静默删除注册表键及其所有子键
			Remove-Item -Path "HKCU:\Software\Classes\fount" -Recurse -Force -ErrorAction SilentlyContinue
			Write-Host "fount:// protocol handler removed."
		}
		catch {
			Write-Warning "Failed to remove fount:// protocol handler: $($_.Exception.Message)"
		}
	}

	# Remove Windows Terminal Profile
	Write-Host "Removing Windows Terminal Profile..."
	$WTjsonDirPath = "$env:LOCALAPPDATA/Microsoft/Windows Terminal/Fragments/fount"
	if (Test-Path $WTjsonDirPath -PathType Container) {
		Remove-Item -Path $WTjsonDirPath -Force -Recurse
		Write-Host "Windows Terminal Profile directory removed."
	}
	else {
		Write-Host "Windows Terminal Profile directory not found."
	}

	# Remove Desktop Shortcut
	Write-Host "Removing Desktop Shortcut..."
	$desktopShortcutPath = [Environment]::GetFolderPath("Desktop") + "\fount.lnk"
	if (Test-Path $desktopShortcutPath) {
		Remove-Item -Path $desktopShortcutPath -Force
		Write-Host "Desktop Shortcut removed."
	}
	else {
		Write-Host "Desktop Shortcut not found."
	}

	# Remove Start Menu Shortcut
	Write-Host "Removing Start Menu Shortcut..."
	$startMenuShortcutPath = [Environment]::GetFolderPath("StartMenu") + "\fount.lnk"
	if (Test-Path $startMenuShortcutPath) {
		Remove-Item -Path $startMenuShortcutPath -Force
		Write-Host "Start Menu Shortcut removed."
	}
	else {
		Write-Host "Start Menu Shortcut not found."
	}

	# Remove Installed pwsh modules
	Write-Host "Removing Installed pwsh modules..."
	$auto_installed_pwsh_modules | ForEach-Object {
		try {
			if (Get-Module $_ -ListAvailable) {
				Uninstall-Module -Name $_ -Scope CurrentUser -Force -ErrorAction Stop
				Write-Host "$_ removed."
			}
		}
		catch {
			Write-Warning "Failed to remove ${_}: $($_.Exception.Message)"
		}
	}

	if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_git") {
		Write-Host "Uninstalling Git..."
		winget uninstall --id Git.Git -e --source winget
	}

	if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_winget") {
		Write-Host "Uninstalling Winget..."
		Import-Module Appx
		Remove-AppxPackage -Package Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
	}

	if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_deno") {
		Write-Host "Uninstalling Deno..."
		try{ Remove-Item $(Get-Command deno).Source -Force } catch {}
		Remove-Item "~/.deno" -Force -Recurse -ErrorAction Ignore
	}

	# Remove fount installation directory
	Write-Host "Removing fount installation directory..."
	Remove-Item -Path $FOUNT_DIR -Recurse -Force -ErrorAction SilentlyContinue
	Write-Host "Fount installation directory removed."

	Write-Host "Fount uninstallation complete."
	exit 0
}
else {
	run @args
}

if ($ErrorCount -ne $Error.Count) { exit 1 }
exit $LastExitCode
