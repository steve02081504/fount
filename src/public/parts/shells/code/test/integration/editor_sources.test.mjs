/* global Deno */
/**
 * code shell 编辑器数据源采集测试：VS Code fork 变种目录发现 + workspaceStorage file:// 解码 + Notepad++ 会话。
 */
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { assertEquals } from 'jsr:@std/assert'

import { collectEditorSources } from '../../src/editor_sources.mjs'

/**
 * 构造 VS Code workspace.json 的真实 file:// 文件夹 URL：
 * Windows 盘符以 %3A 编码（VS Code 真实格式），Unix 保持绝对路径。
 * @param {string} p 绝对路径
 * @returns {string} file:// URL
 */
function toVsCodeFileUrl(p) {
	const normalized = p.replace(/\\/g, '/')
	const drive = /^([A-Za-z]):/.exec(normalized)
	return `file:///${drive ? drive[1] + '%3A' + normalized.slice(2) : normalized}`
}

/**
 * 设置本机平台对应的编辑器数据根环境变量（win32 用 APPDATA，其余用 XDG_CONFIG_HOME）。
 * @param {string} root 数据根目录
 * @returns {{ appdata?: string, xdg?: string }} 原值，供 restoreEditorEnv 恢复
 */
function setEditorEnv(root) {
	const saved = { appdata: process.env.APPDATA, xdg: process.env.XDG_CONFIG_HOME }
	if (process.platform === 'win32') process.env.APPDATA = root
	else process.env.XDG_CONFIG_HOME = root
	return saved
}

/** 恢复编辑器数据根环境变量。 @param {{ appdata?: string, xdg?: string }} saved setEditorEnv 返回的原值 */
function restoreEditorEnv(saved) {
	if (saved.appdata === undefined) delete process.env.APPDATA
	else process.env.APPDATA = saved.appdata
	if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME
	else process.env.XDG_CONFIG_HOME = saved.xdg
}

/**
 * 创建模拟的 VS Code fork 数据目录树（Cursor 风格），返回 APPDATA 根。
 * @param {string} root - 临时根目录。
 * @param {string[]} projects - 真实存在的项目目录（相对 root）。
 * @returns {Promise<void>}
 */
async function makeFakeEditorData(root, projects) {
	await mkdir(path.join(root, 'Cursor', 'User', 'globalStorage'), { recursive: true })
	await mkdir(path.join(root, 'Cursor', 'User', 'workspaceStorage', 'hash1'), { recursive: true })
	await mkdir(path.join(root, 'Cursor', 'User', 'workspaceStorage', 'hash2'), { recursive: true })
	const dbPath = path.join(root, 'Cursor', 'User', 'globalStorage', 'state.vscdb')
	const { DatabaseSync } = await import('node:sqlite')
	const db = new DatabaseSync(dbPath)
	db.exec('CREATE TABLE ItemTable(key TEXT, value BLOB)')
	const insert = db.prepare('INSERT INTO ItemTable VALUES (?, ?)')
	insert.run('terminal.history.entries.dirs', JSON.stringify({
		entries: projects.map(p => ({ key: path.join(root, p) })),
	}))
	db.close()
	for (const p of projects)
		await mkdir(path.join(root, p), { recursive: true })
	// workspaceStorage：folder 用 VS Code 真实 file:// URL 格式（Windows 盘符 %3A 编码）
	await writeFile(path.join(root, 'Cursor', 'User', 'workspaceStorage', 'hash1', 'workspace.json'), JSON.stringify({
		folder: toVsCodeFileUrl(path.join(root, projects[0])),
	}))
	await writeFile(path.join(root, 'Cursor', 'User', 'workspaceStorage', 'hash2', 'workspace.json'), JSON.stringify({
		folder: toVsCodeFileUrl(path.join(root, projects[1])),
	}))
}

