# 向用户的$Profile中注册导入fount-pwsh
# 用 File IO 读写，避免 Get-Content/Set-Content 同文件流竞争导致 "Stream was not readable"
if ($Profile -and (Get-Module fount-pwsh -ListAvailable)) {
	$profileDir = Split-Path -Parent $Profile
	if ($profileDir -and -not (Test-Path -LiteralPath $profileDir)) {
		New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
	}
	$existing = if (Test-Path -LiteralPath $Profile) { [IO.File]::ReadAllText($Profile) } else { '' }
	$nl = if ($existing.Contains("`r`n")) { "`r`n" } else { "`n" }
	$stripped = [regex]::Replace($existing, '(?m)^\s*Import-Module\s+fount-pwsh\s*\r?\n?', '')
	$stripped = $stripped.TrimEnd("`r", "`n")
	$newContent = $(if ($stripped) { $stripped + $nl } else { '' }) + "Import-Module fount-pwsh$nl"
	if ($newContent -ne $existing) {
		[IO.File]::WriteAllText($Profile, $newContent)
	}
}
