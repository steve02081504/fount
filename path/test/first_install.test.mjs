/**
 * 首次安装（ZIP / 无 .git / 依赖解析失败的容错）流程：
 * - deno install 前按 .deno-version 升级（deno_pinned_spec → deno_upgrade）；
 * - 无 .git 时跳过 git 自更新（避免 "fatal: not a git directory" 噪音）；
 * - desktop.ini 复制容错（目录不存在时静默跳过，不阻断后续注册）。
 */
/* global Deno */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'
import { pwsh_exec } from 'npm:@steve02081504/exec'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const firstInstallPs1Path = join(REPO_ROOT, 'path', 'src', 'first_install.ps1')
const firstInstallShPath = join(REPO_ROOT, 'path', 'src', 'first_install.sh')
const fileAttrsPs1Path = join(REPO_ROOT, 'path', 'src', 'win', 'file_attrs.ps1')

Deno.test('first install upgrades deno to the pinned spec before deno install', async () => {
	const ps1 = await readFile(firstInstallPs1Path, 'utf8')
	const sh = await readFile(firstInstallShPath, 'utf8')

	assert(ps1.includes('if (deno_pinned_spec)'), 'pwsh must check .deno-version before install')
	assert(sh.includes('deno_pinned_spec'), 'bash must check .deno-version before install')
	assert(ps1.indexOf('deno_pinned_spec') < ps1.indexOf('deno install'), 'pwsh: pin upgrade before deno install')
	assert(sh.indexOf('deno_pinned_spec') < sh.indexOf('run_deno install'), 'bash: pin upgrade before deno install')
})

Deno.test('first install skips git self-update when .git is absent (zip download)', async () => {
	const ps1 = await readFile(firstInstallPs1Path, 'utf8')
	const sh = await readFile(firstInstallShPath, 'utf8')

	const psGit = ps1.split('if (!(Test-Path -Path "$FOUNT_DIR/.noupdate"))')[1].split('Write-TaskbarProgress -Percent 70')[0]
	assert(psGit.includes('Test-Path -Path "$FOUNT_DIR/.git"'), 'pwsh git block must require a repo')
	assert(psGit.includes('Get-Command git'), 'pwsh git block still requires git installed')
	const shGit = sh.split('git_reset_and_clean || true')[0]
	assert(shGit.includes('-d "$FOUNT_DIR/.git"'), 'bash git self-update must require a repo')
})

Deno.test('desktop.ini copy is best-effort and does not block downstream', async () => {
	const ps1 = await readFile(fileAttrsPs1Path, 'utf8')
	assert((await readFile(firstInstallPs1Path, 'utf8')).includes('Initialize-FountDesktopIni'), 'init uses the shared desktop.ini setup')

	assert(ps1.includes('Copy-Item "$FOUNT_DIR/default/node_modules_desktop.ini" "$FOUNT_DIR/node_modules/desktop.ini" -Force -ErrorAction SilentlyContinue'), 'pwsh node_modules desktop.ini copy is non-fatal')
	assert(ps1.includes('Copy-Item "$FOUNT_DIR/default/default_desktop.ini" "$FOUNT_DIR/data/desktop.ini" -Force -ErrorAction SilentlyContinue'), 'pwsh data desktop.ini copy is non-fatal')
})

Deno.test({
	name: 'path repairs an extracted tree only when root desktop.ini is neither hidden nor system',
	ignore: Deno.build.os !== 'windows',
	/**
	 * 验证修复触发条件、隐藏属性落到子项以及不越出安装目录。
	 */
	async fn() {
		const dir = await mkdtemp(join(tmpdir(), 'fount-desktop-'))
		try {
			const root = join(dir, 'tree')
			for (const relative of ['path/src/win', 'default', 'data', 'node_modules', '.git', '.hidden'])
				await mkdir(join(root, relative), { recursive: true })

			for (const relative of ['path/fount.ps1', 'path/src/win/file_attrs.ps1', 'path/src/win/installer_dir.ps1', 'default/git_desktop.ini', 'default/default_desktop.ini', 'default/node_modules_desktop.ini'])
				await copyFile(join(REPO_ROOT, relative), join(root, relative))

			await writeFile(join(root, 'data/config.json'), '{}')
			await writeFile(join(root, 'path/src/index.ps1'), '$global:LastExitCode = 0')
			await writeFile(join(root, 'desktop.ini'), '[.ShellClassInfo]')
			await writeFile(join(root, '.hidden/download.txt'), 'download')
			await writeFile(join(dir, 'outside.txt'), 'outside')
			const result = await pwsh_exec(`
$ErrorActionPreference = 'Stop'
$root = '${root.replaceAll('\'', '\'\'')}'
$outside = '${join(dir, 'outside.txt').replaceAll('\'', '\'\'')}'
$ini = Join-Path $root 'desktop.ini'
$download = Join-Path $root '.hidden/download.txt'
(Get-Item -LiteralPath (Join-Path $root '.hidden') -Force).Attributes = [IO.FileAttributes]::Hidden
Set-Content -LiteralPath $outside -Stream Zone.Identifier -Value "[ZoneTransfer]\nZoneId=3"
foreach ($flags in @(2, 4, 6, 0)) {
	(Get-Item -LiteralPath $ini -Force).Attributes = [IO.FileAttributes]$flags
	Set-Content -LiteralPath $download -Stream Zone.Identifier -Value "[ZoneTransfer]\nZoneId=3"
	& (Join-Path $root 'path/fount.ps1') nop
	$blocked = [bool](Get-Item -LiteralPath $download -Stream Zone.Identifier -ErrorAction Ignore)
	if ($blocked -ne ($flags -ne 0)) { throw "unexpected unblock for flags $flags" }
	if ($flags -eq 0) {
		foreach ($relative in @('desktop.ini', 'data/desktop.ini', 'node_modules/desktop.ini', '.git/desktop.ini')) {
			$file = Get-Item -LiteralPath (Join-Path $root $relative) -Force
			if (($file.Attributes -band 6) -ne 6) { throw "missing desktop.ini attributes: $relative" }
			$parent = Get-Item -LiteralPath $file.DirectoryName -Force
			if (-not ($parent.Attributes -band [IO.FileAttributes]::ReadOnly)) { throw "missing directory attribute: $relative" }
		}
	}
}
if (-not (Get-Item -LiteralPath $outside -Stream Zone.Identifier -ErrorAction Ignore)) { throw 'unblocked outside tree' }
`)
			assertEquals(result.code, 0, result.stderr || result.stdout)
		}
		finally {
			await rm(dir, { recursive: true, force: true })
		}
	},
})
