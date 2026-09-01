/**
 * 扫描仓库内全部 test/manifest.json 并解析 suite 元数据。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { attachDependencies, sortManifestIds } from './dependencies.mjs'
import { parseExpectedMs } from './expected.mjs'
import { parseManifestResources } from './resources.mjs'
import { parseSkipBecause } from './skip_because.mjs'
import { matchGlob, mergeTriggerFilter } from './trigger_filter.mjs'
/**
 * suite 内注册的子测试。
 * @typedef {object} SubtestDef
 * @property {string} name 子测试名（CLI 第三级选择器）
 * @property {string} spec spec 文件名（默认 `${name}.spec.mjs`）
 * @property {number | null} [expectedMs] manifest `expected` 解析出的预估耗时（毫秒）
 * @property {string[]} triggers 子测试专属触发 glob（不含 suite 共享 triggers）
 * @property {string[]} [triggerRefs] trigger set 引用名
 * @property {Record<string, string[]>} [triggerSetPatterns] triggerRefs 展开的模式表
 * @property {import('./skip_because.mjs').SkipBecauseEntry[]} [skipBecause] skip_because 条目；`as` 默认 pass（当绿），skip_tree 连下游跳过；关闭已过 delay 则失败
 */

/**
 * manifest 中单个 suite 的解析结果。
 * @typedef {object} SuiteDef
 * @property {string} manifestId manifest 顶层 id
 * @property {string} name suite 显示名
 * @property {string} id suite 指名 id（默认同 name）
 * @property {number | null} [expectedMs] manifest `expected` 解析出的全量预估耗时（毫秒）
 * @property {string[]} run 执行命令
 * @property {string[]} triggers 触发 glob（suite 共享；命中则全部子测试过期）
 * @property {string[]} [triggerRefs] manifest trigger set 引用名
 * @property {Record<string, string[]>} [triggerSetPatterns] triggerRefs 展开的模式表
 * @property {SubtestDef[]} [subtests] 注册的子测试
 * @property {string} manifestPath 相对仓库根的 manifest 路径
 * @property {boolean} heavy 满核独占（仅 `p2p/sim` 等）；其余用 `resources`
 * @property {{ memMb?: number, cpuPct?: number } | undefined} resources 声明资源；缺省由 `resources.mjs` 推断
 * @property {string[]} [dependsOn] manifest 中的依赖指名
 * @property {{ manifestId: string, name: string }[]} [dependencies] 解析后的依赖
 * @property {import('./trigger_filter.mjs').TriggerFilter} [triggerFilter] 忽略规则覆写
 * @property {import('./skip_because.mjs').SkipBecauseEntry[]} [skipBecause] skip_because 条目
 * @property {string | null} [gitRoot] data/users 嵌套 git 根（相对仓库）；无则为 null，fount 树内 suite 为 undefined
 */

/**
 * 解析 suite 的 trigger set 引用名。
 * @param {object} suite manifest 中的 suite 条目
 * @returns {string[]} trigger set 引用
 */
function resolveSuiteTriggerRefs(suite) {
	if (!suite.trigger) return []
	return Array.isArray(suite.trigger) ? suite.trigger : [suite.trigger]
}

/**
 * 解析 trigger / triggers 字段为 glob 模式列表。
 * @param {object} entry suite 或 subtest 条目
 * @param {Record<string, string[]>} triggerSets manifest triggerSets
 * @param {string} label 错误信息中的标签
 * @returns {{ patterns: string[], refs: string[], setPatterns: Record<string, string[]> }} 解析结果
 */
function resolveTriggerFields(entry, triggerSets, label) {
	/** @type {string[]} */
	const patterns = []
	const refs = entry.trigger
		? Array.isArray(entry.trigger) ? entry.trigger : [entry.trigger]
		: []
	/** @type {Record<string, string[]>} */
	const setPatterns = {}
	for (const ref of refs) {
		const set = triggerSets[ref]
		if (!set?.length)
			throw new Error(`unknown trigger "${ref}" in ${label}`)
		patterns.push(...set)
		setPatterns[ref] = set
	}
	if (entry.triggers?.length)
		patterns.push(...entry.triggers)
	return { patterns: [...new Set(patterns)], refs, setPatterns }
}

