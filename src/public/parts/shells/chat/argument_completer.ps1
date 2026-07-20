# PowerShell 参数补全脚本，用于 fount 的 'chat' shell。
#
# 使用方法:
#   fount run <username> shells/chat <command> [args...]
#
# 支持的 Command 及参数:
#   - dm <introPubKeyHex> <nonce> <sig>: §16 消费 DM 深链（返回 groupId JSON）
#   - join <groupId> [inviteCode]: §16 入群深链
#   - start [charName]: 开始一个新的聊天，可选择指定一个角色。
#   - asjson <json_string>: 根据 JSON 字符串加载或创建聊天。
#   - load <groupId>: 加载一个已存在的聊天。
#   - list: 列出所有聊天记录。
#   - send <groupId> <message>: 向指定聊天发送消息。
#   - tail <groupId> [n]: 显示指定聊天的最后 n 条消息。
#   - remove-char <groupId> <charName>: 从聊天中移除一个角色。
#   - set-persona <groupId> [personaName]: 设置或移除当前用户的角色。
#   - set-world <groupId> [worldName]: 设置或移除当前世界。
#   - get-persona <groupId>: 获取当前用户的角色名称。
#   - get-world <groupId>: 获取当前世界的名称。
#   - get-chars <groupId>: 获取聊天中的所有角色列表。
#   - set-char-frequency <groupId> <charName> <frequency>: 设置角色的发言频率。
#   - trigger-reply <groupId> [charName]: 触发一个角色进行回复。
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

function Get-GroupIdList([string]$Username) {
	$groupsDir = "$PSScriptRoot/../../../../data/users/$Username/shells/chat/groups"
	if (Test-Path $groupsDir -PathType Container) {
		Get-ChildItem -Path $groupsDir -Directory | ForEach-Object { $_.Name }
	}
}

function Get-CharListFromGroup([string]$Username, [string]$GroupId) {
	$snapshotPath = "$PSScriptRoot/../../../../data/users/$Username/shells/chat/groups/${GroupId}/snapshot.json"
	if (Test-Path $snapshotPath -PathType Leaf) {
		try {
			$snapshot = Get-Content $snapshotPath | ConvertFrom-Json
			if ($snapshot.chars) {
				return @($snapshot.chars.psobject.properties.name)
			}
		}
		catch { }
	}
	return @()
}

try {
	$commandElements = $CommandAst.CommandElements
	$groupIndex = $runIndex + 3

	$groupCommands = @(
		"dm", "join",
		"start", "asjson", "load", "list", "send", "tail", "remove-char",
		"set-persona", "set-world", "get-persona", "get-world", "get-chars",
		"set-char-frequency", "trigger-reply"
	)

	switch ($commandElements.Count - ($groupIndex + 1)) {
		0 {
			$groupCommands | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			$command = $commandElements[$groupIndex + 1].Value

			switch ($command) {
				"start" {
					Get-FountPartList -parttype chars -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				"join" {
					Get-GroupIdList -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				{ $_ -in "load",
					"send",
					"tail",
					"remove-char",
					"set-persona",
					"set-world",
					"get-persona",
					"get-world",
					"get-chars",
					"set-char-frequency",
					"trigger-reply"
				} {
					Get-GroupIdList -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
			}
			break
		}
		2 {
			$command = $commandElements[$groupIndex + 1].Value
			$groupId = $commandElements[$groupIndex + 2].Value

			switch ($command) {
				"remove-char" {
					Get-CharListFromGroup -Username $Username -GroupId $groupId | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				"set-char-frequency" {
					Get-CharListFromGroup -Username $Username -GroupId $groupId | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				"trigger-reply" {
					Get-CharListFromGroup -Username $Username -GroupId $groupId | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
			}
			break
		}
		3 {
			$command = $commandElements[$groupIndex + 1].Value
			if ($command -eq "set-char-frequency") {
				# 频率为数字，不提供补全
			}
			break
		}
	}
}
catch {
	# 忽略补全错误
}
