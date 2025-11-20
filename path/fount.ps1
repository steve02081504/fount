$FOUNT_DIR = Split-Path -Parent $PSScriptRoot

# --- i18n functions ---
# Get system locales
function Get-SystemLocales {
	$locales = New-Object System.Collections.Generic.List[string]
	$locales.Add((Get-Culture).Name)
	if ($env:LANG) { $locales.Add($env:LANG.Split('.')[0].Replace('_', '-')) }
	if ($env:LANGUAGE) { $locales.Add($env:LANGUAGE.Split('.')[0].Replace('_', '-')) }
	if ($env:LC_ALL) { $locales.Add($env:LC_ALL.Split('.')[0].Replace('_', '-')) }
	$locales.Add('en-UK') # Fallback
	return $locales | Select-Object -Unique
}

# Get available locales from src/locales/list.csv
function Get-AvailableLocales {
	$localeListFile = Join-Path $FOUNT_DIR 'src/locales/list.csv'
	if (Test-Path $localeListFile) {
		try {
			return Import-Csv $localeListFile | Select-Object -ExpandProperty lang
		}
		catch {
			return @('en-UK') # Fallback
		}
	}
 else {
		return @('en-UK') # Fallback
	}
}

# Find the best locale to use
function Get-BestLocale {
	param(
		[string[]]$preferredLocales,
		[string[]]$availableLocales
	)

	foreach ($preferred in $preferredLocales) {
		if ($availableLocales -contains $preferred) {
			return $preferred
		}
	}

	foreach ($preferred in $preferredLocales) {
		$prefix = $preferred.Split('-')[0]
		foreach ($available in $availableLocales) {
			if ($available.StartsWith($prefix)) {
				return $available
			}
		}
	}

	return 'en-UK' # Default
}

# Load localization data
function Import-LocaleData {
	if (-not $env:FOUNT_LOCALE) {
		$systemLocales = Get-SystemLocales
		$availableLocales = Get-AvailableLocales
		$env:FOUNT_LOCALE = Get-BestLocale -preferredLocales $systemLocales -availableLocales $availableLocales
	}
	$localeFile = Join-Path $FOUNT_DIR "src/locales/$($env:FOUNT_LOCALE).json"
	if (-not (Test-Path $localeFile)) {
		$env:FOUNT_LOCALE = 'en-UK'
		$localeFile = Join-Path $FOUNT_DIR "src/locales/en-UK.json"
	}

	try {
		Get-Content $localeFile -Raw -Encoding UTF8 | ConvertFrom-Json
	} catch { $null }
}

# Get a translated string
$Script:FountLocaleData = $null
function Get-I18n {
	param(
		[string]$key,
		[hashtable]$params = @{}
	)

	if ($null -eq $Script:FountLocaleData) {
		$Script:FountLocaleData = Import-LocaleData
	}

	$keys = $key.Split('.')
	$translation = $Script:FountLocaleData.fountConsole.path
	foreach ($k in $keys) {
		if ($null -ne $translation -and $translation.PSObject.Properties[$k]) {
			$translation = $translation.$k
		}
		else {
			$translation = $null
			break
		}
	}

	if ($null -eq $translation) {
		$translation = $key # Fallback to the key itself
	}

	# Simple interpolation
	foreach ($paramName in $params.Keys) {
		$paramValue = $params[$paramName]
		$translation = $translation.Replace("\${$paramName}", $paramValue)
	}

	return $translation
}


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
	if (!(Get-Module $ModuleName -ListAvailable)) {
		$auto_installed_pwsh_modules += $ModuleName
		New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
		Set-Content "$FOUNT_DIR/data/installer/auto_installed_pwsh_modules" $($auto_installed_pwsh_modules -join ';')
		Get-PackageProvider -Name "NuGet" -Force | Out-Null
		Install-Module -Name $ModuleName -Scope CurrentUser -Force
	}
}

