/**
 * 浏览器探测：https 默认处理器未登记（UserChoice 缺失）时不得误装 Chrome，
 * 只在该也找不到任何已装浏览器时才触发安装。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'
import { pwsh_exec } from 'npm:@steve02081504/exec'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const browserPs1Path = join(REPO_ROOT, 'path', 'src', 'browser.ps1')
const browserShPath = join(REPO_ROOT, 'path', 'src', 'browser.sh')
const runnerPs1Path = join(REPO_ROOT, 'src', 'runner', 'main.ps1')
const runnerShPath = join(REPO_ROOT, 'src', 'runner', 'main.sh')
const eulaPs1Path = join(REPO_ROOT, 'path', 'src', 'eula.ps1')
const openPs1Path = join(REPO_ROOT, 'path', 'src', 'cmd', 'open.ps1')
const uninstallHookPath = join(REPO_ROOT, 'path', 'src', 'packages.uninstall.60.ps1')

Deno.test('Get-Browser finds Edge at the standard path when UserChoice is missing', async () => {
	const result = await pwsh_exec(`
$ErrorActionPreference = 'Stop'
$env:ProgramFiles = 'C:\\Program Files'
$script:wingetCalled = $false
function script:Test-Winget { throw 'must not run' }
function script:RefreshPath { }
function Get-ItemProperty { throw 'no UserChoice key' }
function Test-Path {
	param($Path, $LiteralPath, $PathType)
	$(if ($PSBoundParameters.ContainsKey('LiteralPath')) { $LiteralPath } else { $Path }) -eq 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
}
function winget { $script:wingetCalled = $true; throw 'winget must not run' }
. ${JSON.stringify(browserPs1Path)}
$found = Get-Browser
Test-Browser
"$found|$script:wingetCalled"
`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe|False')
})

Deno.test('Test-Browser installs Chrome only when no browser is found', async () => {
	const result = await pwsh_exec(`
$ErrorActionPreference = 'Stop'
$script:wingetCalled = $false
function script:Test-Winget { }
function script:RefreshPath { }
function Get-ItemProperty { throw 'no UserChoice key' }
function Test-Path { return $false }
function New-Item { }
function Set-Content { }
function Remove-Item { }
function winget { $script:wingetCalled = $true; throw 'winget install failed' }
function Invoke-WebRequest { throw 'chrome download failed' }
function Start-Process { throw 'chrome installer failed' }
. ${JSON.stringify(browserPs1Path)}
Test-Browser
"$script:wingetCalled"
`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'True')
})

Deno.test('Get-Browser resolves the https UserChoice handler to an executable', async () => {
	const result = await pwsh_exec(`
$ErrorActionPreference = 'Stop'
function Get-ItemProperty {
	param($Path, $Name)
	if ($Path -like '*UserChoice') {
		return [pscustomobject]@{ ProgId = 'ChromeDHTML' }
	}
	return [pscustomobject]@{ '(default)' = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1' }
}
function Test-Path { return $true }
. ${JSON.stringify(browserPs1Path)}
Get-Browser
`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
	assertEquals(result.stdout.trim(), 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
})

Deno.test('runner and path scripts share browser detection and open via Open-BrowserUrl', async () => {
	const browserPs1 = await readFile(browserPs1Path, 'utf8')
	const runnerPs1 = await readFile(runnerPs1Path, 'utf8')
	const browserSh = await readFile(browserShPath, 'utf8')
	const runnerSh = await readFile(runnerShPath, 'utf8')
	const eulaPs1 = await readFile(eulaPs1Path, 'utf8')
	const openPs1 = await readFile(openPs1Path, 'utf8')
	const uninstallHook = await readFile(uninstallHookPath, 'utf8')

	assert(!runnerPs1.includes('function Get-Browser'), 'runner must not duplicate Get-Browser')
	assert(!runnerPs1.includes('function Test-Browser'), 'runner must not duplicate Test-Browser')
	assert(runnerPs1.includes('path/src/browser.ps1'), 'runner must dot-source browser.ps1')
	assert(!runnerPs1.includes('InstalledChrome'), 'runner must not track InstalledChrome')
	assert(!runnerPs1.includes('Installed_winget'), 'runner must not track Installed_winget')
	assert(!runnerPs1.includes('winget uninstall'), 'chrome cleanup is the fount remove marker hook, not a finally')
	assert(runnerPs1.includes('auto_installed_winget'), 'runner records auto-installed winget in the data folder')

	assert(browserPs1.includes('Open-BrowserUrl'), 'browser.ps1 exposes Open-BrowserUrl')
	assert(browserPs1.includes('Microsoft\\Edge\\Application\\msedge.exe'), 'browser.ps1 probes the Edge install path')
	assert(browserPs1.includes('\'msedge\', \'chrome\''), 'browser.ps1 probes browsers on PATH')
	assert(browserPs1.includes('auto_installed_chrome'), 'browser.ps1 records auto-installed Chrome in the data folder')
	assert(uninstallHook.includes('auto_installed_chrome'), 'fount remove uninstalls Chrome via the data-folder marker')
	assert(uninstallHook.includes('winget uninstall --id Google.Chrome'), 'fount remove uninstalls Chrome with winget')
	assert(eulaPs1.includes('Open-BrowserUrl $script:FountInstallWaitUrl'), 'eula opens the wait page via Open-BrowserUrl')
	assert(openPs1.includes('Open-BrowserUrl \'https://steve02081504.github.io/fount/wait?cold_bootting=true\''), 'cmd_open opens cold-boot via Open-BrowserUrl')

	assert(browserSh.includes('command -v "$browser_command"'), 'browser.sh probes installed browsers')
	assert(runnerSh.includes('command -v "$browser_command"'), 'runner.sh probes installed browsers')
	assert(browserSh.includes('/usr/bin/firefox'), 'browser.sh probes Linux browser paths')
	assert(runnerSh.includes('/Applications/Google Chrome.app'), 'runner.sh probes macOS browsers')
})
