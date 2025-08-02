# PowerShell 参数补全脚本，用于 Fount 的 'themeManage' shell。
#
# 使用方法:
#   fount run shells <username> themeManage <action> [themeName]
#
# 支持的 Action:
#   - list: 列出所有可用的主题。
#   - get: 获取当前设置的主题。
#   - set <themeName>: 设置一个新的主题。
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

# 辅助函数：获取内置主题列表，并加上 'auto' 选项。
function Get-ThemeList() {
	return @(
		"auto", "light", "dark", "cupcake", "bumblebee", "emerald", "corporate",
		"synthwave", "retro", "cyberpunk", "valentine", "halloween", "garden",
		"forest", "aqua", "lofi", "pastel", "fantasy", "wireframe", "black",
		"luxury", "dracula", "cmyk", "autumn", "business", "acid", "lemonade",
		"night", "coffee", "winter", "dim", "nord", "sunset"
	)
}

try {
	# 从命令 AST 中提取 'run shells <username> themeManage' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$shellIndex = $runIndex + 3

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($shellIndex + 1)) {
		0 {
			# 位置 0: 补全操作命令 (action)。
			@("list", "get", "set") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 补全 'set' 命令的第二个参数 (themeName)。
			$action = $commandElements[$shellIndex + 1].Value
			if ($action -eq "set") {
				Get-ThemeList | Where-Object { $_.StartsWith($WordToComplete) }
			}
			break
		}
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for themeManage: $_" -ForegroundColor Red
}
