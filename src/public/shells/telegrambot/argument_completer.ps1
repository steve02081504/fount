# PowerShell 参数补全脚本，用于 Fount 的 'telegrambot' shell。
#
# 使用方法:
#   fount run shells <username> telegrambot <action> [args...]
#
# 支持的 Action:
#   - list: 列出所有已配置的 Telegram 机器人。
#   - create <botname>: 创建一个新的机器人配置。
#   - delete <botname>: 删除一个机器人配置。
#   - config <botname> <configData>: 为机器人设置 JSON 配置。
#   - get-config <botname>: 获取一个机器人的配置。
#   - get-template <charName>: 获取一个角色的 Telegram Bot 配置模板。
#   - start <botname>: 启动一个机器人。
#   - stop <botname>: 停止一个机器人。
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

# 辅助函数：获取指定用户的已配置 Telegram 机器人列表。
function Get-BotList([string]$Username) {
	$jsonPath = "$PSScriptRoot/../../../../data/users/$Username/shells/telegrambot/bot_configs.json"
	if (Test-Path $jsonPath -PathType Leaf) {
		try {
			$botData = Get-Content $jsonPath | ConvertFrom-Json -AsHashtable
			# 返回已配置机器人的名称 (即 JSON 文件中的顶级键)。
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
	# 从命令 AST 中提取 'run shells <username> telegrambot' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$telegramBotIndex = $runIndex + 3

	# 定义所有可用的操作命令。
	$actions = @("list", "create", "delete", "config", "get-config", "get-template", "start", "stop")

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($telegramBotIndex + 1)) {
		0 {
			# 位置 0: 补全第一个参数 (操作命令)。
			$actions | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 根据前一个参数 (action) 补全第二个参数。
			$action = $commandElements[$telegramBotIndex + 1].Value
			switch ($action) {
				"delete"
				"config"
				"get-config"
				"start"
				"stop" {
					# 对于这些操作，第二个参数是已存在的机器人名称。
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
	Write-Host "Error providing argument completion for telegrambot: $_" -ForegroundColor Red
}