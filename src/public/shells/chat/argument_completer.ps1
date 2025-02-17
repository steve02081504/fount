# argument_completer.ps1 for chat shell (generated from JavaScript)

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

# 获取可用的chat IDs
function Get-ChatIDList([string]$Username) {
	$chatDir = "$PSScriptRoot/../../../../data/users/$Username/shells/chat/chats"

	Get-ChildItem -Path $chatDir -File -ErrorAction Ignore | Where-Object {
		$_.Extension -eq ".json"
	} | ForEach-Object {
		$_.BaseName
	}
}

try {
	# 提取 'runshell <username> chat' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$chatIndex = $runshellIndex + 2

	# 根据参数构建补全逻辑。
	switch ($commandElements.Count - ($chatIndex + 1)) {
		0 {
			# 补全命令 (chat 之后的第一个参数)。
			@("start", "load", "asjson") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 补全命令的第一个参数。
			$command = $commandElements[$chatIndex + 1].Value

			switch ($command) {
				"start" {
					# 补全 charName (start 命令的第一个参数)。
					Get-FountPartList -parttype chars -Username $Username | Where-Object { $_.StartsWith($WordToComplete) } # 从角色列表中补全。
					break
				}
				"load" {
					# 补全 chatId (load 命令的第一个参数)。
					Get-ChatIDList -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				"asjson" {
					# 不为 asjson 的参数提供补全。
					break
				}
				default {
					# 未知命令，不提供补全。
					break
				}
			}
			break
		}
		default {
			# 对于其他参数，不提供补全。
			break
		}
	}
}
catch {
	Write-Host
	Write-Host "An error occurred during argument completion: $_" -ForegroundColor Red
}
