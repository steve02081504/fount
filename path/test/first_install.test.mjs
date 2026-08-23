/**
 * 首次安装（ZIP / 无 .git / 依赖解析失败的容错）流程：
 * - deno install 前按 .deno-version 升级（deno_pinned_spec → deno_upgrade）；
 * - 无 .git 时跳过 git 自更新（避免 "fatal: not a git directory" 噪音）；
 * - desktop.ini 复制容错（目录不存在时静默跳过，不阻断后续注册）。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assert } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'

const firstInstallPs1Path = join(REPO_ROOT, 'path', 'src', 'first_install.ps1')
const firstInstallShPath = join(REPO_ROOT, 'path', 'src', 'first_install.sh')

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
	const ps1 = await readFile(firstInstallPs1Path, 'utf8')

	assert(ps1.includes('Test-Path "$FOUNT_DIR/node_modules") -and (-not (Test-Path "$FOUNT_DIR/node_modules/desktop.ini")'), 'pwsh node_modules desktop.ini requires the dir to exist')
	assert(ps1.includes('Copy-Item "$FOUNT_DIR/default/node_modules_desktop.ini" "$FOUNT_DIR/node_modules/desktop.ini" -Force -ErrorAction SilentlyContinue'), 'pwsh node_modules desktop.ini copy is non-fatal')
	assert(ps1.includes('Copy-Item "$FOUNT_DIR/default/default_desktop.ini" "$FOUNT_DIR/data/desktop.ini" -Force -ErrorAction SilentlyContinue'), 'pwsh data desktop.ini copy is non-fatal')
})
