# PowerShell 参数补全脚本，用于 Fount 的 'easynew' shell。
#
# 使用方法:
#   fount run shells <username> easynew <action> [args...]
#
# 支持的 Action:
#   - list-templates: 列出所有可用的部件模板。
#   - create <templateName> <partName> [jsonData]: 使用模板创建一个新的部件。
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

# 辅助函数：获取可用的 easynew 模板列表。
# 它会同时扫描默认模板目录和用户自定义模板目录。
function Get-EasyNewTemplateList([string]$Username) {
	$defaultTemplatesPath = "$PSScriptRoot/../parts"
	$userTemplatesPath = "$PSScriptRoot/../../../../data/users/$Username/shells/easynew/parts"

	$templateNames = [System.Collections.Generic.List[string]]::new()

	# 定义一个可重用的脚本块来处理目录扫描逻辑。
	$processDirectory = {
		param($path)
		if (Test-Path $path -PathType Container) {
			Get-ChildItem -Path $path -Directory | ForEach-Object {
				if (-not $templateNames.Contains($_.Name)) {
					$templateNames.Add($_.Name)
				}
			}
		}
	}

	# 分别处理默认和用户模板目录。
	& $processDirectory -path $defaultTemplatesPath
	& $processDirectory -path $userTemplatesPath

	return $templateNames
}

try {
	# 从命令 AST 中提取 'run shells <username> easynew' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$shellIndex = $runIndex + 3

	# 根据当前正在输入的参数位置 (相对于 shell 名称) 提供不同的补全建议。
	switch ($commandElements.Count - ($shellIndex + 1)) {
		0 {
			# 位置 0: 补全操作命令 (action)。
			@("list-templates", "create") | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 补全 'create' 命令的第二个参数 (templateName)。
			$action = $commandElements[$shellIndex + 1].Value
			if ($action -eq "create") {
				Get-EasyNewTemplateList -Username $Username | Where-Object { $_.StartsWith($WordToComplete) }
			}
			break
		}
		# 位置 2 (partName) 和 位置 3 (jsonData) 不进行补全，因为它们是用户自定义的。
	}
}
catch {
	# 异常处理
	Write-Host
	Write-Host "Error providing argument completion for easynew: $_" -ForegroundColor Red
}
