# PowerShell 参数补全脚本，用于 fount 的 'export' shell。
#
# 使用方法:
#   fount runas <username> shells/export <partpath> [withData] [outputPath]
#
# 参数:
#   <partpath>:   要导出的部件路径 (例如: chars/my-char, worlds/my-world)。
#   [withData]:   (可选) 是否包含数据文件，'true' 或 'false'。
#   [outputPath]: (可选) 导出的 .zip 文件的路径。
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
	# 从命令 AST 中提取 'runas <username> shells/export' 之后的参数。
	$shellIndex = $runIndex + $(if ($CommandAst.CommandElements[$runIndex].Value -eq 'runas') { 2 } else { 1 })

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($Argindex - ($shellIndex + 1)) {
		0 {
			# 位置 0: 补全部件路径 (partpath)。
			Get-FountPartPathCompletion -Username $Username -WordToComplete $WordToComplete
			break
		}
		1 {
			# 位置 1: 补全 withData 参数。
			@("true", "false") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		# 位置 2 (outputPath) 不进行补全，因为它是一个用户自定义的文件路径。
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for export: $_" -ForegroundColor Red
}
