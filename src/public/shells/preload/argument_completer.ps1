# PowerShell 参数补全脚本，用于 fount 的 'preload' shell。
#
# 使用方法:
#   fount run shells <username> preload <partType> <partName>
#
# 作用:
#   提前加载一个部件到内存中，以便后续更快地访问。
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
	# 从命令 AST 中提取 'run shells <username> preload' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$preloadIndex = $runIndex + 3 # 'preload' 命令的索引

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($preloadIndex + 1)) {
		0 {
			# 位置 0: 补全部件类型 (partType)。
			Get-FountParts | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 补全部件名称 (partName)。
			$partType = $commandElements[$preloadIndex + 1].Value
			Get-FountPartList -parttype $partType -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for preload: $_" -ForegroundColor Red
}
