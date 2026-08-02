function Set-MissingVariablesForWindowsPowershell {
	[System.Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidAssignmentToAutomaticVariable', '', Justification = 'all assignments to "automatic" variables are safe in this function')]
	param()
	if ($PSEdition -eq "Desktop") {
		try { $global:IsWindows = $true } catch {}
	}
}
Set-MissingVariablesForWindowsPowershell

Start-Job -ScriptBlock {
	param($FOUNT_DIR)
	if ((Get-Culture).Name -match '-(CN|KP|RU)$') {
		# 随手之劳之经验医学之clash的tun没开
		if ((Test-Connection "github.com", "cdn.jsdelivr.net" -Count 1 -Quiet -ErrorAction SilentlyContinue) -contains $false) {
			Invoke-RestMethod http://127.0.0.1:9090/configs -Method Patch -Body '{"tun":{"enable":true}}' -ErrorAction SilentlyContinue
			Invoke-RestMethod http://127.0.0.1:9097/configs -Method Patch -Body '{"tun":{"enable":true}}' -ErrorAction SilentlyContinue
		}
	}
} -ArgumentList $FOUNT_DIR | Out-Null

function Test-FountInDocker { $false }
function Test-FountInTermux { $false }
function Test-FountInContainer { (Test-FountInDocker) -or (Test-FountInTermux) }

# fount 路径设置
if (!(Get-Command fount.ps1 -ErrorAction SilentlyContinue)) {
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
