# PowerShell 参数补全脚本，用于 Fount 的 'discordbot' shell。
#
# 使用方法:
#   fount run shells <username> discordbot <action> [args...]
#
# 支持的 Action:
#   - list: 列出所有已配置的 Discord Bot。
#   - create <botname>: 创建一个新的bot配置。
#   - delete <botname>: 删除一个bot配置。
#   - config <botname> <configData>: 为bot设置 JSON 配置。
#   - get-config <botname>: 获取一个bot的配置。
#   - get-template <charName>: 获取一个角色的 Discord Bot 配置模板。
#   - start <botname>: 启动一个bot。
#   - stop <botname>: 停止一个bot。
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

# 辅助函数：获取指定用户的已配置Discord bot列表。
function Get-BotList([string]$Username) {
	$jsonPath = "$PSScriptRoot/../../../../data/users/$Username/shells/discordbot/bot_configs.json"
	if (Test-Path $jsonPath -PathType Leaf) {
		try {
			$botData = Get-Content $jsonPath | ConvertFrom-Json -AsHashtable
			# 返回已配置bot的名称 (即 JSON 文件中的顶级键)。
			return @($botData.Keys)
		}
		catch {
			# 如果 JSON 文件格式错误或为空，则返回空数组。
			return @()
		}
	}
	return @()
}

try {
	# 从命令 AST 中提取 'run shells <username> discordbot' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$discordBotIndex = $runIndex + 3

	# 定义所有可用的操作命令。
	$actions = @("list", "create", "delete", "config", "get-config", "get-template", "start", "stop")

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($discordBotIndex + 1)) {
		0 {
			# 位置 0: 补全第一个参数 (操作命令)。
			$actions | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 根据前一个参数 (action) 补全第二个参数。
			$action = $commandElements[$discordBotIndex + 1].Value
			switch ($action) {
				{ $_ -in "delete", "config", "get-config", "start", "stop" } {
					# 对于这些操作，第二个参数是已存在的bot名称。
					Get-BotList -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				"get-template" {
					# 对于 'get-template'，第二个参数是角色名称。
					Get-FountPartList -parttype chars -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				# 'list' 命令没有第二个参数。
				# 'create' 的第二个参数是新名称，不适合从现有列表补全。
			}
			break
		}
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for discordbot: $_" -ForegroundColor Red
}