Deno.test('collectEditorSources discovers VS Code fork variants and decodes file:// folders', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_code_editor_src_'))
	const saved = setEditorEnv(root)
	try {
		await makeFakeEditorData(root, ['cursor-proj', 'trae-proj'])
		const result = await collectEditorSources('u', '0')
		const names = result.map(item => item.name).sort()
		assertEquals(names, ['cursor-proj', 'trae-proj'])
		for (const item of result)
			assertEquals(item.path, path.join(root, item.name))
	}
	finally {
		restoreEditorEnv(saved)
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('collectEditorSources returns [] when no editor data exists', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_code_editor_empty_'))
	const saved = setEditorEnv(root)
	try {
		const result = await collectEditorSources('u', '0')
		assertEquals(result, [])
	}
	finally {
		restoreEditorEnv(saved)
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('collectEditorSources discovers JetBrains recentProjects.xml (Android Studio etc.)', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_code_editor_jb_'))
	const saved = setEditorEnv(root)
	try {
		// root 在 tmpdir（= homedir 下），entry key 用 $USER_HOME$ + 相对路径即可命中真实目录
		const relToHome = path.relative(homedir(), root).replace(/\\/g, '/')
		// 模拟 Android Studio（Google/AndroidStudio<version>/options/recentProjects.xml）
		const asDir = path.join(root, 'Google', 'AndroidStudio2026.1.2', 'options')
		await mkdir(asDir, { recursive: true })
		const project = path.join(root, 'android-proj')
		await mkdir(project, { recursive: true })
		await writeFile(path.join(asDir, 'recentProjects.xml'), `\
<application>
  <component name="RecentProjectsManager">
    <option name="additionalInfo">
      <map>
        <entry key="$USER_HOME$/${relToHome}/android-proj">
          <value><RecentProjectMetaInfo frameTitle="android-proj" /></value>
        </entry>
      </map>
    </option>
    <option name="lastOpenedProject" value="$USER_HOME$/${relToHome}/android-proj" />
  </component>
</application>`)
		// 模拟 IntelliJ IDEA（JetBrains/IntelliJIdea2024.3/options/recentProjects.xml）
		const ijDir = path.join(root, 'JetBrains', 'IntelliJIdea2024.3', 'options')
		await mkdir(ijDir, { recursive: true })
		const jbProject = path.join(root, 'idea-proj')
		await mkdir(jbProject, { recursive: true })
		await writeFile(path.join(ijDir, 'recentProjects.xml'), `\
<application>
  <component name="RecentProjectsManager">
    <option name="additionalInfo">
      <map>
        <entry key="$USER_HOME$/${relToHome}/idea-proj" />
      </map>
    </option>
  </component>
</application>`)
		// 模拟不可展开宏（$APPLICATION_HOME_DIR$）应被跳过，且不能因它失败
		const otherDir = path.join(root, 'JetBrains', 'PyCharm2024.1', 'options')
		await mkdir(otherDir, { recursive: true })
		await writeFile(path.join(otherDir, 'recentProjects.xml'), `\
<application>
  <component name="RecentProjectsManager">
    <option name="additionalInfo">
      <map>
        <entry key="$APPLICATION_HOME_DIR$/bin" />
      </map>
    </option>
  </component>
</application>`)

		const result = await collectEditorSources('u', '0')
		const names = result.map(item => item.name).sort()
		assertEquals(names, ['android-proj', 'idea-proj'])
		// $APPLICATION_HOME_DIR$ 未展开的宏目录不应被收录
		assertEquals(names.includes('bin'), false)
	}
	finally {
		restoreEditorEnv(saved)
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('collectEditorSources sorts projects by last active (mtime of dir + children)', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_code_editor_active_'))
	const saved = setEditorEnv(root)
	try {
		await makeFakeEditorData(root, ['old-proj', 'new-proj'])
		// 显式设置 mtime：new-proj 更新（含子文件 mtime），old-proj 更旧
		const oldDir = path.join(root, 'old-proj')
		const newDir = path.join(root, 'new-proj')
		await writeFile(path.join(oldDir, 'note.txt'), 'old')
		await writeFile(path.join(newDir, 'recent.txt'), 'recent')
		const oldTime = new Date('2020-01-01T00:00:00Z')
		const newTime = new Date('2025-01-01T00:00:00Z')
		await utimes(oldDir, oldTime, oldTime)
		await utimes(path.join(oldDir, 'note.txt'), oldTime, oldTime)
		await utimes(newDir, newTime, newTime)
		await utimes(path.join(newDir, 'recent.txt'), newTime, newTime)

		const result = await collectEditorSources('u', '0')
		const names = result.map(item => item.name)
		// 新活跃项目应排在前面
		assertEquals(names, ['new-proj', 'old-proj'])
	}
	finally {
		restoreEditorEnv(saved)
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('collectEditorSources dedupes junction/symlink aliases keeping the shorter path', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_code_editor_real_'))
	const saved = setEditorEnv(root)
	const isWin = process.platform === 'win32'
	try {
		const real = path.join(root, 'real-proj')
		const alias = path.join(root, 'alias-proj')
		await mkdir(real, { recursive: true })
		const { symlink } = await import('node:fs/promises')
		if (isWin) await symlink(real, alias, 'junction')
		else await symlink(real, alias)
		// 两个路径都出现在历史里（同一真实目录）
		const dbPath = path.join(root, 'Cursor', 'User', 'globalStorage', 'state.vscdb')
		await mkdir(path.dirname(dbPath), { recursive: true })
		const { DatabaseSync } = await import('node:sqlite')
		const db = new DatabaseSync(dbPath)
		db.exec('CREATE TABLE ItemTable(key TEXT, value BLOB)')
		const insert = db.prepare('INSERT INTO ItemTable VALUES (?, ?)')
		insert.run('terminal.history.entries.dirs', JSON.stringify({
			entries: [{ key: real }, { key: alias }],
		}))
		db.close()

		const result = await collectEditorSources('u', '0')
		// 同一真实目录只出现一次，且保留更短的路径名（real-proj）
		assertEquals(result.length, 1)
		assertEquals(result[0].name, 'real-proj')
		assertEquals(result[0].path, real)
	}
	finally {
		restoreEditorEnv(saved)
		await rm(root, { recursive: true, force: true })
	}
})
