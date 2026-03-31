# PowerShell 参数补全脚本，用于 fount 的 'wechatbot' shell。
#
# 使用方法:
#   fount run <username> shells/wechatbot <action> [args...]
#
# 支持的 Action:
#   - list: 列出所有已配置的 WeChat Bot。
#   - create <botname>: 创建一个新的 bot 配置。
#   - delete <botname>: 删除一个 bot 配置。
#   - config <botname> <configData>: 为 bot 设置 JSON 配置。
#   - get-config <botname>: 获取一个 bot 的配置。
#   - get-template <charName>: 获取一个角色的 WeChat Bot 配置模板。
#   - start <botname>: 启动一个 bot。
#   - stop <botname>: 停止一个 bot。
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

function Get-BotList([string]$Username) {
	$jsonPath = "$PSScriptRoot/../../../../data/users/$Username/shells/wechatbot/bot_configs.json"
	if (Test-Path $jsonPath -PathType Leaf) {
		try {
			$botData = Get-Content $jsonPath | ConvertFrom-Json -AsHashtable
			return @($botData.Keys)
		}
		catch {
			return @()
		}
	}
	return @()
}

try {
	$commandElements = $CommandAst.CommandElements
	$wechatBotIndex = $runIndex + 3

	$actions = @("list", "create", "delete", "config", "get-config", "get-template", "start", "stop")

	switch ($commandElements.Count - ($wechatBotIndex + 1)) {
		0 {
			$actions | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			$action = $commandElements[$wechatBotIndex + 1].Value
			switch ($action) {
				{ $_ -in "delete", "config", "get-config", "start", "stop" } {
					Get-BotList -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				"get-template" {
					Get-FountPartList -parttype chars -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
			}
			break
		}
	}
}
catch {
	Write-Host
	Write-Host "Error providing argument completion for wechatbot: $_" -ForegroundColor Red
}
