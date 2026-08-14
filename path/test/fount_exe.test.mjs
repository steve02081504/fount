/**
 * Windows exe 打包：favicon.ico 缺失时须先启动服务器编译图标，再交给 ps12exe。
 */
/* global Deno */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'
import { pwsh_exec } from 'npm:@steve02081504/exec'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const fountExePs1 = join(REPO_ROOT, 'path', 'src', 'win', 'fount_exe.ps1')

/**
 * 搭一个假 FOUNT_DIR，点进 fount_exe.ps1，用假 ps12exe 复现「Icon file not found」。
 * @param {boolean} missingIcon 是否缺 ico
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 执行结果
 */
async function runNewFountExeHarness(missingIcon) {
	const root = await mkdtemp(join(tmpdir(), 'fount-exe-'))
	try {
		await mkdir(join(root, 'src', 'runner'), { recursive: true })
		await mkdir(join(root, 'src', 'public', 'pages'), { recursive: true })
		await writeFile(join(root, 'src', 'runner', 'main.ps1'), '#_pragma icon dummy\n')
		if (!missingIcon)
			await writeFile(join(root, 'src', 'public', 'pages', 'favicon.ico'), 'ico')

		return await pwsh_exec(`
$ErrorActionPreference = 'Stop'
$FOUNT_DIR = ${JSON.stringify(root)}
. ${JSON.stringify(fountExePs1)}
function script:Test-PWSHModule([string]$ModuleName) {}
function script:Get-I18n($key) { $key }
$script:serverStarted = $false
function script:run {
	if ($args[0] -ne 'shutdown') { return }
	$script:serverStarted = $true
	Set-Content -LiteralPath "$FOUNT_DIR/src/public/pages/favicon.ico" 'compiled-ico'
}
function script:ps12exe {
	param($inputFile, $outputFile)
	$icon = Join-Path $FOUNT_DIR 'src/public/pages/favicon.ico'
	if (-not (Test-Path -LiteralPath $icon)) {
		Write-Error "Icon file not found: $icon"
		exit 1
	}
	Set-Content -LiteralPath $outputFile 'fake-exe'
}
New-FountExe (Join-Path $FOUNT_DIR 'out.exe')
if ($script:serverStarted) { Write-Output 'SERVER_STARTED' }
if (Test-Path -LiteralPath (Join-Path $FOUNT_DIR 'out.exe')) { Write-Output 'EXE_WRITTEN' }
`)
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
}

Deno.test('New-FountExe starts server to compile favicon before ps12exe when ico is missing', async () => {
	const result = await runNewFountExeHarness(true)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'SERVER_STARTED')
	assertStringIncludes(result.stdout, 'EXE_WRITTEN')
})

Deno.test('New-FountExe skips server start when favicon.ico already exists', async () => {
	const result = await runNewFountExeHarness(false)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'EXE_WRITTEN')
	if (result.stdout.includes('SERVER_STARTED'))
		throw new Error(`server started despite existing favicon.ico:\n${result.stdout}`)
})
