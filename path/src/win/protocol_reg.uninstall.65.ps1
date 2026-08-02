# Remove fount protocol handler
if (-not (Test-FountInDocker)) {
	Write-Host (Get-I18n -key 'remove.removing.protocolHandler')
	try {
		# 静默删除注册表键及其所有子键
		Remove-Item -Path "HKCU:\Software\Classes\fount" -Recurse -Force -ErrorAction SilentlyContinue
		Write-Host (Get-I18n -key 'remove.protocolHandlerRemoved')
	}
	catch {
		Write-Warning (Get-I18n -key 'remove.remove.protocolHandlerFailed' -params @{message = $_.Exception.Message })
	}
}