/**
 * 解析 suite 的 trigger 引用为 glob 模式列表。
 * @param {object} suite manifest 中的 suite 条目
 * @param {Record<string, string[]>} triggerSets manifest triggerSets
 * @returns {string[]} 解析后的 triggers
 */
function resolveSuiteTriggers(suite, triggerSets) {
	return resolveTriggerFields(suite, triggerSets, `suite "${suite.name}"`).patterns
}

/**
 * 解析 suite.subtests 数组。
 * @param {object} suite manifest 中的 suite 条目
 * @param {Record<string, string[]>} triggerSets manifest triggerSets
 * @returns {SubtestDef[] | undefined} 子测试列表
 */
function resolveSubtests(suite, triggerSets) {
	if (!suite.subtests?.length) return undefined
	/** @type {SubtestDef[]} */
	const out = []
	/** @type {Set<string>} */
	const seen = new Set()
	for (const raw of suite.subtests) {
		const name = raw.name?.trim()
		if (!name)
			throw new Error(`subtest missing "name" in suite "${suite.name}"`)
		if (seen.has(name))
			throw new Error(`duplicate subtest "${name}" in suite "${suite.name}"`)
		seen.add(name)
		const { patterns, refs, setPatterns } = resolveTriggerFields(
			raw,
			triggerSets,
			`subtest "${suite.name}/${name}"`,
		)
		out.push({
			name,
			spec: raw.spec?.trim() || `${name}.spec.mjs`,
			expectedMs: parseExpectedMs(raw.expected),
			triggers: patterns,
			triggerRefs: refs.length ? refs : undefined,
			triggerSetPatterns: refs.length ? setPatterns : undefined,
			skipBecause: parseSkipBecause(raw.skip_because, `subtest "${suite.name}/${name}"`),
		})
	}
	return out
}

/**
 * 子测试的 spec 文件名。
 * @param {SubtestDef} subtest 子测试
 * @returns {string} basename
 */
export function subtestSpecBasename(subtest) {
	return subtest.spec
}

const SKIP_DIR_NAMES = new Set([
	'node_modules',
	'.git',
	'dist',
])

/** 并行目录遍历并发上限（readdir 大量并发对 Windows 无益，8 足够吃满磁盘队列）。 */
const MANIFEST_WALK_CONCURRENCY = 8

/**
 * 有界并发的递归 readdir 扫描：并行兄弟目录，避免 700+ 目录逐个串行遍历。
 * 槽位只在单次 readdir 期间持有（不跨子目录等待），深目录链不会占满并发导致死锁。
 * @param {string} directory 起始目录绝对路径
 * @returns {Promise<string[]>} 找到的 manifest 绝对路径（顺序不保证）
 */
