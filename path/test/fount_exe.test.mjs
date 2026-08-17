/**
 * Windows exe 打包：New-FountExe 在 ps12exe 抛错时上报 issue，并把 $Error / $LastExitCode 留给 geneexe。
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
 * @param {'unauth' | 'create' | 'existing'} [options.ghMode] 假 gh 行为（默认未登录，避免打到真 GitHub）
 * @param {'explicit' | 'null' | 'omitted' | 'geneexe' | 'selfOverwrite'} [options.call] 调用方式
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} 执行结果
 */
async function runFountExeHarness({
	missingIcon = false,
	compileIcon = true,
	ps12exeThrows = false,
	ps12exeExitCode = 0,
	ghMode = 'unauth',
	call = 'explicit',
} = {}) {
	const root = await mkdtemp(join(tmpdir(), 'fount-exe-'))
	try {
		await mkdir(join(root, 'src', 'runner'), { recursive: true })
		await mkdir(join(root, 'src', 'public', 'pages'), { recursive: true })
		await writeFile(join(root, 'src', 'runner', 'main.ps1'), '#_pragma icon dummy\n')
		if (!missingIcon)
			await writeFile(join(root, 'src', 'public', 'pages', 'favicon.ico'), 'ico')

		const ghIssueList = ghMode === 'existing'
			? 'return \'[{"url":"https://github.com/steve02081504/ps12exe/issues/1"}]\''
			: 'return \'[]\''

		const geneexePs1 = join(REPO_ROOT, 'path', 'src', 'cmd', 'geneexe.ps1')
		const invoke = {
			explicit: 'New-FountExe (Join-Path $FOUNT_DIR \'out.exe\')',
			null: 'New-FountExe $null',
			omitted: 'New-FountExe',
			geneexe: `. ${JSON.stringify(geneexePs1)}; function script:require_mid {}; function script:fount_first_install_if_needed {}; function script:require {}; cmd_geneexe geneexe`,
			selfOverwrite: `
$target = Join-Path $work 'fount.exe'
$lockProc = $null
if ($IsWindows) {
	Copy-Item "$env:SystemRoot\\System32\\ping.exe" $target
	$lockProc = Start-Process -FilePath $target -ArgumentList '127.0.0.1','-t' -PassThru
	Start-Sleep -Milliseconds 500
}
else {
	Set-Content -LiteralPath $target 'old-exe'
}
try {
	New-FountExe
}
finally {
	if ($lockProc) { Stop-Process -Id $lockProc.Id -Force -ErrorAction SilentlyContinue }
}
if (Test-Path -LiteralPath "$target.old") { Write-Output 'RENAMED_OLD' }
`,
		}[call]
		const expectExe = call === 'explicit'
			? 'Join-Path $FOUNT_DIR \'out.exe\''
			: 'Join-Path $work \'fount.exe\''

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
	if (-not $outputFile) { throw 'missing outputFile' }
	Set-Content -LiteralPath $outputFile 'fake-exe'
}
$script:ghLog = @()
function script:gh {
	$script:ghLog += , ($args -join ' ')
	# LastExitCode must be assigned — do not use cmd.exe (path tests run on Linux CI).
	if ($args[0] -eq 'auth') { $global:LastExitCode = ${ghMode === 'unauth' ? '1' : '0'}; return }
	if ($args[0] -eq 'issue' -and $args[1] -eq 'list') {
		$global:LastExitCode = 0
		${ghIssueList}
	}
	if ($args[0] -eq 'issue' -and $args[1] -eq 'create') {
		$global:LastExitCode = 0
		$script:ghLog += , 'GH_CREATE'
		return
	}
	$global:LastExitCode = 1
}
$work = Join-Path $FOUNT_DIR 'cwd'
New-Item -ItemType Directory -Path $work | Out-Null
Push-Location $work
$ErrorCount = $Error.Count
${invoke}
if ($ErrorCount -ne $Error.Count) { Write-Output 'ERROR_LEAK' }
$script:ghLog | ForEach-Object { Write-Output "GH $_" }
if ($script:serverStarted) { Write-Output 'SERVER_STARTED' }
if (Test-Path -LiteralPath (${expectExe})) { Write-Output 'EXE_WRITTEN' }
if (Test-Path -LiteralPath (Join-Path $FOUNT_DIR 'src/runner/main.exe')) { Write-Output 'MAIN_EXE' }
Pop-Location
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
	const result = await runFountExeHarness({ missingIcon: true })
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'SERVER_STARTED')
	assertStringIncludes(result.stdout, 'EXE_WRITTEN')
})

