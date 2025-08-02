# PowerShell 参数补全脚本，用于 Fount 的 'export' shell。
#
# 使用方法:
#   fount run shells <username> export <partType> <partName> [withData] [outputPath]
#
# 参数:
#   <partType>:   要导出的部件类型 (例如: chars, worlds)。
#   <partName>:   要导出的部件名称。
#   [withData]:   (可选) 是否包含数据文件，'true' 或 'false'。
#   [outputPath]: (可选) 导出的 .zip 文件的路径。
#
# Fount 自动提供的参数:
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
	# 从命令 AST 中提取 'run shells <username> export' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$shellIndex = $runIndex + 3

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($shellIndex + 1)) {
		0 {
			# 位置 0: 补全部件类型 (partType)。
			Get-FountParts | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 补全部件名称 (partName)。
			$partType = $commandElements[$shellIndex + 1].Value
			Get-FountPartList -parttype $partType -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		2 {
			# 位置 2: 补全 withData 参数。
			@("true", "false") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		# 位置 3 (outputPath) 不进行补全，因为它是一个用户自定义的文件路径。
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for export: $_" -ForegroundColor Red
}