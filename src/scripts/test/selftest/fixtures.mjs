/**
 * selftest 共用测试夹具：SuiteDef 与现状库条目构造器。
 */

/**
 * @param {string} [manifestId] manifest id
 * @param {string} [name] suite 名（同时作为 id）
 * @param {object} [options] 其余字段
 * @param {string[]} [options.dependsOn] 依赖选择器（manifest:suite 或同 manifest 内 name）
 * @param {string[]} [options.triggers] 触发 glob（默认 src/<manifestId>/**）
 * @returns {import('../core/manifest.mjs').SuiteDef} suite 定义
 */
export function makeSuite(manifestId = 'shells/chat', name = 'fed_core', { dependsOn = [], triggers, ...rest } = {}) {
	return {
		manifestId,
		name,
		id: name,
		run: [],
		triggers: triggers ?? [`src/${manifestId}/**`],
		manifestPath: '',
		heavy: false,
		dependsOn,
		dependencies: dependsOn.map(dep => {
			const colon = dep.indexOf(':')
			return colon >= 0
				? { manifestId: dep.slice(0, colon), name: dep.slice(colon + 1) }
				: { manifestId, name: dep }
		}),
		...rest,
	}
}

/**
 * @param {object} [overrides] 覆盖字段（status/baselineDurationMs/triggerHash/...）
 * @returns {import('../core/state.mjs').SuiteStateEntry} 现状库条目
 */
export function makeStateEntry(overrides = {}) {
	return {
		status: 'passed',
		commitHash: 'abc',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		baselineDurationMs: 1000,
		triggerHash: null,
		failedFiles: [],
		noiseHits: [],
		logPath: null,
		...overrides,
	}
}
