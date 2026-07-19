/**
 * Suite 资源画像：manifest 声明 + 运行时采样基线 + 命名推断（二维：mem × CPU%）。
 */
import { MiB } from './concurrency.mjs'

/**
 * @typedef {object} SuiteResources
 * @property {number} memMb  suite 子进程树峰值内存（MB，含 live 多 fount 进程总量）
 * @property {number} cpuPct 调度预算：预期占全机 CPU 的份额（0–100）
 */

/**
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('./state.mjs').SuiteStateEntry} SuiteStateEntry
 */

/**
 * manifest `resources` 原始字段 → 归一化。
 * @param {object | undefined} raw manifest resources
 * @returns {Partial<SuiteResources>} 部分资源
 */
export function parseManifestResources(raw) {
	if (!raw || typeof raw !== 'object') return {}
	return {
		...Number.isFinite(raw.memMb) && raw.memMb > 0 ? { memMb: Math.floor(raw.memMb) } : {},
		...Number.isFinite(raw.cpuPct) && raw.cpuPct >= 0 ? { cpuPct: Math.min(100, raw.cpuPct) } : {},
	}
}

/**
 * 按 manifest 路径/名称推断默认资源（无 `resources` 块时的回退）。
 * @param {SuiteDef} suite suite
 * @returns {SuiteResources} 默认资源
 */
export function inferDefaultResources(suite) {
	const { manifestId, name } = suite

	if (name === 'fed_ban') return { memMb: 1600, cpuPct: 45 }
	if (name.startsWith('fed_')) return { memMb: 1400, cpuPct: 35 }
	if (name === 'cross_shell_emoji') return { memMb: 1400, cpuPct: 40 }

	if (manifestId === 'shells/chat' || manifestId === 'shells/social') {
		if (name === 'integration') return { memMb: 1800, cpuPct: 25 }
		if (name === 'frontend') return { memMb: 1200, cpuPct: 30 }
		if (name === 'pure') return { memMb: 600, cpuPct: 12 }
		if (['e2e_single', 'e2e_single_extended', 'ws', 'ws_rpc', 'ws_stream', 'smoke_chat', 'smoke_ai', 'av_relay'].includes(name))
			return { memMb: 900, cpuPct: 22 }
	}

	if (manifestId === 'server' && name === 'live') return { memMb: 500, cpuPct: 20 }

	return { memMb: 400, cpuPct: 15 }
}

/**
 * 合并 manifest 声明、命名默认值与 state 采样基线。
 * 有可信采样时用采样（可被 manifest 声明抬高）；无采样才回退命名默认。
 * CPU 基线 < 1% 视为噪声（pidusage 空闲采样），忽略。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @returns {SuiteResources} 调度用资源
 */
export function resolveSuiteResources(suite, entry) {
	const declared = parseManifestResources(suite.resources)
	const defaults = inferDefaultResources(suite)
	const baselineMem = entry?.baselineMemMb > 0 ? entry.baselineMemMb : null
	const baselineCpu = entry?.baselineCpuPct >= 1 ? entry.baselineCpuPct : null
	return {
		memMb: Math.max(declared.memMb ?? 0, baselineMem ?? defaults.memMb),
		cpuPct: Math.max(declared.cpuPct ?? 0, baselineCpu ?? defaults.cpuPct),
	}
}

/**
 * @param {SuiteResources} resources 资源
 * @returns {number} 字节
 */
export function resourcesMemBytes(resources) {
	return resources.memMb * MiB
}

/**
 * 调度优先级：二维 footprint 较大者优先（BFD 填箱）。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @returns {number} 排序键
 */
export function suiteSchedulePriority(suite, entry) {
	const r = resolveSuiteResources(suite, entry)
	return Math.max(r.memMb, r.cpuPct)
}

/**
 * suite 是否通过 serial.mjs 在内部并行跑多文件（应下放 CPU/内存预算）。
 * @param {SuiteDef} suite suite
 * @returns {boolean} 是否经 serial.mjs 内部并行多文件
 */
export function suiteUsesSerialRunner(suite) {
	return suite.run.some(arg => String(arg).includes('serial.mjs'))
}
