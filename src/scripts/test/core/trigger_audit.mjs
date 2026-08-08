/**
 * 校验 manifest trigger glob 是否能在仓库中命中至少一个文件。
 */
import { exec } from 'npm:@steve02081504/exec'

import { matchGlob } from './trigger_filter.mjs'

/**
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 */

/**
 * 未命中任何文件的 trigger（硬错误：fount test 直接 exit 1）。
 * @typedef {object} DeadTrigger
 * @property {string} manifestId manifest id
 * @property {string} suiteName suite 名
 * @property {string} [subtestName] 子测试名（suite 级 trigger 时省略）
 * @property {string} pattern 未命中任何文件的 glob
 */

/**
 * 列出仓库内参与 trigger 匹配的文件（已跟踪 + 未忽略未跟踪）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string[]>} 相对路径（正斜杠）
 */
export async function listRepoFiles(repoRoot) {
	const [tracked, untracked] = await Promise.all([
		exec('git ls-files', { cwd: repoRoot }),
		exec('git ls-files --others --exclude-standard', { cwd: repoRoot }),
	])
	/** @type {string[]} */
	const files = []
	if (tracked.code === 0 && tracked.stdout.trim())
		files.push(...tracked.stdout.trim().split('\n'))
	if (untracked.code === 0 && untracked.stdout.trim())
		files.push(...untracked.stdout.trim().split('\n'))
	return [...new Set(files.map(path => path.trim().replace(/\\/g, '/')).filter(Boolean))]
}

/**
 * 判定 trigger glob 是否命中仓库中至少一个文件。
 * @param {string} pattern trigger glob
 * @param {string[]} repoFiles 仓库文件列表
 * @returns {boolean} 是否至少命中一个文件
 */
export function triggerPatternMatchesAny(pattern, repoFiles) {
	return repoFiles.some(file => matchGlob(pattern, file))
}

/**
 * 扫描全部 suite，找出未命中任何文件的 trigger。
 * 命中结果由 runner 视为硬错误：有任一条则 `fount test` exit 1、不调度套件。
 * @param {SuiteDef[]} suites 全部 suite
 * @param {string[]} repoFiles 仓库文件列表
 * @returns {DeadTrigger[]} 未命中任何文件的 trigger
 */
export function findDeadTriggers(suites, repoFiles) {
	/** @type {Map<string, boolean>} */
	const matchCache = new Map()
	/**
	 * 带缓存的 pattern 匹配（同 pattern 只扫一次仓库）。
	 * @param {string} pattern glob
	 * @returns {boolean} pattern 是否匹配仓库中任一文件
	 */
	const matches = pattern => {
		let hit = matchCache.get(pattern)
		if (hit === undefined) {
			hit = triggerPatternMatchesAny(pattern, repoFiles)
			matchCache.set(pattern, hit)
		}
		return hit
	}

	/** @type {DeadTrigger[]} */
	const dead = []
	for (const suite of suites) {
		for (const pattern of suite.triggers) {
			if (!pattern || matches(pattern)) continue
			dead.push({ manifestId: suite.manifestId, suiteName: suite.name, pattern })
		}
		for (const subtest of suite.subtests ?? [])
			for (const pattern of subtest.triggers) {
				if (!pattern || matches(pattern)) continue
				dead.push({
					manifestId: suite.manifestId,
					suiteName: suite.name,
					subtestName: subtest.name,
					pattern,
				})
			}

	}
	return dead
}

/**
 * 审计仓库 trigger 覆盖率（列出死 trigger）。
 * @param {string} repoRoot 仓库根
 * @param {SuiteDef[]} suites 全部 suite
 * @returns {Promise<DeadTrigger[]>} 未命中任何文件的 trigger
 */
export async function auditTriggerCoverage(repoRoot, suites) {
	return findDeadTriggers(suites, await listRepoFiles(repoRoot))
}
