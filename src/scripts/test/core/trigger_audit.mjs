/**
 * 校验 manifest trigger glob 是否能在仓库中命中至少一个文件。
 */
import { exec } from 'npm:@steve02081504/exec'

import { matchGlob } from './trigger_filter.mjs'

/** locale JSON / list.csv 只允许挂在这些 manifest（静态检查）。 */
const LOCALE_TREE_TRIGGER_ALLOW = new Set(['checks'])

/** 节点启动 / 测试辅助只允许挂在 testkit；产品 `live` 套件盯这些会在改测试框架时整波重跑。 */
const TEST_FRAMEWORK_TRIGGER_ALLOW = new Set(['testkit'])

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
 * 展开一层 brace glob（含嵌套），供路径前缀判定。
 * @param {string} pattern glob
 * @returns {string[]} 展开后的模式
 */
function expandGlobBraces(pattern) {
	const start = pattern.indexOf('{')
	if (start < 0) return [pattern]
	let depth = 0
	let end = -1
	for (let i = start; i < pattern.length; i++) 
		if (pattern[i] === '{') depth++
		else if (pattern[i] === '}') {
			depth--
			if (!depth) {
				end = i
				break
			}
		}
	
	if (end < 0) return [pattern]
	const inner = pattern.slice(start + 1, end)
	const prefix = pattern.slice(0, start)
	const suffix = pattern.slice(end + 1)
	/** @type {string[]} */
	const alts = []
	depth = 0
	let last = 0
	for (let i = 0; i < inner.length; i++) 
		if (inner[i] === '{') depth++
		else if (inner[i] === '}') depth--
		else if (inner[i] === ',' && !depth) {
			alts.push(inner.slice(last, i))
			last = i + 1
		}
	
	alts.push(inner.slice(last))
	return alts.flatMap(alt => expandGlobBraces(prefix + alt + suffix))
}

/**
 * @param {string} normalized 已正斜杠化的 glob
 * @returns {boolean} 是否点名 locales 目录
 */
function isLocaleTreePath(normalized) {
	return normalized === 'src/public/locales'
		|| normalized.startsWith('src/public/locales/')
		|| normalized.startsWith('src/public/locales*')
}

/**
 * 是否为 `src/public/locales` 树的 trigger（不含 `src/public/**` 这类更宽 glob）。
 * @param {string} pattern trigger glob
 * @returns {boolean} 是否点名 locales 目录
 */
export function isLocaleTreeTrigger(pattern) {
	return expandGlobBraces(pattern.replaceAll('\\', '/')).some(isLocaleTreePath)
}

/**
 * 扫描挂了 locale 树、但不在允许名单内的 trigger（会把日常文案改动扩成 Playwright / path 波）。
 * @param {import('./manifest.mjs').SuiteDef[]} suites 全部 suite
 * @returns {DeadTrigger[]} 违规 trigger
 */
export function findLocaleTreeTriggers(suites) {
	/** @type {DeadTrigger[]} */
	const hits = []
	for (const suite of suites) {
		if (LOCALE_TREE_TRIGGER_ALLOW.has(suite.manifestId)) continue
		for (const pattern of suite.triggers) {
			if (!isLocaleTreeTrigger(pattern)) continue
			hits.push({ manifestId: suite.manifestId, suiteName: suite.name, pattern })
		}
		for (const subtest of suite.subtests ?? [])
			for (const pattern of subtest.triggers) {
				if (!isLocaleTreeTrigger(pattern)) continue
				hits.push({
					manifestId: suite.manifestId,
					suiteName: suite.name,
					subtestName: subtest.name,
					pattern,
				})
			}
	}
	return hits
}

/**
 * @param {string} normalized 已正斜杠化的 glob
 * @returns {boolean} 是否为测试框架路径
 */
function isTestFrameworkPath(normalized) {
	return normalized === 'src/scripts/test'
		|| normalized.startsWith('src/scripts/test/')
		|| normalized.startsWith('src/scripts/test{')
		|| normalized.startsWith('src/scripts/test*')
}

/**
 * 是否点名 `src/scripts/test/`（不含产品自己的 `src/server/test/` 等）。
 * @param {string} pattern trigger glob
 * @returns {boolean} 是否为测试框架路径
 */
export function isTestFrameworkTrigger(pattern) {
	return expandGlobBraces(pattern.replaceAll('\\', '/')).some(isTestFrameworkPath)
}

/**
 * 产品 `live` 套件不得挂测试框架路径（改 launch/boot 只应跑 testkit）。
 * @param {SuiteDef[]} suites 全部 suite
 * @returns {DeadTrigger[]} 违规 trigger
 */
export function findLiveTestFrameworkTriggers(suites) {
	/** @type {DeadTrigger[]} */
	const hits = []
	for (const suite of suites) {
		if (TEST_FRAMEWORK_TRIGGER_ALLOW.has(suite.manifestId)) continue
		if (suite.name !== 'live') continue
		for (const pattern of suite.triggers) {
			if (!isTestFrameworkTrigger(pattern)) continue
			hits.push({ manifestId: suite.manifestId, suiteName: suite.name, pattern })
		}
		for (const subtest of suite.subtests ?? [])
			for (const pattern of subtest.triggers) {
				if (!isTestFrameworkTrigger(pattern)) continue
				hits.push({
					manifestId: suite.manifestId,
					suiteName: suite.name,
					subtestName: subtest.name,
					pattern,
				})
			}
	}
	return hits
}

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
