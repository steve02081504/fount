# argument_completer.ps1 for install shell

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

try {
	# 提取 'runshell <username> install' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$installIndex = $runshellIndex + 2 # 'install' 的索引

	# 根据参数构建补全逻辑。
	switch ($commandElements.Count - ($installIndex + 1)) {
		0 {
			# 补全命令 (install 之后的第一个参数): "install" 或 "uninstall"。
			@("install", "uninstall") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 补全 install/uninstall 命令的第一个参数。
			$command = $commandElements[$installIndex + 1].Value

			switch ($command) {
				"install" {
					# 补全要安装的文件路径或文本 (install 命令的第一个参数)。
					# 文件补全
					Get-ChildItem -Path "$($WordToComplete)*" -File | ForEach-Object {
						[System.Management.Automation.CompletionResult]::new($_.FullName, $_.Name, 'File', $_.FullName)
					}
					break
				}
				"uninstall" {
					# 补全 partType (uninstall 命令的第一个参数)。
					Get-FountParts | Where-Object { $_.StartsWith($WordToComplete) }
					break
				}
				default {
					# 未知命令，不提供补全。
					break
				}
			}
			break
		}
		2 {
			# 补全 uninstall 命令的第二个参数 (partName)。
			$command = $commandElements[$installIndex + 1].Value
			$partType = $commandElements[$installIndex + 2].Value
			if ($command -eq "uninstall") {
				Get-FountPartList -parttype $partType -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
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
