# PowerShell 参数补全脚本，用于 Fount 的 'install' shell。
#
# 使用方法:
#   fount run shells <username> install <action> [args...]
#
# 支持的 Action:
#   - install <path/url/text>: 从文件、URL或文本安装一个部件。
#   - uninstall <partType> <partName>: 卸载一个部件。
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
	# 从命令 AST 中提取 'run shells <username> install' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$installIndex = $runIndex + 3 # 'install' 命令的索引

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($installIndex + 1)) {
		0 {
			# 位置 0: 补全第一个参数 (操作命令): "install" 或 "uninstall"。
			@("install", "uninstall") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 补全 install/uninstall 命令的第一个参数。
			$command = $commandElements[$installIndex + 1].Value

			switch ($command) {
				"install" {
					# 为 "install" 命令补全文件路径。
					# 注意: 这只会补全当前目录下的文件，更复杂的路径补全由 PowerShell 默认处理。
					Get-ChildItem -Path "$($WordToComplete)*" -File | ForEach-Object {
						[System.Management.Automation.CompletionResult]::new($_.FullName, $_.Name, 'File', $_.FullName)
					}
					break
				}
				"uninstall" {
					# 为 "uninstall" 命令补全部件类型 (partType)。
					Get-FountParts | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
			}
			break
		}
		2 {
			# 位置 2: 补全 uninstall 命令的第二个参数 (partName)。
			$command = $commandElements[$installIndex + 1].Value
			if ($command -eq "uninstall") {
				$partType = $commandElements[$installIndex + 2].Value
				Get-FountPartList -parttype $partType -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
			}
			break
		}
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for install: $_" -ForegroundColor Red
}