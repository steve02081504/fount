# PowerShell 参数补全脚本，用于 fount 的 'config' shell。
#
# 使用方法:
#   fount run shells <username> config <action> <partpath> [data]
#
# 支持的 Action:
#   - get <partpath>: 获取指定部件的配置。
#   - set <partpath> <data>: 设置指定部件的配置 (data 为 JSON 字符串)。
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

# 辅助函数：补全 partpath
function Complete-PartPath([string]$WordToComplete, [string]$Username) {
	# 如果输入为空，返回所有根类型
	if ([string]::IsNullOrWhiteSpace($WordToComplete)) {
		return Get-FountParts
	}

	# 如果输入包含斜杠，说明已经输入了部分路径
	if ($WordToComplete -match '^([^/]+)/(.*)$') {
		$rootType = $matches[1]
		$remaining = $matches[2]

		# 获取该根类型下的所有部件
		$partList = Get-FountPartList -parttype $rootType -Username $Username
		# 构建完整的 partpath 并过滤
		return $partList | Where-Object { "$rootType/$_" -like "$WordToComplete*" } | ForEach-Object { "$rootType/$_" }
	}
	else {
		# 只输入了根类型的一部分，补全根类型
		return Get-FountParts | Where-Object { $_.StartsWith($WordToComplete) }
	}
}

try {
	# 从命令 AST 中提取出 'run shells <username> config' 之后的用户输入参数。
	$commandElements = $CommandAst.CommandElements
	$shellIndex = $runIndex + 3

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($shellIndex + 1)) {
		0 {
			# 位置 0: 补全操作命令 (action)。
			@("get", "set") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 补全部件路径 (partpath)。
			Complete-PartPath -WordToComplete $WordToComplete -Username $Username
			break
		}
		# 位置 2 (set 命令的 data 参数) 不进行补全，因为它通常是复杂的、用户自定义的 JSON 字符串。
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for config: $_" -ForegroundColor Red
}
