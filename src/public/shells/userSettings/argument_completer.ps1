# PowerShell 参数补全脚本，用于 fount 的 'userSettings' shell。
#
# 使用方法:
#   fount run shells <username> userSettings <action> [args...]
#
# 支持的 Action:
#   - get-stats: 获取用户统计信息。
#   - change-password <currentPassword> <newPassword>: 修改用户密码。
#   - list-devices: 列出所有已授权的设备/会话。
#   - revoke-device <tokenJti> <password>: 撤销一个设备的访问权限。
#   - rename-user <newUsername> <password>: 重命名用户。
#   - delete-account <password>: 删除当前用户账户。
#
# fount 自动提供的参数:
#   $Username:       执行命令的当前用户名。
#   $WordToComplete: 用户当前正在输入、需要补全的单词。
#   $CommandAst:     当前命令的抽象语法树 (AST)，用于分析命令结构。
#   $CursorPosition: 光标在整个命令行中的位置。
#   $runIndex:       'run' 命令在 CommandAst 中的索引，用于定位 shell 命令的起始位置。
#   $Argindex:       当前光标所在参数在 CommandAst 中的索引。
param(
	[string]$Username,
	[string]$WordToComplete,
	[System.Management.Automation.Language.CommandAst]$CommandAst,
	[int]$CursorPosition,
	[int]$runIndex,
	[int]$Argindex
)

try {
	# 从命令 AST 中提取 'run shells <username> userSettings' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$shellIndex = $runIndex + 3

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($shellIndex + 1)) {
		0 {
			# 位置 0: 补全第一个参数 (操作命令)。
			@("get-stats", "change-password", "list-devices", "revoke-device", "rename-user", "delete-account") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		# 后续参数涉及敏感信息 (如密码、JTI) 或无法简单枚举，因此不提供补全。
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for userSettings: $_" -ForegroundColor Red
}
