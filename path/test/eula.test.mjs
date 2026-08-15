/**
 * 首次安装 EULA：path CLI 走 i18n；runner 先拉取 fount 再加载 locale。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'
import { bash_exec, pwsh_exec } from 'npm:@steve02081504/exec'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const eulaShPath = join(REPO_ROOT, 'path', 'src', 'eula.sh')
const eulaPs1Path = join(REPO_ROOT, 'path', 'src', 'eula.ps1')
const i18nPs1Path = join(REPO_ROOT, 'path', 'src', 'i18n.ps1')
const runnerShPath = join(REPO_ROOT, 'src', 'runner', 'main.sh')
const runnerPs1Path = join(REPO_ROOT, 'src', 'runner', 'main.ps1')
const zhCnPath = join(REPO_ROOT, 'src', 'public', 'locales', 'zh-CN.json')

const HARDCODED_EULA_PROMPT = 'Do you accept the fount End-User License Agreement (EULA)?'

Deno.test('eula.sh parses under bash -n', async () => {
	const result = await bash_exec(`bash -n ${JSON.stringify(eulaShPath)}`)
	assertEquals(result.code, 0, result.stderr || result.stdout)
})

Deno.test('eula and runner scripts do not hardcode the EULA prompt', async () => {
	for (const path of [eulaShPath, eulaPs1Path, runnerShPath, runnerPs1Path]) {
		const text = await readFile(path, 'utf8')
		assert(!text.includes(HARDCODED_EULA_PROMPT), path)
	}
})

Deno.test('runner installs fount before loading locale and prompting EULA', async () => {
	const sh = await readFile(runnerShPath, 'utf8')
	const ps1 = await readFile(runnerPs1Path, 'utf8')
	const shFlow = sh.slice(sh.indexOf('install_package "git"'))
	assert(shFlow.indexOf('install_fount_tree') < shFlow.indexOf('import_fount_locale'), 'bash: clone before locale')
	assert(shFlow.indexOf('import_fount_locale') < shFlow.indexOf('confirm_fount_eula'), 'bash: locale before EULA prompt')

	const psFlow = ps1.slice(ps1.indexOf('$statusServerJob = $null'))
	assert(psFlow.indexOf('Install-FountTree') < psFlow.indexOf('Import-FountLocale'), 'pwsh: clone before locale')
	assert(psFlow.indexOf('Import-FountLocale') < psFlow.indexOf('Confirm-FountEula'), 'pwsh: locale before EULA prompt')
})

Deno.test('Get-I18n loads eula.prompt from the fount locale tree', async () => {
	const zh = JSON.parse(await readFile(zhCnPath, 'utf8'))
	const expected = zh.fountConsole.path.eula.prompt
	assertEquals(typeof expected, 'string')

	const powerShellResult = await pwsh_exec(`
$FOUNT_DIR = ${JSON.stringify(REPO_ROOT)}
$env:FOUNT_LOCALE = 'zh-CN'
. ${JSON.stringify(i18nPs1Path)}
Get-I18n -key 'eula.prompt'
`)
	assertEquals(powerShellResult.code, 0, powerShellResult.stderr || powerShellResult.stdout)
	assertStringIncludes(powerShellResult.stdout, expected)
})

Deno.test('FOUNT_ACCEPT_EULA matches only exact 1/true/yes', async () => {
	const powerShellResult = await pwsh_exec(`
. ${JSON.stringify(eulaPs1Path)}
function Check($v) {
	$env:FOUNT_ACCEPT_EULA = $v
	if (Test-FountEulaEnvAccepted) { 'yes' } else { 'no' }
}
@(
	(Check '1'),
	(Check 'true'),
	(Check 'YES'),
	(Check '10'),
	(Check 'trueish'),
	(Check 'fooyes'),
	(Check '')
) -join ','
`)
	assertEquals(powerShellResult.code, 0, powerShellResult.stderr || powerShellResult.stdout)
	assertEquals(powerShellResult.stdout.trim(), 'yes,yes,yes,no,no,no,no')
})

Deno.test('status handler CORS allows only GitHub Pages origin', async () => {
	const sh = await readFile(eulaShPath, 'utf8')
	const ps1 = await readFile(eulaPs1Path, 'utf8')
	assertStringIncludes(sh, 'Access-Control-Allow-Origin: https://steve02081504.github.io')
	assert(!sh.includes('Access-Control-Allow-Origin: *'), eulaShPath)
	assertStringIncludes(ps1, 'https://steve02081504.github.io')
	assert(!ps1.includes('Access-Control-Allow-Origin", "*"'), eulaPs1Path)
})

Deno.test('open cmd exits 1 when EULA is not accepted', async () => {
	const openPs1 = await readFile(join(REPO_ROOT, 'path', 'src', 'cmd', 'open.ps1'), 'utf8')
	const openSh = await readFile(join(REPO_ROOT, 'path', 'src', 'cmd', 'open.sh'), 'utf8')
	const psNoTty = openPs1.split('Test-FountConsoleInput')[1].split('Remove-Item')[0]
	assert(psNoTty.includes('exit 1'), 'pwsh no-tty EULA branch')
	assert(!psNoTty.includes('exit $LastExitCode'))
	const psDeclined = openPs1.split('eula.declined')[1].split('Copy-FountDefaultConfig')[0]
	assert(psDeclined.includes('exit 1'), 'pwsh declined EULA branch')
	assert(!psDeclined.includes('exit $LastExitCode'))
	const shNoTty = openSh.split('/dev/tty')[1].split('install_ipc_tools')[0]
	assert(shNoTty.includes('exit 1'), 'bash no-tty EULA branch')
	assert(!shNoTty.includes('exit $?'))
	const shDeclined = openSh.split('eula.declined')[1].split('copy_fount_default_config')[0]
	assert(shDeclined.includes('exit 1'), 'bash declined EULA branch')
	assert(!shDeclined.includes('exit $?'))
})
