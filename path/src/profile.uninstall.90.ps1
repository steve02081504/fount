# Remove fount from PATH
Write-Host (Get-I18n -key 'remove.removing.fount.fromPath')
$path = $env:PATH -split ';'
$path = $path | Where-Object { !$_.StartsWith("$FOUNT_DIR") }
$env:Path = $path -join ';'
$UserPath = [System.Environment]::GetEnvironmentVariable('PATH', [System.EnvironmentVariableTarget]::User)
$UserPath = $UserPath -split ';'
$UserPath = $UserPath | Where-Object { !$_.StartsWith("$FOUNT_DIR") }
$UserPath = $UserPath -join ';'
[System.Environment]::SetEnvironmentVariable('PATH', $UserPath, [System.EnvironmentVariableTarget]::User)

# Remove fount from git safe.directory
Write-Host (Get-I18n -key 'remove.removing.fount.fromGitSafeDir')
if ((Get-Command git -ErrorAction Ignore) -and ($FOUNT_DIR -in $(git config --global --get-all safe.directory))) {
	git config --global --unset safe.directory "$FOUNT_DIR"
}
Set-Title "𝓯𝓸𝓾"
Write-TaskbarProgress -Percent 25

# Remove fount-pwsh from PowerShell Profile
Write-Host (Get-I18n -key 'remove.removing.fount.pwshFromProfile')
if (Test-Path -LiteralPath $Profile) {
	$existing = [IO.File]::ReadAllText($Profile)
	$nl = if ($existing.Contains("`r`n")) { "`r`n" } else { "`n" }
	$newContent = [regex]::Replace($existing, '(?m)^\s*Import-Module\s+fount-pwsh\s*\r?\n?', '')
	$newContent = $newContent.TrimEnd("`r", "`n")
	if ($newContent) { $newContent += $nl }
	if ($newContent -ne $existing) {
		[IO.File]::WriteAllText($Profile, $newContent)
	}
	Write-Host (Get-I18n -key 'remove.fountPwshRemovedFromProfile')
}
else {
	Write-Host (Get-I18n -key 'remove.pwshProfileNotFound')
}
