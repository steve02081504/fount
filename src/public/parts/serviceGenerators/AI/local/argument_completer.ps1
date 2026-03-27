# PowerShell 参数补全脚本，用于 fount 的 'serviceGenerators/AI/local' 生成器。
#
# 使用方法:
#   fount run <username> serviceGenerators/AI/local <action> [args...]
#
# 支持的 Action:
#   - install <uri> [source-name]
#       从 URL 或 HuggingFace URI 下载模型并创建 AI 源。
#       URI 格式示例:
#         https://example.com/model.gguf
#         hf:owner/model:Q4_K_M
#         hf:owner/model/filename.gguf
#         hf.co/owner/model:Q4_K_M
#
#   - create-from-path <path> [source-name]
#       从已有的本地 GGUF 文件路径创建 AI 源（不下载）。
#
# fount 自动提供的参数:
#   $Username:       执行命令的当前用户名。
#   $WordToComplete: 用户当前正在输入、需要补全的单词。
#   $CommandAst:     当前命令的抽象语法树 (AST)，用于分析命令结构。
#   $CursorPosition: 光标在整个命令行中的位置。
#   $runIndex:       'run' 命令在 CommandAst 中的索引。
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
	# 从命令 AST 中提取 'run <username> serviceGenerators/AI/local' 之后的参数。
	$commandElements = $CommandAst.CommandElements
	$localIndex = $runIndex + 3 # part 自身参数的起始索引

	switch ($commandElements.Count - ($localIndex + 1)) {
		0 {
			# 位置 0: 补全 action 名称。
			@('install', 'create-from-path') | Where-Object { $_.StartsWith($WordToComplete) }
			break
		}
		1 {
			# 位置 1: 补全 action 的第一个参数。
			$action = $commandElements[$localIndex + 1].Value

			switch ($action) {
				'install' {
					# URI 无法枚举，返回格式示例作为提示。
					@(
						[System.Management.Automation.CompletionResult]::new(
							'hf:', 'hf:<owner>/<model>:<quant>', 'ParameterValue', 'HuggingFace URI, e.g. hf:Qwen/Qwen2-7B-Instruct-GGUF:Q4_K_M'
						),
						[System.Management.Automation.CompletionResult]::new(
							'https://', 'https://<url>.gguf', 'ParameterValue', 'Direct HTTP/HTTPS URL to a .gguf file'
						)
					) | Where-Object { $_.CompletionText.StartsWith($WordToComplete) }
					break
				}
				'create-from-path' {
					# 补全本地 .gguf 文件路径。
					Get-ChildItem -Path "$($WordToComplete)*" -File -Filter '*.gguf' -ErrorAction SilentlyContinue |
						ForEach-Object {
							[System.Management.Automation.CompletionResult]::new($_.FullName, $_.Name, 'ProviderItem', $_.FullName)
						}
					break
				}
			}
			break
		}
		2 {
			# 位置 2: 可选的 source-name，无自动补全，不做任何处理。
			break
		}
	}
}
catch {
	Write-Host
	Write-Host "Error providing argument completion for serviceGenerators/AI/local: $_" -ForegroundColor Red
}