async function findManifestFilesParallel(directory) {
	/** @type {string[]} */
	const found = []
	let active = 0
	/** @type {(() => void)[]} */
	const waiters = []
	/** 未完成的目录/stat 任务数；归零即全部完成。 */
	let pending = 1
	let drainedResolve
	/** @type {Promise<void>} */
	const drained = new Promise(resolve => { drainedResolve = resolve })

	/**
	 * 获取一个 readdir 槽位；超出并发时排队。
	 * @returns {Promise<void>} 槽位可用
	 */
	const acquire = () => new Promise(resolve => {
		if (active < MANIFEST_WALK_CONCURRENCY) {
			active++
			resolve()
		}
		else waiters.push(resolve)
	})
	/**
	 * 释放一个槽位；有排队等待者则把槽位直接转交给最先等待者，
	 * 避免被唤醒者（自身未 acquire）再递减 active 导致并发计数失真。
	 * @returns {void}
	 */
	const release = () => {
		if (waiters.length) waiters.shift()()
		else active--
	}

	/**
	 * 遍历单个目录：readdir 结束后立即释放槽位，再派发子目录。
	 * @param {string} path 目录绝对路径
	 * @returns {Promise<void>} 完成
	 */
	const processDirectory = async path => {
		await acquire()
		let entries
		try {
			entries = await readdir(path, { withFileTypes: true })
		}
		catch {
			release()
			return
		}
		release()
		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			if (SKIP_DIR_NAMES.has(entry.name)) continue
			const child = join(path, entry.name)
			if (entry.name === 'test') {
				const manifestPath = join(child, 'manifest.json')
				pending++
				stat(manifestPath).then(() => found.push(manifestPath)).catch(() => { }).finally(() => {
					pending--
					if (pending === 0) drainedResolve()
				})
				continue
			}
			pending++
			void processDirectory(child).finally(() => {
				pending--
				if (pending === 0) drainedResolve()
			})
		}
	}

	// 根目录本身也算一个 pending：派发完成后由其 finally 递减，全部子任务归零时 drained 落地。
	void processDirectory(directory).finally(() => {
		pending--
		if (pending === 0) drainedResolve()
	})
	await drained
	return found
}

/**
 * 递归查找 test/manifest.json（并行遍历，顺序不保证）。
 * @param {string} dir 当前目录绝对路径
 * @returns {AsyncGenerator<string>} manifest 绝对路径
 */
async function* findManifestFiles(dir) {
	for (const manifestPath of await findManifestFilesParallel(dir))
		yield manifestPath
}

/**
 * 读取全部 manifest 中的 suite 定义。
 * @param {string} repoRoot 仓库根目录
 * @returns {Promise<SuiteDef[]>} 全部 suite
 */
export async function loadAllSuites(repoRoot) {
	/** @type {SuiteDef[]} */
	const suites = []
	/** @type {Set<string>} */
	const seenIds = new Set()

	for await (const manifestPath of findManifestFiles(repoRoot)) {
		const raw = await readFile(manifestPath, 'utf8')
		const manifest = JSON.parse(raw)
		const manifestId = manifest.id?.trim()
		if (!manifestId) {
			const rel = relative(repoRoot, manifestPath).replace(/\\/g, '/')
			throw new Error(`test manifest missing "id": ${rel}`)
		}
		if (seenIds.has(manifestId))
			throw new Error(`duplicate test manifest id: ${manifestId}`)
		seenIds.add(manifestId)

		const relManifest = relative(repoRoot, manifestPath).replace(/\\/g, '/')
		const triggerSets = manifest.triggerSets ?? {}
		const manifestTriggerFilter = manifest.triggerFilter
		for (const suite of manifest.suites || []) {
			if (!suite.name)
				throw new Error(`suite missing "name" in ${relManifest}`)
			const triggerRefs = resolveSuiteTriggerRefs(suite)
			/** @type {Record<string, string[]>} */
			const triggerSetPatterns = {}
			for (const ref of triggerRefs)
				triggerSetPatterns[ref] = triggerSets[ref]
			suites.push({
				manifestId,
				name: suite.name,
				id: suite.id?.trim() || suite.name,
				expectedMs: parseExpectedMs(suite.expected),
				run: suite.run,
				triggers: resolveSuiteTriggers(suite, triggerSets),
				triggerRefs,
				triggerSetPatterns: triggerRefs.length ? triggerSetPatterns : undefined,
				subtests: resolveSubtests(suite, triggerSets),
				manifestPath: relManifest,
				heavy: suite.heavy === true,
				resources: parseManifestResources(suite.resources),
				dependsOn: suite.dependsOn
					? Array.isArray(suite.dependsOn) ? suite.dependsOn : [suite.dependsOn]
					: undefined,
				triggerFilter: mergeTriggerFilter(manifestTriggerFilter, suite.triggerFilter),
				skipBecause: parseSkipBecause(suite.skip_because, `suite "${suite.name}"`),
			})
		}
	}
	return attachDependencies(suites)
}

