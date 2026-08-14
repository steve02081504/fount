/**
 * Windows exe 打包：Install-FountRootExe 须吞掉 ps12exe 抛错，不能拖垮 fount server。
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
 * 假 FOUNT_DIR + 假 ps12exe，复现 CI「Icon file not found / ScriptHalted」。
 * @param {object} options 选项
 * @param {boolean} [options.missingIcon] 是否缺 ico
 * @param {boolean} [options.compileIcon] 假 `run shutdown` 是否写出 ico
 * @param {boolean} [options.ps12exeThrows] 假 ps12exe 是否 Write-Error + throw
 * @param {number} [options.ps12exeExitCode] 假 ps12exe 仅设置的 `$LastExitCode`（0 表示写出 exe）
 * @param {'New-FountExe' | 'Install-FountRootExe'} [options.entry] 入口
 * @param {'unauth' | 'create' | 'existing'} [options.ghMode] 假 gh 行为（默认未登录，避免打到真 GitHub）
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 执行结果
 */
async function runFountExeHarness({
	missingIcon = false,
	compileIcon = true,
	ps12exeThrows = false,
	ps12exeExitCode = 0,
	entry = 'New-FountExe',
	ghMode = 'unauth',
} = {}) {
	const root = await mkdtemp(join(tmpdir(), 'fount-exe-'))
	try {
		await mkdir(join(root, 'src', 'runner'), { recursive: true })
		await mkdir(join(root, 'src', 'public', 'pages'), { recursive: true })
		await writeFile(join(root, 'src', 'runner', 'main.ps1'), '#_pragma icon dummy\n')
		if (!missingIcon)
			await writeFile(join(root, 'src', 'public', 'pages', 'favicon.ico'), 'ico')

		const call = entry === 'Install-FountRootExe'
			? 'Install-FountRootExe'
			: 'New-FountExe (Join-Path $FOUNT_DIR \'out.exe\')'

		return await pwsh_exec(`
$ErrorActionPreference = 'Continue'
$FOUNT_DIR = ${JSON.stringify(root)}
. ${JSON.stringify(fountExePs1)}
function script:Test-PWSHModule([string]$ModuleName) {}
function script:Get-I18n($key) { $key }
$script:serverStarted = $false
function script:run {
	if ($args[0] -ne 'shutdown') { return }
	$script:serverStarted = $true
	${compileIcon ? 'Set-Content -LiteralPath "$FOUNT_DIR/src/public/pages/favicon.ico" \'compiled-ico\'' : ''}
}
function script:ps12exe {
	param($inputFile, $outputFile)
	$icon = Join-Path $FOUNT_DIR 'src/public/pages/favicon.ico'
	if (${ps12exeThrows ? '$true' : '$false'} -or -not (Test-Path -LiteralPath $icon)) {
		Write-Error "Icon file not found: $icon"
		throw 'ScriptHalted'
	}
	if (${ps12exeExitCode}) {
		$global:LastExitCode = ${ps12exeExitCode}
		return
	}
	Set-Content -LiteralPath $outputFile 'fake-exe'
}
$script:ghLog = @()
function script:gh {
	$script:ghLog += , ($args -join ' ')
	# LastExitCode must be assigned — do not use cmd.exe (path tests run on Linux CI).
	if ($args[0] -eq 'auth') { $global:LastExitCode = ${ghMode === 'unauth' ? '1' : '0'}; return }
	if ($args[0] -eq 'issue' -and $args[1] -eq 'list') {
		$global:LastExitCode = 0
		if (${JSON.stringify(ghMode)} -eq 'existing') { return '[{"url":"https://github.com/steve02081504/ps12exe/issues/1"}]' }
		return '[]'
	}
	if ($args[0] -eq 'issue' -and $args[1] -eq 'create') {
		$global:LastExitCode = 0
		$script:ghLog += , 'GH_CREATE'
		return
	}
	$global:LastExitCode = 1
}
$ErrorCount = $Error.Count
${call}
if ($ErrorCount -ne $Error.Count) { Write-Output 'ERROR_LEAK' }
$script:ghLog | ForEach-Object { Write-Output "GH $_" }
if ($script:serverStarted) { Write-Output 'SERVER_STARTED' }
if (Test-Path -LiteralPath (Join-Path $FOUNT_DIR 'out.exe')) { Write-Output 'EXE_WRITTEN' }
if (Test-Path -LiteralPath (Join-Path $FOUNT_DIR 'fount.exe')) { Write-Output 'ROOT_EXE_WRITTEN' }
if ($ErrorCount -ne $Error.Count) { exit 1 }
if ($LastExitCode) { Write-Output "EXIT_$LastExitCode"; exit $LastExitCode }
Write-Output 'OK'
`)
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
}

Deno.test('New-FountExe starts server to compile favicon before ps12exe when ico is missing', async () => {
	const result = await runFountExeHarness({ missingIcon: true, entry: 'New-FountExe' })
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'SERVER_STARTED')
	assertStringIncludes(result.stdout, 'EXE_WRITTEN')
})

