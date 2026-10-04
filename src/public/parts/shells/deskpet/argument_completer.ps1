# PowerShell 参数补全脚本，用于 fount 的 'deskpet' shell。
#
# 使用方法:
#   fount runas <username> shells/deskpet <action> [charname]
#
# 支持的 Action:
#   - list: 列出所有可用的角色。
#   - list-running: 列出所有正在运行的宠物。
#   - start <charname>: 启动一个桌面宠物。
#   - stop <charname>: 停止一个桌面宠物。
#
param(
	[string]$Username,
	[string]$WordToComplete,
	[System.Management.Automation.Language.CommandAst]$CommandAst,
	[int]$CursorPosition,
	[int]$runIndex,
	[int]$Argindex
)

try {
	$deskPetIndex = $runIndex + $(if ($CommandAst.CommandElements[$runIndex].Value -eq 'runas') { 2 } else { 1 })

	$actions = @("list", "list-running", "start", "stop")

	switch ($Argindex - ($deskPetIndex + 1)) {
		0 {
			# 补全 action
			$actions | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			$action = $CommandAst.CommandElements[$deskPetIndex + 1].Value
			switch ($action) {
				{ $_ -in "start", "stop" } {
					# 补全角色名称
					Get-FountPartList -PartPath chars -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
			}
			break
		}
	}
}
catch {
	Write-Host
	Write-Host "Error providing argument completion for deskpet: $_" -ForegroundColor Red
}
