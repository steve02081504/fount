/**
 * 【文件】public/src/views/benchmarks.mjs — 基准测试视图
 * 【职责】管理基准定义的增删改查、运行配置与结果展示。
 * 【原理】定义存于 shell data；运行经 `/benchmarks/:id/run`；角色下拉复用共享 `state.chars`。
 * 【关联】endpoints.mjs、state.mjs、index.html。
 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { confirmAction, promptText } from '/scripts/features/promptDialog.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { reloadBenchmarks as reloadBenchmarkStore } from '../data.mjs'
import {
	createBenchmark,
	deleteBenchmark,
	getBenchmark,
	getRun,
	listRuns,
	runBenchmark,
	updateBenchmark,
} from '../endpoints.mjs'
import { bindActivate } from '../lib/activate.mjs'
import { fillCharOptions } from '../lib/charOptions.mjs'
import { mountEmptyState } from '../lib/emptyState.mjs'
import { truncate } from '../lib/format.mjs'
import { state } from '../state.mjs'
import { renderTemplate } from '../templates.mjs'

/**
 * 绑定基准视图内的静态控件。
 * @returns {void}
 */
export function initBenchmarksView() {
	document.getElementById('newBenchmarkButton')?.addEventListener('click', () => {
		void newBenchmark().catch(error => showToastI18n('error', 'agent_studio.alerts.saveFailed', { message: error.message }))
	})
	document.getElementById('saveBenchmarkButton')?.addEventListener('click', () => {
		void saveBenchmarkCases().catch(error => showToastI18n('error', 'agent_studio.alerts.saveFailed', { message: error.message }))
	})
	document.getElementById('deleteBenchmarkButton')?.addEventListener('click', () => {
		void removeBenchmark().catch(error => showToastI18n('error', 'agent_studio.alerts.saveFailed', { message: error.message }))
	})
	document.getElementById('runBenchmarkButton')?.addEventListener('click', () => { void runCurrentBenchmark() })
}

/**
 * 加载基准视图。
 * @returns {Promise<void>}
 */
export async function loadBenchmarks() {
	await renderBenchmarkList()
	renderRunCharOptions()
	if (state.activeBenchmarkId && state.benchmarks.some(benchmark => benchmark.id === state.activeBenchmarkId))
		await selectBenchmark(state.activeBenchmarkId)
	else {
		state.activeBenchmarkId = null
		showPlaceholder()
	}
}

/**
 * 渲染基准定义列表。
 * @returns {Promise<void>}
 */
async function renderBenchmarkList() {
	const list = document.getElementById('benchmarkList')
	const empty = document.getElementById('benchmarkEmpty')
	if (!list || !empty) return
	list.replaceChildren()
	for (const benchmark of state.benchmarks) {
		const item = await renderTemplate('benchmark_item', {
			id: benchmark.id,
			name: benchmark.name,
			description: benchmark.description || '',
			caseCount: String(benchmark.caseCount ?? 0),
		})
		item.classList.toggle('active', benchmark.id === state.activeBenchmarkId)
		bindActivate(item, () => {
			selectBenchmark(benchmark.id).catch(error => showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message }))
		})
		list.appendChild(item)
	}
	empty.classList.toggle('hidden', state.benchmarks.length > 0)
	if (!state.benchmarks.length)
		await mountEmptyState(empty, { titleKey: 'agent_studio.benchmarks.empty', iconClass: 'icon-benchmark' })
}

/**
 * 显示未选基准的占位。
 * @returns {void}
 */
function showPlaceholder() {
	document.getElementById('benchmarkDetail')?.classList.add('hidden')
	const placeholder = document.getElementById('benchmarkPlaceholder')
	if (!placeholder) return
	placeholder.classList.remove('hidden')
	void mountEmptyState(placeholder, {
		titleKey: 'agent_studio.benchmarks.pick',
		iconClass: 'icon-benchmark',
	})
}

/**
 * 选择基准并加载其定义与最近一次运行。
 * @param {string} id 基准 id
 * @returns {Promise<void>}
 */
async function selectBenchmark(id) {
	state.activeBenchmarkId = id
	for (const item of document.querySelectorAll('#benchmarkList .benchmark-item'))
		item.classList.toggle('active', item.dataset.benchmarkId === id)
	document.getElementById('benchmarkPlaceholder')?.classList.add('hidden')
	document.getElementById('benchmarkDetail')?.classList.remove('hidden')
	const benchmark = await getBenchmark(id)
	const title = document.getElementById('benchmarkTitle')
	if (title) title.textContent = benchmark.name
	const cases = document.getElementById('benchmarkCasesText')
	if (cases instanceof HTMLTextAreaElement)
		cases.value = JSON.stringify(benchmark.cases ?? [], null, '\t')
	const runs = await listRuns({ benchmarkId: id })
	await renderRunResults(runs.length ? await getRun(runs[0].id) : null)
}

