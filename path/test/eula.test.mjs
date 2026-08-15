/**
 * 首次安装 EULA：path CLI 走 i18n；runner 先拉取 fount 再加载 locale。
 */
/* global Deno */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
const PAGES_ORIGIN = 'https://steve02081504.github.io'

/**
 * 断言 haystack 中 earlier 先于 later 出现，且两者都存在。
 * @param {string} haystack 源码片段
 * @param {string} earlier 先出现的标记
 * @param {string} later 后出现的标记
 * @param {string} message 失败说明
 * @returns {void}
 */
function assertMarkerOrder(haystack, earlier, later, message) {
	const earlierAt = haystack.indexOf(earlier)
	const laterAt = haystack.indexOf(later)
	assert(earlierAt >= 0, `${earlier} missing`)
	assert(laterAt >= 0, `${later} missing`)
	assert(earlierAt < laterAt, message)
}

/**
 * 对 eula.sh 生成的状态处理器喂一条 HTTP 请求。
 * @param {string} request 原始请求（含结尾空行）
 * @returns {Promise<{ accepted: boolean, body: string }>} 是否写入接受文件与响应正文
 */
async function runBashStatusHandler(request) {
	const dir = await mkdtemp(join(tmpdir(), 'fount-eula-'))
	const acceptFile = join(dir, 'accepted')
	const requestFile = join(dir, 'request')
	await writeFile(requestFile, request)
	try {
		const result = await bash_exec(`
source ${JSON.stringify(eulaShPath)}
EULA_ACCEPT_FILE=${JSON.stringify(acceptFile)}
export EULA_ACCEPT_FILE
write_fount_status_handler
cat ${JSON.stringify(requestFile)} | "$FOUNT_STATUS_HANDLER"
rm -f "$FOUNT_STATUS_HANDLER"
test -f "$EULA_ACCEPT_FILE" && echo __ACCEPTED__ || echo __PENDING__
`)
		assertEquals(result.code, 0, result.stderr || result.stdout)
		return {
			accepted: result.stdout.includes('__ACCEPTED__'),
			body: result.stdout,
		}
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
}

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
	const runnerSh = await readFile(runnerShPath, 'utf8')
	const runnerPs1 = await readFile(runnerPs1Path, 'utf8')
	const bashFlow = runnerSh.slice(runnerSh.indexOf('install_package "git"'))
	assertMarkerOrder(bashFlow, 'install_fount_tree', 'import_fount_locale', 'bash: clone before locale')
	assertMarkerOrder(bashFlow, 'import_fount_locale', 'confirm_fount_eula', 'bash: locale before EULA prompt')

	const powerShellFlow = runnerPs1.slice(runnerPs1.indexOf('$statusServerJob = $null'))
	assertMarkerOrder(powerShellFlow, 'Install-FountTree', 'Import-FountLocale', 'pwsh: clone before locale')
	assertMarkerOrder(powerShellFlow, 'Import-FountLocale', 'Confirm-FountEula', 'pwsh: locale before EULA prompt')
})

