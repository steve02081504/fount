# argument_completer.ps1 for preload shell

# 参数：
#   $Username:       用户名。
#   $WordToComplete: 用户正在输入的单词。
#   $CommandAst:     命令的抽象语法树 (AST)。
#   $CursorPosition:  光标在命令行中的位置。
#   $runIndex:  'run shells' 命令在 CommandAst 中的索引。
#   $Argindex:        当前参数在 CommandAst 中的索引。
param(
	[string]$Username,
	[string]$WordToComplete,
	[System.Management.Automation.Language.CommandAst]$CommandAst,
	[int]$CursorPosition,
	[int]$runIndex,
	[int]$Argindex
)

try {
	# 提取 'run shells <username> preload' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$preloadIndex = $runIndex + 3 # 'preload' 的索引

	# 根据参数构建补全逻辑。
	switch ($commandElements.Count - ($preloadIndex + 1)) {
		0 {
			# 补全 partType (preload 之后的第一个参数)。
			Get-FountParts | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 补全 partName (preload 之后的第二个参数)。
			$partType = $commandElements[$preloadIndex + 1].Value
			Get-FountPartList -parttype $partType -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
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
