# PowerShell 参数补全脚本，用于 Fount 的 'chat' shell。
#
# 使用方法:
#   fount run shells <username> chat <command> [args...]
#
# 支持的 Command 及参数:
#   - start [charName]: 开始一个新的聊天，可选择指定一个角色。
#   - asjson <json_string>: 根据 JSON 字符串加载或创建聊天。
#   - load <chatId>: 加载一个已存在的聊天。
#   - list: 列出所有聊天记录。
#   - send <chatId> <message>: 向指定聊天发送消息。
#   - tail <chatId> [n]: 显示指定聊天的最后 n 条消息。
#   - remove-char <chatId> <charName>: 从聊天中移除一个角色。
#   - set-persona <chatId> [personaName]: 设置或移除当前用户的角色。
#   - set-world <chatId> [worldName]: 设置或移除当前世界。
#   - get-persona <chatId>: 获取当前用户的角色名称。
#   - get-world <chatId>: 获取当前世界的名称。
#   - get-chars <chatId>: 获取聊天中的所有角色列表。
#   - set-char-frequency <chatId> <charName> <frequency>: 设置角色的发言频率。
#   - trigger-reply <chatId> [charName]: 触发一个角色进行回复。
#   - delete-message <chatId> <index>: 删除指定索引的消息。
#   - edit-message <chatId> <index> <newContent>: 编辑指定索引的消息。
#   - modify-timeline <chatId> <delta>: 修改时间线（重新生成回复）。
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

# 辅助函数：获取指定用户的可用聊天 ID 列表。
# 通过扫描用户的聊天记录目录来实现。
function Get-ChatIDList([string]$Username) {
	$chatDir = "$PSScriptRoot/../../../../data/users/$Username/shells/chat/chats"
	if (Test-Path $chatDir -PathType Container) {
		Get-ChildItem -Path $chatDir -File -Filter "*.json" | ForEach-Object {
			$_.BaseName
		}
	}
}

# 辅助函数：从指定的聊天记录文件中获取角色列表。
function Get-CharListFromChat([string]$Username, [string]$ChatId) {
	$chatFilePath = "$PSScriptRoot/../../../../data/users/$Username/shells/chat/chats/${ChatId}.json"
	if (Test-Path $chatFilePath -PathType Leaf) {
		try {
			$chatData = Get-Content $chatFilePath | ConvertFrom-Json
			# 角色列表位于 chatLog 最后一个条目的 timeSlice 对象的 chars 属性中。
			# 如果 chatLog 为空，则无法从中读取 timeSlice。
			if ($chatData.chatLog.Count -gt 0) {
				$lastEntry = $chatData.chatLog[-1]
				if ($lastEntry.timeSlice -and $lastEntry.timeSlice.chars) {
					# timeSlice.chars 是一个对象，其键是角色名。
					return @($lastEntry.timeSlice.chars.psobject.properties.name)
				}
			}
		}
		catch {
			# 出于补全目的，忽略 JSON 解析错误。如果文件损坏或格式不正确，则不提供补全。
		}
	}
	return @()
}


try {
	# 从命令 AST 中提取 'run shells <username> chat' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$chatIndex = $runIndex + 3

	# 定义 chat shell 所有可用的命令列表。
	$chatCommands = @(
		"start", "asjson", "load", "list", "send", "tail", "remove-char",
		"set-persona", "set-world", "get-persona", "get-world", "get-chars",
		"set-char-frequency", "trigger-reply", "delete-message", "edit-message",
		"modify-timeline"
	)

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($chatIndex + 1)) {
		0 {
			# 位置 0: 补全命令本身 (chat 之后的第一个参数)。
			$chatCommands | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 补全命令的第一个参数。
			$command = $commandElements[$chatIndex + 1].Value

			switch ($command) {
				"start" {
					# 为 'start' 命令补全可选的 charName。
					Get-FountPartList -parttype chars -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				"load",
				"send",
				"tail",
				"remove-char",
				"set-persona",
				"set-world",
				"get-persona",
				"get-world",
				"get-chars",
				"set-char-frequency",
				"trigger-reply",
				"delete-message",
				"edit-message",
				"modify-timeline" {
					# 为这些需要 chatId 的命令补全 chatId。
					Get-ChatIDList -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				# 'asjson' 的参数是 JSON 字符串，'list' 无参数，因此不提供补全。
			}
			break
		}
		2 {
			# 位置 2: 补全命令的第二个参数。
			$command = $commandElements[$chatIndex + 1].Value
			$chatId = $commandElements[$chatIndex + 2].Value

			switch ($command) {
				"remove-char",
				"set-char-frequency",
				"trigger-reply" {
					# 从指定的聊天中补全 charName。
					GetCharListFromChat -Username $Username -ChatId $chatId | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				"set-persona" {
					# 补全 personaName。
					Get-FountPartList -parttype personas -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				"set-world" {
					# 补全 worldName。
					Get-FountPartList -parttype worlds -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
			}
			break
		}
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for chat: $_" -ForegroundColor Red
}