Deno.test('Get-I18n loads eula.prompt from the fount locale tree', async () => {
	const zhCnLocale = JSON.parse(await readFile(zhCnPath, 'utf8'))
	const expectedPrompt = zhCnLocale.fountConsole.path.eula.prompt
	assertEquals(typeof expectedPrompt, 'string')

	const powerShellResult = await pwsh_exec(`
$FOUNT_DIR = ${JSON.stringify(REPO_ROOT)}
$env:FOUNT_LOCALE = 'zh-CN'
. ${JSON.stringify(i18nPs1Path)}
Get-I18n -key 'eula.prompt'
`)
	assertEquals(powerShellResult.code, 0, powerShellResult.stderr || powerShellResult.stdout)
	assertStringIncludes(powerShellResult.stdout, expectedPrompt)
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

Deno.test('status handler writes accept file only for GET /eula from GitHub Pages', async () => {
	const accept = await runBashStatusHandler(`GET /eula HTTP/1.1\r\nOrigin: ${PAGES_ORIGIN}\r\n\r\n`)
	assert(accept.accepted, accept.body)
	assertStringIncludes(accept.body, '"eula":"accepted"')

	const withQuery = await runBashStatusHandler(`GET /eula?x=1 HTTP/1.1\r\nOrigin: ${PAGES_ORIGIN}\r\n\r\n`)
	assert(withQuery.accepted, withQuery.body)

	const withSlash = await runBashStatusHandler(`GET /eula/ HTTP/1.1\r\nOrigin: ${PAGES_ORIGIN}\r\n\r\n`)
	assert(withSlash.accepted, withSlash.body)

	const wrongMethod = await runBashStatusHandler(`POST /eula HTTP/1.1\r\nOrigin: ${PAGES_ORIGIN}\r\n\r\n`)
	assert(!wrongMethod.accepted, wrongMethod.body)

	const wrongOrigin = await runBashStatusHandler('GET /eula HTTP/1.1\r\nOrigin: https://evil.example\r\n\r\n')
	assert(!wrongOrigin.accepted, wrongOrigin.body)

	const wrongPath = await runBashStatusHandler(`GET / HTTP/1.1\r\nOrigin: ${PAGES_ORIGIN}\r\n\r\n`)
	assert(!wrongPath.accepted, wrongPath.body)

	const dir = await mkdtemp(join(tmpdir(), 'fount-eula-ps1-'))
	const acceptFile = join(dir, 'accepted')
	try {
		const powerShellResult = await pwsh_exec(`
$ErrorActionPreference = 'Stop'
. ${JSON.stringify(eulaPs1Path)}
$acceptFile = ${JSON.stringify(acceptFile)}
function Invoke-Accept($Method, $Path, $Origin) {
	Remove-Item -LiteralPath $acceptFile -ErrorAction SilentlyContinue
	Write-FountEulaAcceptFromRequest ([pscustomobject]@{
		HttpMethod = $Method
		Url = [pscustomobject]@{ AbsolutePath = $Path }
		Headers = @{ Origin = $Origin }
	}) $acceptFile
	Test-Path -LiteralPath $acceptFile
}
@(
	$(if (Invoke-Accept 'GET' '/eula' ${JSON.stringify(PAGES_ORIGIN)}) { 'yes' } else { 'no' }),
	$(if (Invoke-Accept 'GET' '/eula/' ${JSON.stringify(PAGES_ORIGIN)}) { 'yes' } else { 'no' }),
	$(if (Invoke-Accept 'PUT' '/eula' ${JSON.stringify(PAGES_ORIGIN)}) { 'yes' } else { 'no' }),
	$(if (Invoke-Accept 'GET' '/eula' 'https://evil.example') { 'yes' } else { 'no' }),
	$(if (Invoke-Accept 'GET' '/' ${JSON.stringify(PAGES_ORIGIN)}) { 'yes' } else { 'no' })
) -join ','
`)
		assertEquals(powerShellResult.code, 0, powerShellResult.stderr || powerShellResult.stdout)
		assertEquals(powerShellResult.stdout.trim(), 'yes,yes,no,no,no')
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})

Deno.test('FOUNT_ACCEPT_EULA copies default config without consuming argv', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'fount-eula-cfg-'))
	try {
		await mkdir(join(dir, 'default'))
		await writeFile(join(dir, 'default', 'config.json'), '{"ok":1}')
		const powerShellResult = await pwsh_exec(`
$FOUNT_DIR = ${JSON.stringify(dir)}
$env:FOUNT_ACCEPT_EULA = '1'
function script:in_docker { $false }
function script:require { }
. ${JSON.stringify(eulaPs1Path)}
Ensure-FountConfig
if (Test-Path -LiteralPath (Join-Path $FOUNT_DIR 'data/config.json')) { 'copied' } else { 'missing' }
`)
		assertEquals(powerShellResult.code, 0, powerShellResult.stderr || powerShellResult.stdout)
		assertEquals(powerShellResult.stdout.trim(), 'copied')

		await rm(join(dir, 'data'), { recursive: true, force: true })
		const bash = await bash_exec(`
FOUNT_DIR=${JSON.stringify(dir)}
export FOUNT_DIR FOUNT_ACCEPT_EULA=1
in_docker() { return 1; }
require() { :; }
source ${JSON.stringify(eulaShPath)}
ensure_fount_config
test -f "$FOUNT_DIR/data/config.json" && echo copied || echo missing
`)
		assertEquals(bash.code, 0, bash.stderr || bash.stdout)
		assertEquals(bash.stdout.trim(), 'copied')
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})

Deno.test('EULA gate exits 1 when not accepted', async () => {
	const eulaPs1 = await readFile(eulaPs1Path, 'utf8')
	const eulaSh = await readFile(eulaShPath, 'utf8')
	const psEnsure = eulaPs1.split('function script:Ensure-FountConfig')[1].split('function script:Confirm-FountEula')[0]
	const psNoTty = psEnsure.split('Test-FountConsoleInput')[1].split('FountEulaAcceptFile')[0]
	assert(psNoTty.includes('exit 1'), 'pwsh no-tty EULA branch')
	assert(!psNoTty.includes('exit $LastExitCode'))
	const psDeclined = psEnsure.split('eula.declined')[1].split('Copy-FountDefaultConfig')[0]
	assert(psDeclined.includes('exit 1'), 'pwsh declined EULA branch')
	assert(!psDeclined.includes('exit $LastExitCode'))
	const shEnsure = eulaSh.split('ensure_fount_config()')[1].split('confirm_fount_eula()')[0]
	const shNoTty = shEnsure.split('/dev/tty')[1].split('install_ipc_tools')[0]
	assert(shNoTty.includes('exit 1'), 'bash no-tty EULA branch')
	assert(!shNoTty.includes('exit $?'))
	const shDeclined = shEnsure.split('eula.declined')[1].split('copy_fount_default_config')[0]
	assert(shDeclined.includes('exit 1'), 'bash declined EULA branch')
	assert(!shDeclined.includes('exit $?'))
})
