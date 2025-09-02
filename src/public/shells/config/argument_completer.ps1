# PowerShell 参数补全脚本，用于 fount 的 'config' shell。
#
# 使用方法:
#   fount run shells <username> config <action> <partType> <partName> [data]
#
# 支持的 Action:
#   - get <partType> <partName>: 获取指定部件的配置。
#   - set <partType> <partName> <data>: 设置指定部件的配置 (data 为 JSON 字符串)。
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
			# 位置 1: 补全部件类型 (partType)。
			# 使用 fount 内置函数获取所有可用的部件类型。
			Get-FountParts | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		2 {
			# 位置 2: 补全部件名称 (partName)。
			# 根据前一个参数输入的 partType，获取该类型下所有部件的列表。
			$partType = $commandElements[$shellIndex + 2].Value
			Get-FountPartList -parttype $partType -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		# 位置 3 (set 命令的 data 参数) 不进行补全，因为它通常是复杂的、用户自定义的 JSON 字符串。
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for config: $_" -ForegroundColor Red
}
