# PowerShell 参数补全脚本，用于 Fount 的 'AIsourceManage' shell。
#
# 使用方法:
#   fount run shells <username> AIsourceManage <action> [sourceName]
#
# 支持的 Action:
#   - list: 列出所有可用的 AI 源。
#   - create <sourceName>: 创建一个新的 AI 源配置文件。
#   - delete <sourceName>: 删除一个 AI 源。
#   - get <sourceName>: 获取一个 AI 源的配置。
#   - set <sourceName> <data>: 设置一个 AI 源的配置 (data 为 JSON 字符串)。
#   - set-default <sourceName>: 将一个 AI 源设置为默认。
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
	# 从命令 AST 中提取出 'run shells <username> AIsourceManage' 之后的用户输入参数。
	$commandElements = $CommandAst.CommandElements
	# 'AIsourceManage' 这个 shell 名称本身位于 'run' 之后的第3个位置 (索引+3)。
	$shellIndex = $runIndex + 3

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($shellIndex + 1)) {
		0 {
			# 位置 0: 补全操作命令 (action)。
			# 这是 'AIsourceManage' 后的第一个参数。
			@("list", "create", "delete", "get", "set", "set-default") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 补全第二个参数 (通常是 sourceName)。
			$action = $commandElements[$shellIndex + 1].Value
			switch ($action) {
				"delete"
				"get"
				"set"
				"set-default" {
					# 对于这些需要指定已存在源的命令，调用 Fount 的内部函数来获取 AI 源列表，并进行补全。
					Get-FountPartList -parttype AIsources -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				# "list" 命令没有参数，因此不提供补全。
				# "create" 命令的第二个参数是新资源的名称，不适合从现有列表补全。
			}
			break
		}
	}
}
catch {
	# 异常处理：如果补全脚本自身发生错误，在控制台打印错误信息以便调试。
	# 使用 Write-Host 以免干扰补全结果的输出。
	Write-Host
	Write-Host "Error providing argument completion for AIsourceManage: $_" -ForegroundColor Red
}
