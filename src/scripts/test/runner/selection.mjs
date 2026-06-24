import {
	failuresToSuiteMap,
	listFailedManifests,
	readFailures,
} from '../core/failures.mjs'
import { selectSuitesByDiff } from '../core/manifest.mjs'

/**
 * suite 选择结果。
 * @typedef {object} SuiteSelection
 * @property {'run' | 'exit'} action
 * @property {number} [code]
 * @property {import('../core/manifest.mjs').SuiteDef[]} [suites]
 * @property {Map<string, Map<string, string[] | undefined>>} [retryByManifest]
 * @property {boolean} [usingFailureRetry]
 */

/**
 * 按 suite 身份去重（manifestId + name）。
 * @param {import('../core/manifest.mjs').SuiteDef[]} suites 候选 suite
 * @returns {import('../core/manifest.mjs').SuiteDef[]} 去重后的 suite
 */
function dedupeSuites(suites) {
	const map = new Map()
	for (const suite of suites)
		map.set(`${suite.manifestId}\0${suite.name}`, suite)
	return [...map.values()]
}

/**
 * 从失败记录构建重跑 suite 列表。
 * @param {import('../core/manifest.mjs').SuiteDef[]} candidates 候选 suite
 * @param {Map<string, Map<string, string[] | undefined>>} retryByManifest 失败映射
 * @returns {import('../core/manifest.mjs').SuiteDef[]} 待重跑 suite
 */
function suitesFromFailureRetry(candidates, retryByManifest) {
	const retryManifestIds = [...retryByManifest.keys()]
	const allowedSuites = new Set([...retryByManifest.values()].flatMap(map => [...map.keys()]))
	return candidates.filter(suite =>
		retryManifestIds.includes(suite.manifestId) && allowedSuites.has(suite.name),
	)
}

/**
 * 选择本次应执行的 suite 集合。
 * @param {object} params 选择参数
 * @param {string} params.repoRoot 仓库根
 * @param {import('../core/manifest.mjs').SuiteDef[]} params.allSuites 全部 suite
 * @param {import('../core/manifest.mjs').SuiteDef[]} params.filtered manifest/suite 过滤后
 * @param {{ mode: string, files: string[] }} params.changed 变更文件解析结果
 * @param {boolean} params.runAll 是否全量
 * @param {string[]} [params.manifestIds] manifest id 列表
 * @param {string[]} [params.suiteSelectors] suite 指名
 * @param {string | null} params.currentHash 当前未提交 digest
 * @param {string[]} params.uncommittedFiles 未提交路径列表
 * @returns {Promise<SuiteSelection>} 选择结果
 */
export async function selectSuites({
	repoRoot,
	allSuites,
	filtered,
	changed,
	runAll,
	manifestIds,
	suiteSelectors,
	currentHash,
	uncommittedFiles,
}) {
	const explicitSuites = Boolean(suiteSelectors?.length)
	const singleManifest = manifestIds?.length === 1 ? manifestIds[0] : undefined
	const trackFailures = Boolean(singleManifest && !explicitSuites)

	const failureManifestIds = trackFailures && singleManifest
		? [singleManifest]
		: !manifestIds?.length && !runAll
			? await listFailedManifests(repoRoot)
			: []

	const retryByManifest = new Map()
	const failureRecords = new Map()
	for (const manifestId of failureManifestIds) {
		const record = await readFailures(repoRoot, manifestId)
		if (record?.items.length) {
			retryByManifest.set(manifestId, failuresToSuiteMap(record))
			failureRecords.set(manifestId, record)
		}
	}

	const usingFailureRetry = retryByManifest.size > 0

	if (runAll)
		return { action: 'run', suites: filtered, retryByManifest, usingFailureRetry }

	let selected = filtered

	if (usingFailureRetry) {
		selected = suitesFromFailureRetry(filtered, retryByManifest)
		console.log(`失败重跑: ${[...retryByManifest.keys()].join(', ')} (${selected.length} suites)`)

		const hashStale = uncommittedFiles.length > 0 && [...failureRecords.values()].some(record =>
			record.uncommittedHash == null || record.uncommittedHash !== currentHash,
		)
		if (hashStale && changed.mode === 'diff' && changed.files.length) {
			const merged = dedupeSuites([...selected, ...selectSuitesByDiff(changed.mode, changed.files, filtered)])
			console.log(`未提交 hash 变化，追加 diff: +${merged.length - selected.length} suites`)
			selected = merged
		}
	}
	else if (changed.mode === 'diff' && changed.files.length) {
		selected = selectSuitesByDiff(changed.mode, changed.files, filtered)
		console.log('diff 模式:', changed.files.length, 'files —',
			changed.files.slice(0, 12).join(', '),
			changed.files.length > 12 ? '...' : '')
	}
	else if (changed.mode === 'none' && !manifestIds?.length) {
		console.log('无未提交变更且未指定 --since：仅重跑存在失败记录的 suite。')
		console.log('提示: fount test --all | fount test --since <commit> | fount test shells/chat')
		if (!failureManifestIds.length) return { action: 'exit', code: 0 }
		selected = suitesFromFailureRetry(allSuites, retryByManifest)
		if (!selected.length) return { action: 'exit', code: 0 }
	}
	else if (changed.mode === 'none' && manifestIds?.length)
		console.log(`manifest ${manifestIds.join(',')} 无 diff 触发项；将运行其全部 suite。`)

	return { action: 'run', suites: selected, retryByManifest, usingFailureRetry }
}

/**
 * 是否启用失败列表读写。
 * @param {string[] | undefined} manifestIds manifest id 列表
 * @param {string[] | undefined} suiteSelectors suite 指名
 * @returns {boolean} 是否跟踪失败
 */
export function shouldTrackFailures(manifestIds, suiteSelectors) {
	return manifestIds?.length === 1 && !suiteSelectors?.length
}
