# REPL 所需终端按键。Shift+Enter 在终端层与裸 Enter 同码（都发 CR），必须重映射为 CSI+u 才能区分。
$script:FountTerminalKeyPatches = @(
	@{
		Id        = 'fount.sendInput.shiftEnter'
		Keys      = 'shift+enter'
		InputJson = '\u001b[13;2u'
	}
)

$script:FountEditorTerminalKeyPatches = @(
	@{
		Key  = 'shift+enter'
		Text = "$([char]27)[13;2u"
	}
)

function Get-FountTerminalKeybindingsManifestPath {
	Join-Path $FOUNT_DIR 'data/installer/terminal_keybindings.json'
}

function Write-FountUtf8NoBom([string]$Path, [string]$Content) {
	$utf8 = New-Object System.Text.UTF8Encoding $false
	[System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Get-FountWindowsTerminalSettingsPaths {
	$paths = [System.Collections.Generic.List[string]]::new()
	$localAppData = $env:LOCALAPPDATA
	if (-not $localAppData) { return @() }
	$packagesDir = Join-Path $localAppData 'Packages'
	if (Test-Path $packagesDir) {
		Get-ChildItem $packagesDir -Directory -Filter 'Microsoft.WindowsTerminal*_8wekyb3d8bbwe' -ErrorAction SilentlyContinue |
			ForEach-Object {
				$candidate = Join-Path $_.FullName 'LocalState\settings.json'
				if (Test-Path $candidate) { $paths.Add($candidate) }
			}
	}
	$unpackaged = Join-Path $localAppData 'Microsoft\Windows Terminal\settings.json'
	if (Test-Path $unpackaged) { $paths.Add($unpackaged) }
	return $paths | Select-Object -Unique
}

function Get-FountEditorKeybindingsPaths {
	$paths = [System.Collections.Generic.List[string]]::new()
	if ($env:APPDATA) {
		foreach ($editor in @('Cursor', 'Code', 'VSCodium')) {
			$userDir = Join-Path $env:APPDATA "$editor/User"
			if (Test-Path $userDir) {
				$paths.Add((Join-Path $userDir 'keybindings.json'))
			}
		}
	}
	return $paths | Select-Object -Unique
}

function Test-FountIsFountPatchEntry($Entry) {
	$Entry.PSObject.Properties['isfountPatch'] -and $Entry.isfountPatch -eq $true
}

function Remove-FountWtJsonBlocks([string]$Raw, [string]$Id) {
	$escaped = [regex]::Escape($Id)
	$actionPat = '(?ms)\s*\{\s*"command"\s*:\s*\{(?:[^{}]|\{[^{}]*\})*\}\s*,\s*"id"\s*:\s*"' + $escaped + '"\s*\},?\s*'
	$kbPatIdFirst = '(?ms)\s*\{\s*"id"\s*:\s*"' + $escaped + '"\s*,\s*"keys"\s*:\s*"[^"]*"\s*\},?\s*'
	$kbPatKeysFirst = '(?ms)\s*\{\s*"keys"\s*:\s*"[^"]*"\s*,\s*"id"\s*:\s*"' + $escaped + '"\s*\},?\s*'
	$Raw -replace $actionPat, "`n" -replace $kbPatIdFirst, "`n" -replace $kbPatKeysFirst, "`n"
}

function Merge-FountWindowsTerminalSettings([string]$SettingsPath) {
	if (-not (Test-Path $SettingsPath)) { return $false }
	try {
		$raw = Get-Content $SettingsPath -Raw -Encoding UTF8
	}
	catch {
		Write-Warning (Get-I18n -key 'terminalKeybindings.wtPatchFailed' -params @{ path = $SettingsPath; message = $_.Exception.Message })
		return $false
	}

	if ($raw -notmatch '"actions"\s*:') {
		Write-Warning (Get-I18n -key 'terminalKeybindings.wtPatchFailed' -params @{ path = $SettingsPath; message = 'missing actions array' })
		return $false
	}

	$changed = $false
	foreach ($patch in $script:FountTerminalKeyPatches) {
		$before = $raw
		$raw = Remove-FountWtJsonBlocks $raw $patch.Id
		# InputJson 为 WT 字面量 \u001b…；用 %% 占位符注入，避免 -f/双引号把 [13;2u] 吃掉。
		$actionTpl = @'
        {
            "command": {
                "action": "sendInput",
                "input": "%%INPUT%%"
            },
            "id": "%%ID%%"
        },
'@
		$kbTpl = @'
        {
            "id": "%%ID%%",
            "keys": "%%KEYS%%"
        },
'@
		$actionBlock = $actionTpl.Replace('%%INPUT%%', $patch.InputJson).Replace('%%ID%%', $patch.Id)
		$kbBlock = $kbTpl.Replace('%%ID%%', $patch.Id).Replace('%%KEYS%%', $patch.Keys)
		if ($raw -match '"keybindings"\s*:\s*\[') {
			$raw = $raw -replace '("keybindings"\s*:\s*\[)', "`${1}`n$kbBlock"
		}
		else {
			$raw = $raw -replace '("actions"\s*:\s*\[[^\]]*\])', "`$1,`n    `"keybindings`": [`n$kbBlock`n    ]"
		}
		$raw = $raw -replace '("actions"\s*:\s*\[)', "`${1}`n$actionBlock"
		if ($before -ne $raw) { $changed = $true }
	}

	if (-not $changed) { return $true }
	Write-FountUtf8NoBom $SettingsPath $raw
	return $true
}

function Split-FountWindowsTerminalSettings([string]$SettingsPath) {
	if (-not (Test-Path $SettingsPath)) { return $false }
	try { $raw = Get-Content $SettingsPath -Raw -Encoding UTF8 }
	catch { return $false }

	$before = $raw
	foreach ($patch in $script:FountTerminalKeyPatches) {
		$raw = Remove-FountWtJsonBlocks $raw $patch.Id
	}
	if ($before -eq $raw) { return $true }
	Write-FountUtf8NoBom $SettingsPath $raw
	return $true
}

function Read-FountEditorKeybindings([string]$Path) {
	if (-not (Test-Path $Path)) { return @() }
	try {
		$parsed = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 20
	}
	catch { return @() }
	if ($parsed -is [System.Array]) { return $parsed }
	if ($parsed.PSObject.Properties['keybindings']) { return @($parsed.keybindings) }
	return @()
}

function Merge-FountEditorKeybindings([string]$KeybindingsPath) {
	$entries = [System.Collections.Generic.List[object]]::new()
	Read-FountEditorKeybindings $KeybindingsPath | ForEach-Object { $entries.Add($_) }

	$changed = $false
	for ($i = $entries.Count - 1; $i -ge 0; $i--) {
		if (Test-FountIsFountPatchEntry $entries[$i]) {
			$entries.RemoveAt($i); $changed = $true
		}
	}

	foreach ($patch in $script:FountEditorTerminalKeyPatches) {
		$entries.Add([ordered]@{
				key          = $patch.Key
				command      = 'workbench.action.terminal.sendSequence'
				args         = [ordered]@{ text = $patch.Text }
				when         = 'terminalFocus'
				isfountPatch = $true
			})
		$changed = $true
	}

	if (-not $changed) { return $true }
	$parent = Split-Path $KeybindingsPath -Parent
	if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
	Write-FountUtf8NoBom $KeybindingsPath ("[$([string]::Join(',' + [Environment]::NewLine, ($entries | ForEach-Object { $_ | ConvertTo-Json -Depth 10 -Compress })))$(if ($entries.Count) { [Environment]::NewLine })]")
	return $true
}

function Split-FountEditorKeybindings([string]$KeybindingsPath) {
	if (-not (Test-Path $KeybindingsPath)) { return $false }
	$entries = [System.Collections.Generic.List[object]]::new()
	Read-FountEditorKeybindings $KeybindingsPath | ForEach-Object { $entries.Add($_) }
	$changed = $false
	for ($i = $entries.Count - 1; $i -ge 0; $i--) {
		if (Test-FountIsFountPatchEntry $entries[$i]) {
			$entries.RemoveAt($i); $changed = $true
		}
	}
	if (-not $changed) { return $true }
	if ($entries.Count -eq 0) {
		Remove-Item $KeybindingsPath -Force -ErrorAction SilentlyContinue
		return $true
	}
	Write-FountUtf8NoBom $KeybindingsPath ("[$([string]::Join(',' + [Environment]::NewLine, ($entries | ForEach-Object { $_ | ConvertTo-Json -Depth 10 -Compress })))$(if ($entries.Count) { [Environment]::NewLine })]")
	return $true
}

function Register-FountTerminalKeybindings {
	if (-not $IsWindows) { return }
	New-InstallerDir
	$manifest = [ordered]@{
		windowsTerminalSettings = @()
		editorKeybindings       = @()
	}
	$patched = $false

	foreach ($wtPath in Get-FountWindowsTerminalSettingsPaths) {
		if (Merge-FountWindowsTerminalSettings $wtPath) {
			$manifest.windowsTerminalSettings += $wtPath
			$patched = $true
		}
	}
	foreach ($kbPath in Get-FountEditorKeybindingsPaths) {
		if (Merge-FountEditorKeybindings $kbPath) {
			$manifest.editorKeybindings += $kbPath
			$patched = $true
		}
	}

	if ($patched) {
		Write-FountUtf8NoBom (Get-FountTerminalKeybindingsManifestPath) ($manifest | ConvertTo-Json -Depth 10)
		Write-Host (Get-I18n -key 'terminalKeybindings.registered')
	}
}

function Unregister-FountTerminalKeybindings {
	if (-not $IsWindows) { return }
	$manifestPath = Get-FountTerminalKeybindingsManifestPath
	$wtPaths = [System.Collections.Generic.List[string]]::new()
	$kbPaths = [System.Collections.Generic.List[string]]::new()

	if (Test-Path $manifestPath) {
		try {
			$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
			if ($manifest.windowsTerminalSettings) { $manifest.windowsTerminalSettings | ForEach-Object { $wtPaths.Add($_) } }
			if ($manifest.editorKeybindings) { $manifest.editorKeybindings | ForEach-Object { $kbPaths.Add($_) } }
		}
		catch { <# ignore #> }
	}

	Get-FountWindowsTerminalSettingsPaths | ForEach-Object { if ($wtPaths -notcontains $_) { $wtPaths.Add($_) } }
	Get-FountEditorKeybindingsPaths | ForEach-Object { if ($kbPaths -notcontains $_) { $kbPaths.Add($_) } }

	foreach ($wtPath in $wtPaths) {
		if (Split-FountWindowsTerminalSettings $wtPath) {
			Write-Host (Get-I18n -key 'terminalKeybindings.wtRemoved' -params @{ path = $wtPath })
		}
	}
	foreach ($kbPath in $kbPaths) {
		if (Split-FountEditorKeybindings $kbPath) {
			Write-Host (Get-I18n -key 'terminalKeybindings.editorRemoved' -params @{ path = $kbPath })
		}
	}

	Remove-Item $manifestPath -Force -ErrorAction SilentlyContinue
}
