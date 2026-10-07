/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

Deno.test('PowerShell files carry UTF-8 BOM except the streamed installer', async () => {
	const result = await new Deno.Command('git', { args: ['ls-files', '-z', '*.ps1'], cwd: REPO_ROOT, stdout: 'piped' }).output()
	assertEquals(result.code, 0)
	const missing = []
	for (const path of new TextDecoder().decode(result.stdout).split('\0').filter(Boolean)) {
		const bytes = await Deno.readFile(`${REPO_ROOT}/${path}`)
		new TextDecoder('utf-8', { fatal: true }).decode(bytes)
		const hasBom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF
		if (hasBom !== (path !== 'src/runner/main.ps1'))
			missing.push(path)
	}
	assertEquals(missing, [], 'PowerShell encoding policy violations')
})

Deno.test({
	name: 'bare fount command parses in Windows PowerShell 5.1 from its BOM encoded file',
	ignore: Deno.build.os !== 'windows',
	/**
	 * 在 Windows PowerShell 5.1 里解析 BOM 编码的 `fount` 命令入口。
	 * @returns {Promise<void>} 解析通过时完成
	 */
	async fn() {
		const path = `${REPO_ROOT}/path/src/cmd/default.ps1`.replaceAll('\'', '\'\'')
		const script = `
$ErrorActionPreference = 'Stop'
$file = '${path}'
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$null, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
`
		const result = await new Deno.Command('powershell.exe', {
			args: ['-NoProfile', '-NonInteractive', '-Command', script], stdout: 'piped', stderr: 'piped',
		}).output()
		assertEquals(result.code, 0, new TextDecoder().decode(result.stderr))
	},
})