function RefreshPath {
	$env:PATH = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
function Test-Winget {
	try {
		if (!(Get-Command winget -ErrorAction SilentlyContinue)) {
			Import-Module Appx
			try {
				Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
			}
			catch {
				try {
					Invoke-WebRequest -Uri https://aka.ms/getwinget -OutFile "$env:TEMP/winget.msixbundle"
					Add-AppxPackage -Path "$env:TEMP/winget.msixbundle"
					Remove-Item winget.msixbundle
				}
				catch {
					Add-AppxPackage -Path https://cdn.winget.microsoft.com/cache/source.msix
				}
			}
			New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$FOUNT_DIR/data/installer/auto_installed_winget" '1'
			RefreshPath
		}
	} catch { <# ignore #> }
}
function Test-Browser {
	$browser = try {
		$progId = (Get-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" -Name "ProgId" -ErrorAction Stop).'ProgId'

		if ($progId) {
			(Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -Name "(default)" -ErrorAction Stop).'(default)'
		}
	} catch { <# ignore #> }
	try {
		if (!$browser) {
			Test-Winget
			winget install --id Google.Chrome -e --source winget
			New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$FOUNT_DIR/data/installer/auto_installed_chrome" '1'
			RefreshPath
		}
	} catch { $Failed = 1 }
	try {
		if ($Failed) {
			$ChromeSetup = "ChromeSetup.exe"
			Invoke-WebRequest -Uri 'http://dl.google.com/chrome/install/chrome_installer.exe' -OutFile "$env:TEMP\$ChromeSetup"
			& "$env:TEMP\$ChromeSetup" /install
			$Process2Monitor = "ChromeSetup"
			do {
				Start-Sleep -Seconds 2
			} while (Get-Process | Where-Object { $Process2Monitor -contains $_.Name } | Select-Object -ExpandProperty Name)
			Remove-Item "$env:TEMP\$ChromeSetup" -ErrorAction SilentlyContinue

			New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$FOUNT_DIR/data/installer/auto_installed_chrome" '1'
			RefreshPath
		}
	} catch { <# ignore #> }
}

function New-InstallerDir {
	New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
}

function Invoke-DockerPassthrough {
	param (
		[Parameter(Mandatory = $true)]
		[string[]]$CurrentArgs
	)
	if ($IN_DOCKER) {
		$nestedArgs = $CurrentArgs[1..$CurrentArgs.Count]
		fount.ps1 @nestedArgs
		exit $LastExitCode
	}
}

function Set-FountFileAttributes {
	Get-ChildItem $FOUNT_DIR -Recurse -Filter desktop.ini -Force | ForEach-Object {
		$Dir = Get-Item $(Split-Path $_.FullName) -Force
		$Dir.Attributes = $Dir.Attributes -bor [System.IO.FileAttributes]::ReadOnly -bor [System.IO.FileAttributes]::Directory
		$_.Attributes = $_.Attributes -bor [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::System
	}
	Get-ChildItem $FOUNT_DIR -Recurse -Filter .* | ForEach-Object {
		$_.Attributes = $_.Attributes -bor [System.IO.FileAttributes]::Hidden
	}
}

function New-FountShortcut {
	$shell = New-Object -ComObject WScript.Shell

	$shortcutTargetPath = "powershell.exe"
	$shortcutArguments = "-noprofile -nologo -ExecutionPolicy Bypass -File `"$FOUNT_DIR\path\fount.ps1`" open keepalive"
	if (Test-Path "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe") {
		$shortcutTargetPath = "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe"
		$shortcutArguments = "-p fount powershell.exe $shortcutArguments" # Prepend -p fount to existing arguments
	}
	$shortcutIconLocation = "$FOUNT_DIR\src\pages\favicon.ico"

	$desktopPath = [Environment]::GetFolderPath("Desktop")
	Remove-Item -Force "$desktopPath\fount.lnk" -ErrorAction Ignore
	$desktopShortcut = $shell.CreateShortcut("$desktopPath\fount.lnk")
	$desktopShortcut.TargetPath = $shortcutTargetPath
	$desktopShortcut.Arguments = $shortcutArguments
	$desktopShortcut.IconLocation = $shortcutIconLocation
	$desktopShortcut.Save()
	Write-Host (Get-I18n -key 'shortcut.desktopShortcutCreated' -params @{path = "$desktopPath\fount.lnk" })

	$startMenuPath = [Environment]::GetFolderPath("StartMenu")
	Remove-Item -Force "$startMenuPath\fount.lnk" -ErrorAction Ignore
	$startMenuShortcut = $shell.CreateShortcut("$startMenuPath\fount.lnk")
	$startMenuShortcut.TargetPath = $shortcutTargetPath
	$startMenuShortcut.Arguments = $shortcutArguments
	$startMenuShortcut.IconLocation = $shortcutIconLocation
	$startMenuShortcut.Save()
	Write-Host (Get-I18n -key 'shortcut.startMenuShortcutCreated' -params @{path = "$startMenuPath\fount.lnk" })
}

function Register-FountProtocol {
	$protocolName = "fount"
	$protocolDescription = (Get-I18n -key 'protocol.description')
	$command = "`"$FOUNT_DIR\path\fount.bat`" protocolhandle `"%1`""
	try {
		New-Item -Path "HKCU:\Software\Classes\$protocolName" -Force | Out-Null
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName" -Name "(Default)" -Value $protocolDescription -ErrorAction Stop
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName" -Name "URL Protocol" -Value "" -ErrorAction Stop
		New-Item -Path "HKCU:\Software\Classes\$protocolName\shell\open\command" -Force | Out-Null
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName\shell\open\command" -Name "(Default)" -Value $command -ErrorAction Stop
	}
	catch {
		Write-Warning "Failed to register fount:// protocol handler: $($_.Exception.Message)"
	}
}

function Register-FountTerminalProfile {
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
				icon              = "$FOUNT_DIR\src\pages\favicon.ico"
			}
		)
	} | ConvertTo-Json -Depth 100 -Compress
	if ($jsonContent -ne (Get-Content $WTjsonPath -ErrorAction Ignore)) {
		Set-Content -Path $WTjsonPath -Value $jsonContent
	}
}

function deno_upgrade() {
	$deno_ver = deno -V
	if (!$deno_ver) {
		deno upgrade -q
		$deno_ver = deno -V
	}
	if (!$deno_ver) {
		Write-Error (Get-I18n -key 'deno.notWorking') -ErrorAction Ignore
		exit 1
	}
	$deno_update_channel = "stable"
	if ($deno_ver.Contains("+")) {
		$deno_update_channel = "canary"
	}
	elseif ($deno_ver.Contains("-rc")) {
		$deno_update_channel = "rc"
	}
	. { deno upgrade -q $deno_update_channel } -ErrorVariable errorOut
	if ($LastExitCode) {
		if ($errorOut.tostring().Contains("USAGE")) { # wtf deno 1.0?
			deno upgrade -q
		}
	}
	if ($LastExitCode) {
		Write-Warning (Get-I18n -key 'deno.upgradeFailed')
	}
}

function Update-FountAndDeno {
	if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
		Write-Host (Get-I18n -key 'update.skippingFountUpdate')
	}
	else {
		deno_upgrade
		fount_upgrade
	}
}

if ($args.Count -gt 0 -and $args[0] -eq 'nop') {
	exit 0
}
elseif ($args.Count -gt 0 -and $args[0] -eq 'open') {
	if (Test-Path -Path "$FOUNT_DIR/data") {
		Invoke-DockerPassthrough -CurrentArgs $args
		Test-Browser
		Start-Process 'https://steve02081504.github.io/fount/wait'
		$runargs = $args[1..$args.Count]
		fount.ps1 @runargs
		exit $LastExitCode
	}
	else {
		$statusServerScriptBlock = {
			$listener = [System.Net.HttpListener]::new()
			$listener.Prefixes.Add("http://localhost:8930/")
			$listener.Start()

			try {
				while ($true) {
					$response = $listener.GetContext().Response
					$response.AddHeader("Access-Control-Allow-Origin", "*")
					$buffer = [System.Text.Encoding]::UTF8.GetBytes('{"message":"pong"}')
					$response.ContentType = "application/json"
					$response.ContentLength64 = $buffer.Length
					$response.OutputStream.Write($buffer, 0, $buffer.Length)
					$response.Close()
				}
			}
			finally {
				$listener.Stop()
				$listener.Close()
			}
		}
		$statusServerJob = Start-Job -ScriptBlock $statusServerScriptBlock
		try {
			$runargs = $args[1..$args.Count]
			Test-Browser
			Start-Process 'https://steve02081504.github.io/fount/wait/install'
			fount.ps1 @runargs
			exit $LastExitCode
		}
		finally {
			Stop-Job $statusServerJob
			Remove-Job $statusServerJob
		}
		exit 1
	}
}
elseif ($args.Count -gt 0 -and $args[0] -eq 'background') {
	Invoke-DockerPassthrough -CurrentArgs $args
	$runargs = $args[1..$args.Count]
	if (Test-Path -Path "$FOUNT_DIR/.nobackground") {
		$TargetPath = "powershell.exe"
		$runargs = $runargs | ForEach-Object { ($_ -replace '\', '\\') -replace '"', '\"' }
		$Arguments = "-noprofile -nologo -ExecutionPolicy Bypass -File `"$FOUNT_DIR\path\fount.ps1`" `"$($runargs -join '" "')`""
		if (Test-Path "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe") {
			$TargetPath = "$env:LOCALAPPDATA/Microsoft/WindowsApps/wt.exe"
			$Arguments = "-p fount powershell.exe $Arguments"
		}
		Start-Process -FilePath $TargetPath -ArgumentList $Arguments
	}
	else {
		Test-PWSHModule ps12exe
		$TempDir = [System.IO.Path]::GetTempPath()
		$exepath = Join-Path $TempDir "fount-background.exe"
		if (!(Test-Path $exepath)) {
			ps12exe -inputFile "$FOUNT_DIR/src/runner/background.ps1" -outputFile $exepath
		}
		Start-Process -FilePath $exepath -ArgumentList $runargs
	}
	exit 0
}
elseif ($args.Count -gt 0 -and $args[0] -eq 'protocolhandle') {
	Invoke-DockerPassthrough -CurrentArgs $args
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
		Test-Browser
		while (-not (Test-FountRunning)) {
			Start-Sleep -Seconds 1
		}
		Start-Process $targetUrl
	} -ArgumentList $targetUrl
	$runargs = $args[2..$args.Count]
	fount.ps1 @runargs
	exit $LastExitCode
}

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

# 新建一个背景job用于后台更新所需的pwsh模块
Start-Job -ScriptBlock {
	@('ps12exe', 'fount-pwsh') | ForEach-Object {
		# 先获取本地模块的版本号，若是0.0.0则跳过更新（开发版本）
		$localVersion = [System.Version]::new(0, 0, 0)
		Get-Module $_ -ListAvailable | ForEach-Object { if ($_.Version -gt $localVersion) { $localVersion = $_.Version } }
		if ("$localVersion" -eq '0.0.0') { return }
		$latestVersion = (Find-Module $_).Version
		if ("$latestVersion" -ne "$localVersion") {
			if (!(Get-Module $_ -ListAvailable)) {
				$auto_installed_pwsh_modules += $_
				New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
				Set-Content "$FOUNT_DIR/data/installer/auto_installed_pwsh_modules" $($auto_installed_pwsh_modules -join ';')
			}
			Get-PackageProvider -Name "NuGet" -Force | Out-Null
			Uninstall-Module -Name $_ -Scope CurrentUser -AllVersions -Force -ErrorAction Ignore
			Install-Module -Name $_ -Scope CurrentUser -Force
		}
	}
} | Out-Null

if (!$IsWindows) {
	function install_package {
		param(
			[string]$CommandName,
			[string[]]$PackageNames
		)
		if ((Get-Command -Name $CommandName -ErrorAction Ignore)) { return $true }

		$hasSudo = (Get-Command -Name "sudo" -ErrorAction Ignore)

		foreach ($package in $PackageNames) {
			if (Get-Command -Name "apt-get" -ErrorAction Ignore) {
				if ($hasSudo) { sudo apt-get update -y > $null; sudo apt-get install -y $package }
				else { apt-get update -y > $null; apt-get install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "pacman" -ErrorAction Ignore) {
				if ($hasSudo) { sudo pacman -Syy --noconfirm > $null; sudo pacman -S --needed --noconfirm $package }
				else { pacman -Syy --noconfirm > $null; pacman -S --needed --noconfirm $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "dnf" -ErrorAction Ignore) {
				if ($hasSudo) { sudo dnf install -y $package } else { dnf install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "yum" -ErrorAction Ignore) {
				if ($hasSudo) { sudo yum install -y $package } else { yum install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "zypper" -ErrorAction Ignore) {
				if ($hasSudo) { sudo zypper install -y --no-confirm $package } else { zypper install -y --no-confirm $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "apk" -ErrorAction Ignore) {
				if ($hasSudo) { sudo apk add --update $package } else { apk add --update $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "brew" -ErrorAction Ignore) {
				if (-not (brew list --formula $package -ErrorAction Ignore)) {
					brew install $package
				}
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "pkg" -ErrorAction Ignore) {
				if ($hasSudo) { sudo pkg install -y $package } else { pkg install -y $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
			if (Get-Command -Name "snap" -ErrorAction Ignore) {
				if ($hasSudo) { sudo snap install $package } else { snap install $package }
				if (Get-Command -Name $CommandName -ErrorAction Ignore) { break }
			}
		}

		if (Get-Command -Name $CommandName -ErrorAction Ignore) {
			$currentPackages = $env:FOUNT_AUTO_INSTALLED_PACKAGES -split ';' | Where-Object { $_ }
			if ($package -notin $currentPackages) {
				$env:FOUNT_AUTO_INSTALLED_PACKAGES = ($currentPackages + $package) -join ';'
			}
			return $true
		}
		else {
			Write-Error "Error: $package installation failed."
			return $false
		}
	}
	install_package "bash" @("bash", "gnu-bash")
	bash $FOUNT_DIR/path/fount.sh @args
	exit $LastExitCode
}

# Git 安装和更新
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
	Write-Host (Get-I18n -key 'git.notInstalled')
	Test-Winget
	if (Get-Command winget -ErrorAction SilentlyContinue) {
		winget install --id Git.Git -e --source winget
		New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
		Set-Content "$FOUNT_DIR/data/installer/auto_installed_git" '1'
	}
	else {
		Write-Host (Get-I18n -key 'git.installFailedWinget')
	}
	RefreshPath
	if (!(Get-Command git -ErrorAction SilentlyContinue)) {
		Write-Host (Get-I18n -key 'git.installFailedManual')
	}
}

function fount_upgrade {
	if (!(Get-Command git -ErrorAction SilentlyContinue)) {
		Write-Host (Get-I18n -key 'git.notInstalledSkippingPull')
		return
	}
	if ($FOUNT_DIR -in $(git config --global --get-all safe.directory)) {} else {
		git config --global --add safe.directory "$FOUNT_DIR"
	}
	if (!(Test-Path -Path "$FOUNT_DIR/.git")) {
		Write-Host (Get-I18n -key 'git.repoNotFound')
		git -C "$FOUNT_DIR" init -b master
		git -C "$FOUNT_DIR" config core.autocrlf false
		git -C "$FOUNT_DIR" remote add origin https://github.com/steve02081504/fount.git
		Write-Host (Get-I18n -key 'git.fetchingAndResetting')
		git -C "$FOUNT_DIR" fetch origin master --depth 1
		if ($LastExitCode) { Write-Error (Get-I18n -key 'git.fetchFailed'); return }
		$diffOutput = git -C "$FOUNT_DIR" diff "origin/master"
		if ($diffOutput) {
			Write-Host (Get-I18n -key 'git.localChangesDetected') -ForegroundColor Yellow
			$timestamp = (Get-Date -Format 'yyyyMMdd_HHmmss')
			$diffFileName = "fount-local-changes-diff_$timestamp.diff"
			$diffFilePath = Join-Path -Path $env:TEMP -ChildPath $diffFileName
			$diffOutput | Out-File -FilePath $diffFilePath -Encoding utf8
			Write-Host (Get-I18n -key 'git.backupSavedTo' -params @{path = '' }) -ForegroundColor Green -NoNewline
			Write-Host $diffFilePath -ForegroundColor Cyan
		}
		git -C "$FOUNT_DIR" clean -fd
		git -C "$FOUNT_DIR" reset --hard "origin/master"
	}

	if (!(Test-Path -Path "$FOUNT_DIR/.git")) {
		Write-Host (Get-I18n -key 'git.repoNotFoundSkippingPull')
	}
	else {
		git -C "$FOUNT_DIR" config core.autocrlf false
		git -C "$FOUNT_DIR" fetch origin
		$currentBranch = git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD
		if ($currentBranch -eq 'HEAD') {
			Write-Host (Get-I18n -key 'git.notOnBranch')
			git -C "$FOUNT_DIR" clean -fd
			git -C "$FOUNT_DIR" reset --hard "origin/master"
			git -C "$FOUNT_DIR" checkout master
			$currentBranch = git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD
		}
		$remoteBranch = git -C "$FOUNT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
		if (-not $remoteBranch) {
			Write-Warning (Get-I18n -key 'git.noUpstreamBranch' -params @{branch = $currentBranch })
			git -C "$FOUNT_DIR" branch --set-upstream-to origin/master
			$remoteBranch = "origin/master"
		}
		$mergeBase = git -C "$FOUNT_DIR" merge-base $currentBranch $remoteBranch
		$localCommit = git -C "$FOUNT_DIR" rev-parse $currentBranch
		$remoteCommit = git -C "$FOUNT_DIR" rev-parse $remoteBranch
		$status = git -C "$FOUNT_DIR" status --porcelain
		if ($status) {
			Write-Warning (Get-I18n -key 'git.dirtyWorkingDirectory')
		}

		if ($localCommit -ne $remoteCommit) {
			if ($mergeBase -eq $localCommit) {
				Write-Host (Get-I18n -key 'git.updatingFromRemote')
				git -C "$FOUNT_DIR" fetch origin
				git -C "$FOUNT_DIR" reset --hard $remoteBranch
			}
			elseif ($mergeBase -eq $remoteCommit) {
				Write-Host (Get-I18n -key 'git.localBranchAhead')
			}
			else {
				Write-Host (Get-I18n -key 'git.branchesDiverged')
				git -C "$FOUNT_DIR" fetch origin
				git -C "$FOUNT_DIR" reset --hard $remoteBranch
			}
		}
		else {
			Write-Host (Get-I18n -key 'git.alreadyUpToDate')
		}
	}
}


# Deno 安装
if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
	if (Test-Path "$HOME/.deno/bin/deno.exe") {
		$env:PATH = $env:PATH + ";$HOME/.deno/bin"
		[System.Environment]::SetEnvironmentVariable("PATH", [System.Environment]::GetEnvironmentVariable("PATH", "User") + ";$HOME/.deno/bin", [System.EnvironmentVariableTarget]::User)
	}
}
if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
	Write-Host (Get-I18n -key 'deno.missing')
	Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		RefreshPath
	}
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		Write-Host (Get-I18n -key 'deno.installFailedFallback')
		$url = "https://github.com/denoland/deno/releases/latest/download/deno-" + $(if ($IsWindows) {
				"x86_64-pc-windows-msvc.zip"
			}
			elseif ($IsMacOS) {
				if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
					"aarch64-apple-darwin.zip"
				}
				else {
					"x86_64-apple-darwin.zip"
				}
			}
			else {
				"x86_64-unknown-linux-gnu.zip"
			})
		Invoke-WebRequest -Uri $url -OutFile "$env:TEMP/deno.zip"
		Expand-Archive -Path "$env:TEMP/deno.zip" -DestinationPath "$FOUNT_DIR/path"
		Remove-Item -Path "$env:TEMP/deno.zip" -Force
	}
	New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
	Set-Content "$FOUNT_DIR/data/installer/auto_installed_deno" '1'
	if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
		Write-Host (Get-I18n -key 'deno.isRequired')
		exit 1
	}
}

if ($args.Count -eq 0 -or $args[0] -ne 'shutdown') {
	Update-FountAndDeno
}
if ($args.Count -eq 0 -or ($args[0] -ne 'shutdown' -and $args[0] -ne 'geneexe')) {
	if ($IN_DOCKER) {
		Write-Host "Skipping deno upgrade in Docker environment"
	}
	else {
		deno_upgrade
	}

	deno -V
}

# 执行 fount
$v8Flags = "--expose-gc"
$heapSizeMB = 300 # Default to 300MB
$configPath = Join-Path $FOUNT_DIR 'data/config.json'
if (Test-Path $configPath) {
	try {
		$fountConfig = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
		$heapSizeBytes = $fountConfig.prelaunch.heapSize
		$calculatedMB = [math]::Round($heapSizeBytes / 1024 / 1024)
		if ($calculatedMB -gt 0) {
			$heapSizeMB = $calculatedMB
		}
	} catch {
		# Could not read or parse, will use the default 300MB.
	}
}
$v8Flags += ",--initial-heap-size=${heapSizeMB}m"
function isRoot {
	if ($IsWindows) {
		([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
	}
	else {
		$UID -eq 0
	}
}
$Script:is_debug = $false
function debug_on {
	$Script:is_debug = $true
	if (Get-Command chrome -ErrorAction Ignore) {
		$originalClipboard = Get-Clipboard
		Set-Clipboard -Value "chrome://inspect"
		Start-Process "chrome.exe" "--new-window"
		Add-Type -AssemblyName System.Windows.Forms
		Start-Sleep -Seconds 2
		[System.Windows.Forms.SendKeys]::SendWait("^{l}")
		[System.Windows.Forms.SendKeys]::SendWait("^{v}")
		[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
		Set-Clipboard -Value $originalClipboard
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
	if ($Script:is_debug) {
		deno run --allow-scripts --allow-all --inspect-brk -c "$FOUNT_DIR/deno.json" --v8-flags="$v8Flags" "$FOUNT_DIR/src/server/index.mjs" @args
	}
	else {
		deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" --v8-flags="$v8Flags" "$FOUNT_DIR/src/server/index.mjs" @args
	}
}

# 安装依赖
if (!(Test-Path -Path "$FOUNT_DIR/node_modules") -or ($args.Count -gt 0 -and $args[0] -eq 'init')) {
	if (!(Test-Path -Path "$FOUNT_DIR/.noupdate")) {
		if (Get-Command git -ErrorAction Ignore) {
			git -C "$FOUNT_DIR" config core.autocrlf false
			git -C "$FOUNT_DIR" clean -fd
			git -C "$FOUNT_DIR" reset --hard "origin/master"
			git -C "$FOUNT_DIR" gc --aggressive --prune=now --force
		}
	}
	if (Test-Path -Path "$FOUNT_DIR/node_modules") {
		run shutdown
	}
	New-Item -Path "$FOUNT_DIR/node_modules" -ItemType Directory -ErrorAction Ignore -Force | Out-Null
	Write-Host (Get-I18n -key 'install.installingDependencies')
	deno install --reload --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" --entrypoint "$FOUNT_DIR/src/server/index.mjs"
	Write-Host "======================================================" -ForegroundColor Green
	Write-Warning (Get-I18n -key 'install.untrustedPartsWarning')
	Write-Host "======================================================" -ForegroundColor Green

	# 隐藏文件设置和desktop.ini生效
	if ((Test-Path "$FOUNT_DIR/.git") -and (-not (Test-Path "$FOUNT_DIR/.git/desktop.ini"))) {
		Copy-Item "$FOUNT_DIR/default/git_desktop.ini" "$FOUNT_DIR/.git/desktop.ini" -Force
	}
	New-InstallerDir # For data/desktop.ini
	if (-not (Test-Path "$FOUNT_DIR/data/desktop.ini")) {
		Copy-Item "$FOUNT_DIR/default/default_desktop.ini" "$FOUNT_DIR/data/desktop.ini" -Force
	}
	if (-not (Test-Path "$FOUNT_DIR/node_modules/desktop.ini")) {
		Copy-Item "$FOUNT_DIR/default/node_modules_desktop.ini" "$FOUNT_DIR/node_modules/desktop.ini" -Force
	}
	Set-FountFileAttributes

	# 生成 桌面快捷方式 和 Start Menu 快捷方式
	New-FountShortcut

	# fount 协议注册
	Register-FountProtocol

	# fount Terminal注册
	Register-FountTerminalProfile
	Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class ExplorerRefresher {
	[DllImport("user32.dll", SetLastError = true)]
	private static extern IntPtr SendMessageTimeout(IntPtr hWnd, int Msg, IntPtr wParam, string lParam, uint fuFlags, uint uTimeout, IntPtr lpdwResult);

	private static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);
	private const int WM_SETTINGCHANGE = 0x1a;
	private const int SMTO_ABORTIFHUNG = 0x0002;
	public static void RefreshSettings() {
		SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, IntPtr.Zero, null, SMTO_ABORTIFHUNG, 100, IntPtr.Zero);
	}
	[DllImport("shell32.dll")]
	private static extern int SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);
	public static void RefreshDesktop() {
		SHChangeNotify(0x8000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
	}
}
'@ -ErrorAction Ignore
	try {
		[ExplorerRefresher]::RefreshSettings()
		[ExplorerRefresher]::RefreshDesktop()
	}
	catch {
		Write-Warning "Failed to refresh explorer: $($_.Exception.Message)"
	}
}

if ($args.Count -gt 0 -and $args[0] -eq 'clean') {
	if (Test-Path -Path "$FOUNT_DIR/node_modules") {
		run shutdown
		Write-Host (Get-I18n -key 'clean.removingCaches')
		Remove-Item -Force -Recurse -ErrorAction Ignore "$FOUNT_DIR/node_modules"
		if ($args[1] -eq 'force') {
			Get-ChildItem -Path "$FOUNT_DIR" -Filter "*_cache.json" -Recurse | Remove-Item -Force -ErrorAction Ignore
		}
	}
	Write-Host (Get-I18n -key 'clean.reinstallingDependencies')
	run shutdown
	Write-Host (Get-I18n -key 'clean.cleaningDenoCaches')
	deno clean
	Write-Host (Get-I18n -key 'clean.cleaningOldPwshModules')
	$Latest = Get-InstalledModule -Name @('ps12exe', 'fount-pwsh') -ErrorAction Ignore
	foreach ($module in $Latest) {
		Get-InstalledModule -Name $module.Name -AllVersions | Where-Object { $_.Version -ne $module.Version } | Uninstall-Module
	}
	if (-not (Test-Path "$FOUNT_DIR/node_modules/desktop.ini")) {
		Copy-Item "$FOUNT_DIR/default/node_modules_desktop.ini" "$FOUNT_DIR/node_modules/desktop.ini" -Force
	}
	Set-FountFileAttributes
}
elseif ($args.Count -gt 0 -and $args[0] -eq 'geneexe') {
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
	if ($runargs.Count -gt 0 -and $runargs[0] -eq 'debug') {
		$runargs = $runargs[1..$runargs.Count]
		debug_on
	}

	$startTime = Get-Date
	$initAttempted = $false
	$restart_timestamps = New-Object System.Collections.Generic.List[datetime]

	run @runargs
	while ($LastExitCode) {
		if ($LastExitCode -ne 131) {
			$elapsedTime = (Get-Date) - $startTime
			if ($elapsedTime.TotalMinutes -lt 3 -and $initAttempted) {
				Write-Error (Get-I18n -key 'keepalive.failedToStart')
				exit 1
			} else { $initAttempted = $false }

			$current_time = Get-Date
			$restart_timestamps.Add($current_time)

			$three_minutes_ago = $current_time.AddMinutes(-3)
			for ($i = $restart_timestamps.Count - 1; $i -ge 0; $i--) {
				if ($restart_timestamps[$i] -lt $three_minutes_ago) {
					$restart_timestamps.RemoveAt($i)
				}
			}

			if ($restart_timestamps.Count -ge 7) {
				if (Test-Path -Path "$FOUNT_DIR/.noautoinit") {
					Write-Warning (Get-I18n -key 'keepalive.autoInitDisabled')
					exit 1
				}
				Write-Warning (Get-I18n -key 'keepalive.restartingTooFast')
				$restart_timestamps.Clear()

				& $PSScriptRoot/fount.ps1 init
				if ($LastExitCode -ne 0) {
					Write-Error (Get-I18n -key 'keepalive.initFailed')
					exit 1
				}
				$initAttempted = $true
				Write-Host (Get-I18n -key 'keepalive.initComplete')
			}
		}
		Update-FountAndDeno
		run
	}
}
elseif ($args.Count -gt 0 -and $args[0] -eq 'remove') {
	run shutdown
	deno clean
	Write-Host (Get-I18n -key 'remove.removingFount')

	# Remove fount from PATH
	Write-Host (Get-I18n -key 'remove.removingFountFromPath')
	$path = $env:PATH -split ';'
	$path = $path | Where-Object { !$_.StartsWith("$FOUNT_DIR") }
	$env:Path = $path -join ';'
	$UserPath = [System.Environment]::GetEnvironmentVariable('PATH', [System.EnvironmentVariableTarget]::User)
	$UserPath = $UserPath -split ';'
	$UserPath = $UserPath | Where-Object { !$_.StartsWith("$FOUNT_DIR") }
	$UserPath = $UserPath -join ';'
	[System.Environment]::SetEnvironmentVariable('PATH', $UserPath, [System.EnvironmentVariableTarget]::User)

	# Remove fount from git safe.directory
	Write-Host (Get-I18n -key 'remove.removingFountFromGitSafeDir')
	if ((Get-Command git -ErrorAction Ignore) -and ($FOUNT_DIR -in $(git config --global --get-all safe.directory))) {
		git config --global --unset safe.directory "$FOUNT_DIR"
	}

	# Remove fount-pwsh from PowerShell Profile
	Write-Host (Get-I18n -key 'remove.removingFountPwshFromProfile')
	if (Test-Path $Profile) {
		$ProfileContent = Get-Content $Profile -ErrorAction Ignore
		$ProfileContent = $ProfileContent -split "`n"
		$ProfileContent = $ProfileContent | Where-Object { $_ -notmatch 'Import-Module fount-pwsh' }
		$ProfileContent = $ProfileContent -join "`n"
		if ($ProfileContent -ne ((Get-Content $Profile -ErrorAction Ignore) -split "`n" -join "`n")) {
			Set-Content -Path $Profile -Value $ProfileContent
		}
		Write-Host (Get-I18n -key 'remove.fountPwshRemovedFromProfile')
	}
	else {
		Write-Host (Get-I18n -key 'remove.pwshProfileNotFound')
	}

	# Uninstall fount-pwsh
	Write-Host (Get-I18n -key 'remove.uninstallingFountPwsh')
	try { Uninstall-Module -Name fount-pwsh -Scope CurrentUser -Force -ErrorAction Stop } catch {
		Write-Warning (Get-I18n -key 'remove.uninstallFountPwshFailed' -params @{message = $_.Exception.Message })
	}

	# Remove fount protocol handler
	if (-not $IN_DOCKER) {
		Write-Host (Get-I18n -key 'remove.removingProtocolHandler')
		try {
			# 静默删除注册表键及其所有子键
			Remove-Item -Path "HKCU:\Software\Classes\fount" -Recurse -Force -ErrorAction SilentlyContinue
			Write-Host (Get-I18n -key 'remove.protocolHandlerRemoved')
		}
		catch {
			Write-Warning (Get-I18n -key 'remove.removeProtocolHandlerFailed' -params @{message = $_.Exception.Message })
		}
	}

	# Remove Windows Terminal Profile
	Write-Host (Get-I18n -key 'remove.removingTerminalProfile')
	$WTjsonDirPath = "$env:LOCALAPPDATA/Microsoft/Windows Terminal/Fragments/fount"
	if (Test-Path $WTjsonDirPath -PathType Container) {
		Remove-Item -Path $WTjsonDirPath -Force -Recurse
		Write-Host (Get-I18n -key 'remove.terminalProfileRemoved')
	}
	else {
		Write-Host (Get-I18n -key 'remove.terminalProfileNotFound')
	}

	# Remove Desktop Shortcut
	Write-Host (Get-I18n -key 'remove.removingDesktopShortcut')
	$desktopShortcutPath = [Environment]::GetFolderPath("Desktop") + "\fount.lnk"
	if (Test-Path $desktopShortcutPath) {
		Remove-Item -Path $desktopShortcutPath -Force
		Write-Host (Get-I18n -key 'remove.desktopShortcutRemoved')
	}
	else {
		Write-Host (Get-I18n -key 'remove.desktopShortcutNotFound')
	}

	# Remove Start Menu Shortcut
	Write-Host (Get-I18n -key 'remove.removingStartMenuShortcut')
	$startMenuShortcutPath = [Environment]::GetFolderPath("StartMenu") + "\fount.lnk"
	if (Test-Path $startMenuShortcutPath) {
		Remove-Item -Path $startMenuShortcutPath -Force
		Write-Host (Get-I18n -key 'remove.startMenuShortcutRemoved')
	}
	else {
		Write-Host (Get-I18n -key 'remove.startMenuShortcutNotFound')
	}

	# Remove Installed pwsh modules
	Write-Host (Get-I18n -key 'remove.removingInstalledPwshModules')
	$auto_installed_pwsh_modules | ForEach-Object {
		try {
			if (Get-Module $_ -ListAvailable) {
				Uninstall-Module -Name $_ -Scope CurrentUser -AllVersions -Force -ErrorAction Stop
				Write-Host (Get-I18n -key 'remove.moduleRemoved' -params @{module = $_ })
			}
		}
		catch {
			Write-Warning (Get-I18n -key 'remove.removeModuleFailed' -params @{module = $_; message = $_.Exception.Message })
		}
	}

	if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_git") {
		Write-Host (Get-I18n -key 'remove.uninstallingGit')
		winget uninstall --id Git.Git -e --source winget
	}

	if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_chrome") {
		Write-Host (Get-I18n -key 'remove.uninstallingChrome')
		winget uninstall --id Google.Chrome -e --source winget
	}

	if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_winget") {
		Write-Host (Get-I18n -key 'remove.uninstallingWinget')
		Import-Module Appx
		Remove-AppxPackage -Package Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
	}

	if (Test-Path "$FOUNT_DIR/data/installer/auto_installed_deno") {
		Write-Host (Get-I18n -key 'remove.uninstallingDeno')
		try { Remove-Item $(Get-Command deno).Source -Force } catch {
			Write-Warning (Get-I18n -key 'remove.removeDenoFailed' -params @{message = $_.Exception.Message })
		}
		Remove-Item "~/.deno" -Force -Recurse -ErrorAction Ignore

		$UserPath = [System.Environment]::GetEnvironmentVariable('PATH', [System.EnvironmentVariableTarget]::User)
		$UserPath = $UserPath -split ';'
		$UserPath = $UserPath | Where-Object { !$_.Contains("/.deno") }
		$UserPath = $UserPath -join ';'
		[System.Environment]::SetEnvironmentVariable('PATH', $UserPath, [System.EnvironmentVariableTarget]::User)
	}

	# Remove background runner
	$TempDir = [System.IO.Path]::GetTempPath()
	$exepath = Join-Path $TempDir "fount-background.exe"
	if (Test-Path $exepath) {
		Write-Host (Get-I18n -key 'remove.removingBackgroundRunner')
		try { Remove-Item $exepath -Force -ErrorAction Stop } catch {
			Write-Warning (Get-I18n -key 'remove.removeBackgroundRunnerFailed' -params @{message = $_.Exception.Message })
		}
	}

	# Remove fount installation directory
	Write-Host (Get-I18n -key 'remove.removingFountInstallationDir')
	Remove-Item -Path $FOUNT_DIR -Recurse -Force -ErrorAction SilentlyContinue
	# 只要父目录为空，继续删他妈的
	$parent = Split-Path -Parent $FOUNT_DIR
	while ((Get-ChildItem $parent -ErrorAction Ignore | Measure-Object).Count -eq 0) {
		Remove-Item -Path $parent -Recurse -Force -ErrorAction SilentlyContinue
	}
	Write-Host (Get-I18n -key 'remove.fountInstallationDirRemoved')

	Write-Host (Get-I18n -key 'remove.fountUninstallationComplete')
	exit 0
}
else {
	$runargs = $args
	if ($runargs.Count -gt 0 -and $runargs[0] -eq 'debug') {
		$runargs = $runargs[1..$runargs.Count]
		debug_on
	}
	run @runargs
	while ($LastExitCode -eq 131) {
		Update-FountAndDeno
		run
	}
}

if ($ErrorCount -ne $Error.Count) { exit 1 }
exit $LastExitCode
