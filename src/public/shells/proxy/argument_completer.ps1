# PowerShell 参数补全脚本，用于 Fount 的 'proxy' shell。
#
# 使用方法:
#   fount run shells <username> proxy
#
# 此命令无需额外参数。
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
	# 'proxy' 命令不接受任何参数，因此该脚本无需提供任何补全建议。
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for proxy: $_" -ForegroundColor Red
}
