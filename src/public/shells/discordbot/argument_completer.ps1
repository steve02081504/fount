# argument_completer.ps1 for discordbot shell

# 参数：
#   $Username:       用户名。
#   $WordToComplete: 用户正在输入的单词。
#   $CommandAst:     命令的抽象语法树 (AST)。
#   $CursorPosition:  光标在命令行中的位置。
#   $runshellIndex:  'runshell' 命令在 CommandAst 中的索引。
#   $Argindex:        当前参数在 CommandAst 中的索引。
param(
	[string]$Username,
	[string]$WordToComplete,
	[System.Management.Automation.Language.CommandAst]$CommandAst,
	[int]$CursorPosition,
	[int]$runshellIndex,
	[int]$Argindex
)

# 获取指定用户的 Discord 机器人列表。
function Get-BotList([string]$Username) {
	# $PSScriptRoot 是当前脚本所在的目录。
	# 构造 discordbot_configs.json 文件的路径。
	$jsonPath = "$PSScriptRoot/../../../../data/users/$Username/shells/discordbot/bot_configs.json"
	# 检查文件是否存在。
	if (Test-Path $jsonPath -PathType Leaf) {
		# 读取 JSON 文件并将其转换为哈希表。
		$botData = Get-Content $jsonPath | ConvertFrom-Json -AsHashtable
		# 返回具有 token 属性的机器人名称。
		# Where-Object 过滤出有token的机器人。
		$botData.Keys | Where-Object { $botData[$_].token }
	}
	else {
		# 如果配置文件不存在，则发出警告。 Write-Warning 比 Write-Host 更适合这种情况，因为它会将消息写入警告流。
		Write-Warning "No config file found for $Username"
	}
}

try {
	# 提取 'runshell <username> discordbot' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	# $discordBotIndex 是 'discordbot' 命令的索引。
	$discordBotIndex = $runshellIndex + 2

	# 根据参数构建补全逻辑。
	# switch 语句根据 'discordbot' 命令之后的参数数量进行分支。
	# $commandElements.Count - ($discordBotIndex + 1) 计算 'discordbot' 之后的参数数量。
	switch ($commandElements.Count - ($discordBotIndex + 1)) {
		0 {
			# 补全 botname（'discordbot' 之后的第一个参数）。
			Get-BotList -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 补全 action（'discordbot' 之后的第二个参数）。
			# 提供 'start' 和 'stop' 作为选项。
			@("start", "stop") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		default {
			# 对于其他参数，不提供补全。
			break
		}
	}
}
catch {
	# 捕获并显示错误信息。
	Write-Host
	Write-Host "An error occurred during argument completion: $_" -ForegroundColor Red
}