Deno.test('New-FountExe skips server start when favicon.ico already exists', async () => {
	const result = await runFountExeHarness({ entry: 'New-FountExe' })
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'EXE_WRITTEN')
	if (result.stdout.includes('SERVER_STARTED'))
		throw new Error(`server started despite existing favicon.ico:\n${result.stdout}`)
})

Deno.test('Install-FountRootExe swallows ps12exe ScriptHalted when CI stub does not compile ico', async () => {
	const result = await runFountExeHarness({
		missingIcon: true,
		compileIcon: false,
		entry: 'Install-FountRootExe',
	})
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'OK')
	if (result.stdout.includes('ERROR_LEAK'))
		throw new Error(`$Error leaked after Install-FountRootExe:\n${result.stdout}\n${result.stderr}`)
})

Deno.test('Install-FountRootExe swallows ps12exe throw even when ico exists', async () => {
	const result = await runFountExeHarness({
		ps12exeThrows: true,
		entry: 'Install-FountRootExe',
	})
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'OK')
	if (result.stdout.includes('GH issue create') || result.stdout.includes('GH_CREATE'))
		throw new Error(`unauthenticated gh filed an issue:\n${result.stdout}`)
})

Deno.test('New-FountExe reports ps12exe throw; $Error growth fails geneexe', async () => {
	const result = await runFountExeHarness({
		ps12exeThrows: true,
		entry: 'New-FountExe',
		ghMode: 'create',
	})
	if (result.code === 0)
		throw new Error(`geneexe path swallowed ps12exe throw:\n${result.stdout}\n${result.stderr}`)
	assertStringIncludes(result.stdout, 'GH issue create')
	assertStringIncludes(result.stdout, 'GH_CREATE')
})

Deno.test('New-FountExe fails when ps12exe only sets LastExitCode', async () => {
	const result = await runFountExeHarness({
		ps12exeExitCode: 2,
		entry: 'New-FountExe',
		ghMode: 'create',
	})
	if (result.code === 0)
		throw new Error(`geneexe path ignored ps12exe LastExitCode:\n${result.stdout}\n${result.stderr}`)
	if (result.stdout.includes('GH_CREATE') || result.stdout.includes('GH issue create'))
		throw new Error(`LastExitCode-only failure filed a throw issue:\n${result.stdout}`)
})

Deno.test('Install-FountRootExe swallows ps12exe LastExitCode-only failure', async () => {
	const result = await runFountExeHarness({
		ps12exeExitCode: 2,
		entry: 'Install-FountRootExe',
		ghMode: 'create',
	})
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'OK')
	if (result.stdout.includes('GH_CREATE') || result.stdout.includes('GH issue create'))
		throw new Error(`LastExitCode-only failure filed a throw issue:\n${result.stdout}`)
})

Deno.test('Install-FountRootExe files a ps12exe issue when gh is authenticated and none exists', async () => {
	const result = await runFountExeHarness({
		ps12exeThrows: true,
		entry: 'Install-FountRootExe',
		ghMode: 'create',
	})
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'GH issue create')
	assertStringIncludes(result.stdout, 'GH_CREATE')
})

Deno.test('Install-FountRootExe skips issue create when a matching ps12exe issue already exists', async () => {
	const result = await runFountExeHarness({
		ps12exeThrows: true,
		entry: 'Install-FountRootExe',
		ghMode: 'existing',
	})
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'GH issue list')
	if (result.stdout.includes('GH_CREATE') || result.stdout.includes('GH issue create'))
		throw new Error(`created a duplicate issue:\n${result.stdout}`)
})