/**
 * suite 是否匹配指名 selector（id 或 name；支持 glob 与前缀展开）。
 * @param {SuiteDef} suite suite
 * @param {string} selector 指名
 * @param {{ prefixExpand?: boolean }} [options] prefixExpand 为 false 时仅精确匹配与显式 glob
 * @returns {boolean} 是否匹配
 */
export function suiteMatchesSelector(suite, selector, { prefixExpand = true } = {}) {
	const sel = selector.trim()
	if (!sel) return false

	const fields = [suite.id, suite.name]
	if (fields.some(field => field === sel)) return true

	/** @type {string[]} */
	const patterns = []
	if (sel.includes('*') || sel.includes('?'))
		patterns.push(sel)
	else if (prefixExpand)
		patterns.push(`${sel}*`, `${sel}_*`)

	return patterns.some(pat => fields.some(field => matchGlob(pat, field)))
}

/**
 * 按 manifest id 与 suite selector 过滤。
 * @param {SuiteDef[]} suites 候选 suite
 * @param {object} filter 过滤条件
 * @param {string[]} [filter.manifestIds] manifest id 列表
 * @param {string[]} [filter.suiteSelectors] suite id 或 name
 * @param {{ prefixExpand?: boolean }} [options] 传给 suiteMatchesSelector
 * @returns {SuiteDef[]} 过滤后的 suite
 */
export function filterSuites(suites, { manifestIds, suiteSelectors }, { prefixExpand = true } = {}) {
	let out = suites
	if (manifestIds?.length)
		out = out.filter(s => manifestIds.includes(s.manifestId))
	if (suiteSelectors?.length) {
		// 精确命中某个 suite id/name 的 selector 不再前缀展开：
		// `fed_emoji` 只选 fed_emoji，而 `fed`（无同名 suite）仍展开为 fed_* / fed_*_*。
		const expandBySelector = new Map(suiteSelectors.map(sel => {
			const trimmed = sel.trim()
			const hasExact = out.some(s => s.id === trimmed || s.name === trimmed)
			return [sel, prefixExpand && !hasExact]
		}))
		out = out.filter(s => suiteSelectors.some(sel =>
			suiteMatchesSelector(s, sel, { prefixExpand: expandBySelector.get(sel) })))
	}
	return out
}

/**
 * 列出已知 manifest id。
 * @param {SuiteDef[]} suites 全部 suite
 * @returns {string[]} 排序后的 manifest id
 */
export function listManifestIds(suites) {
	return sortManifestIds([...new Set(suites.map(s => s.manifestId))], suites)
}

/**
 * 将 CLI manifest 指名解析为具体 id 列表（精确匹配、自动 `${id}/*`、glob）。
 * @param {string[]} selectors 用户输入的指名
 * @param {string[]} knownIds 已知 manifest id
 * @param {SuiteDef[]} allSuites 全部 suite（用于依赖排序）
 * @returns {{ manifestIds: string[], unmatched: string[] }} 解析结果
 */
export function resolveManifestSelectors(selectors, knownIds, allSuites) {
	/** @type {string[]} */
	const resolved = []
	/** @type {string[]} */
	const unmatched = []

	for (const raw of selectors) {
		const selector = raw.trim()
		if (!selector) continue

		if (knownIds.includes(selector)) {
			resolved.push(selector)
			continue
		}

		/** @type {string[]} */
		const patterns = []
		if (selector.includes('*') || selector.includes('?'))
			patterns.push(selector)
		else
			patterns.push(`${selector}/*`)

		let hits = []
		for (const pattern of patterns)
			hits = hits.concat(knownIds.filter(id => matchGlob(pattern, id)))

		if (hits.length)
			resolved.push(...hits)
		else
			unmatched.push(selector)
	}

	return {
		manifestIds: sortManifestIds([...new Set(resolved)], allSuites),
		unmatched,
	}
}