Deno.test('New-FountExe skips server start when favicon.ico already exists', async () => {
	const result = await runFountExeHarness()
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'EXE_WRITTEN')
	if (result.stdout.includes('SERVER_STARTED'))
		throw new Error(`server started despite existing favicon.ico:\n${result.stdout}`)
})

Deno.test('New-FountExe reports ps12exe throw; $Error growth fails geneexe', async () => {
	const result = await runFountExeHarness({
		ps12exeThrows: true,
		ghMode: 'create',
	})
	if (result.code === 0)
		throw new Error(`geneexe path swallowed ps12exe throw:\n${result.stdout}\n${result.stderr}`)
	assertStringIncludes(result.stdout, 'GH issue create')
	assertStringIncludes(result.stdout, 'GH_CREATE')
})

Deno.test('New-FountExe does not file an issue when gh is unauthenticated', async () => {
	const result = await runFountExeHarness({ ps12exeThrows: true })
	if (result.code === 0)
		throw new Error(`geneexe path swallowed ps12exe throw:\n${result.stdout}\n${result.stderr}`)
	if (result.stdout.includes('GH issue create') || result.stdout.includes('GH_CREATE'))
		throw new Error(`unauthenticated gh filed an issue:\n${result.stdout}`)
})

Deno.test('New-FountExe fails when ps12exe only sets LastExitCode', async () => {
	const result = await runFountExeHarness({
		ps12exeExitCode: 2,
		ghMode: 'create',
	})
	if (result.code === 0)
		throw new Error(`geneexe path ignored ps12exe LastExitCode:\n${result.stdout}\n${result.stderr}`)
	if (result.stdout.includes('GH_CREATE') || result.stdout.includes('GH issue create'))
		throw new Error(`LastExitCode-only failure filed a throw issue:\n${result.stdout}`)
})

Deno.test('New-FountExe skips issue create when a matching ps12exe issue already exists', async () => {
	const result = await runFountExeHarness({
		ps12exeThrows: true,
		ghMode: 'existing',
	})
	if (result.code === 0)
		throw new Error(`geneexe path swallowed ps12exe throw:\n${result.stdout}\n${result.stderr}`)
	assertStringIncludes(result.stdout, 'GH issue list')
	if (result.stdout.includes('GH_CREATE') || result.stdout.includes('GH issue create'))
		throw new Error(`created a duplicate issue:\n${result.stdout}`)
})

Deno.test('New-FountExe $null still writes ./fount.exe (PowerShell default param does not apply)', async () => {
	const result = await runFountExeHarness({ call: 'null' })
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'EXE_WRITTEN')
	if (result.stdout.includes('MAIN_EXE'))
		throw new Error(`wrote runner/main.exe instead of cwd/fount.exe:\n${result.stdout}`)
})

Deno.test('New-FountExe with no argument writes ./fount.exe', async () => {
	const result = await runFountExeHarness({ call: 'omitted' })
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'EXE_WRITTEN')
})

Deno.test('fount geneexe with no path writes ./fount.exe', async () => {
	const result = await runFountExeHarness({ call: 'geneexe' })
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'EXE_WRITTEN')
	if (result.stdout.includes('MAIN_EXE'))
		throw new Error(`geneexe wrote runner/main.exe instead of cwd/fount.exe:\n${result.stdout}`)
})

Deno.test('New-FountExe clears existing output (delete or rename to .old) before compile', async () => {
	const result = await runFountExeHarness({ call: 'selfOverwrite' })
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertStringIncludes(result.stdout, 'EXE_WRITTEN')
	if (Deno.build.os === 'windows')
		assertStringIncludes(result.stdout, 'RENAMED_OLD')
	if (result.stdout.includes('ERROR_LEAK'))
		throw new Error(`self-overwrite path leaked errors:\n${result.stdout}`)
})