/**
 * 重新加载基准列表并保持当前选择。
 * @returns {Promise<void>}
 */
async function reloadBenchmarks() {
	await reloadBenchmarkStore()
	await renderBenchmarkList()
}

/**
 * 新建基准定义。
 * @returns {Promise<void>}
 */
async function newBenchmark() {
	const name = await promptText('agent_studio.benchmarks.newName')
	if (!name) return
	const created = await createBenchmark({ name, description: '', cases: [] })
	await reloadBenchmarks()
	await selectBenchmark(created.id)
}

/**
 * 保存基准定义的用例（从 JSON 文本框解析）。
 * @returns {Promise<void>}
 */
async function saveBenchmarkCases() {
	if (!state.activeBenchmarkId) return
	const textarea = document.getElementById('benchmarkCasesText')
	let cases
	try {
		const parsed = JSON.parse(textarea instanceof HTMLTextAreaElement ? textarea.value || '[]' : '[]')
		if (!Array.isArray(parsed)) throw new TypeError('用例必须是 JSON 数组')
		cases = parsed
	}
	catch (error) {
		showToastI18n('error', 'agent_studio.benchmarks.casesInvalid', { message: error.message })
		return
	}
	await updateBenchmark(state.activeBenchmarkId, { cases })
	await reloadBenchmarks()
	showToastI18n('success', 'agent_studio.benchmarks.saved')
}

/**
 * 删除当前基准定义。
 * @returns {Promise<void>}
 */
async function removeBenchmark() {
	if (!state.activeBenchmarkId) return
	if (!await confirmAction('agent_studio.benchmarks.deleteConfirm')) return
	await deleteBenchmark(state.activeBenchmarkId)
	state.activeBenchmarkId = null
	await reloadBenchmarks()
	showPlaceholder()
}

/**
 * 填充运行角色下拉。
 * @returns {void}
 */
function renderRunCharOptions() {
	const select = document.getElementById('runCharSelect')
	if (!(select instanceof HTMLSelectElement)) return
	fillCharOptions(select)
	if (state.activeCharId && state.chars.some(char => char.id === state.activeCharId))
		select.value = state.activeCharId
}

/**
 * 运行当前基准定义。
 * @returns {Promise<void>}
 */
async function runCurrentBenchmark() {
	if (!state.activeBenchmarkId) return
	const charSelect = document.getElementById('runCharSelect')
	const judgeInput = document.getElementById('runJudgeSource')
	const button = document.getElementById('runBenchmarkButton')
	if (!(charSelect instanceof HTMLSelectElement) || !charSelect.value) {
		showToastI18n('warning', 'agent_studio.benchmarks.selectCharFirst')
		return
	}
	if (button instanceof HTMLButtonElement) button.disabled = true
	try {
		const run = await runBenchmark(state.activeBenchmarkId, {
			charId: charSelect.value,
			judgeAiSource: judgeInput instanceof HTMLInputElement && judgeInput.value ? judgeInput.value : undefined,
		})
		await renderRunResults(run)
		showToastI18n('success', 'agent_studio.benchmarks.runDone')
	}
	catch (error) {
		showToastI18n('error', 'agent_studio.alerts.runFailed', { message: error.message })
	}
	finally {
		if (button instanceof HTMLButtonElement) button.disabled = false
	}
}

/**
 * 渲染某次基准运行的结果。
 * @param {object | null} run 运行
 * @returns {Promise<void>}
 */
async function renderRunResults(run) {
	const stats = document.getElementById('benchmarkStats')
	if (stats)
		stats.textContent = run
			? geti18n('agent_studio.benchmarks.stats', {
				total: run.stats?.total ?? 0,
				empty: run.stats?.empty ?? 0,
				avgLength: run.stats?.avgLength ?? 0,
				avgScore: run.stats?.avgScore ?? '-',
				judged: run.stats?.judged ?? 0,
			})
			: ''
	const list = document.getElementById('benchmarkResults')
	const empty = document.getElementById('benchmarkResultsEmpty')
	if (!list || !empty) return
	list.replaceChildren()
	const results = run?.results ?? []
	empty.classList.toggle('hidden', results.length > 0)
	if (!results.length) {
		await mountEmptyState(empty, { titleKey: 'agent_studio.benchmarks.noResults' })
		return
	}
	for (const result of results) {
		const score = result.judge?.score
		list.appendChild(await renderTemplate('result_item', {
			caseId: result.caseId,
			status: score == null ? geti18n('agent_studio.benchmarks.notJudged') : String(score),
			badgeClass: score == null ? 'badge-ghost' : 'badge-primary',
			response: truncate(result.response, 500),
			judgeText: result.judge?.reason || '',
		}))
	}
}
