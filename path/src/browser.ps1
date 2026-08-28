function script:Get-Browser {
	# 1. https 默认处理器（尊重用户选择）：UserChoice ProgId → 可执行路径。
	$candidates = @()
	try {
		$progId = (Get-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" -Name "ProgId" -ErrorAction Stop).'ProgId'
		if ($progId) {
			$command = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -Name "(default)" -ErrorAction Stop).'(default)'
			if ($command -match '"([^"]+\.exe)"') {
				$candidates += $Matches[1]
			}
			elseif ($command) {
				$candidates += ($command -split '\s+')[0].Trim('"')
			}
		}
	} catch { <# UserChoice 缺失/无默认浏览器时忽略 #> }
	# 2. 常见安装路径（Edge 优先——Windows 11 自带，即使默认处理器未登记也存在）。
	$candidates += @(
		"$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
		"${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
		"$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
		"$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
		"${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
		"$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
		"${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe"
		"$env:ProgramFiles\Mozilla Firefox\firefox.exe"
		"${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe"
	)
	foreach ($candidate in $candidates) {
		if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
			return $candidate
		}
	}
	# 3. PATH 上的浏览器命令。
	foreach ($name in @('msedge', 'chrome', 'chromium', 'brave', 'firefox')) {
		$command = Get-Command $name -ErrorAction SilentlyContinue
		if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
			return $command.Source
		}
	}
	return $null
}

function script:Test-Browser {
	if (Get-Browser) { return }
	try {
		Test-Winget
		winget install --id Google.Chrome -e --source winget
	} catch { <# ignore #> }
	if (!(Get-Browser)) {
		try {
			$ChromeSetup = "ChromeSetup.exe"
			Invoke-WebRequest -Uri 'https://dl.google.com/chrome/install/chrome_installer.exe' -OutFile "$env:TEMP\$ChromeSetup"
			$installer = Start-Process -FilePath "$env:TEMP\$ChromeSetup" -ArgumentList '/install' -PassThru
			do {
				Start-Sleep -Seconds 2
			} while (-not $installer.HasExited)
			Remove-Item "$env:TEMP\$ChromeSetup" -ErrorAction SilentlyContinue
		} catch { <# ignore #> }
	}

	if (Get-Browser) {
		RefreshPath
		try {
			New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$FOUNT_DIR/data/installer/auto_installed_chrome" '1'
		} catch { <# ignore #> }
	}
}

function script:Open-BrowserUrl([string]$Url) {
	$browser = Get-Browser
	if ($browser) {
		Start-Process -FilePath $browser -ArgumentList $Url -ErrorAction Stop
	}
	else {
		Start-Process $Url -ErrorAction Stop
	}
}
