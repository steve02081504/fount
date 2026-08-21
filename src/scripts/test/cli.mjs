/**
 * fount test CLI
 *
 *   fount test [--watch]
 *   fount test [--all] [--force] [--debug] [<groups>...]
 *   fount test --update-estimates [<groups>...]
 *   fount test --list [<groups>...]
 *   fount test --kernel shutdown|reboot
 *
 * 选择器：名称 / 名称:suite / 名称:suite:子项（空格多组，逗号多 suite；/ 与 : 等价）
 */
import './mark.mjs'

import process from 'node:process'

import { console, geti18n } from '../i18n/bare.mjs'

import { sortManifestIds } from './core/dependencies.mjs'
import { formatDuration } from './core/format_duration.mjs'
import {
	filterSuites,
	listManifestIds,
	loadAllSuites,
	resolveManifestSelectors,
} from './core/manifest.mjs'
import { parseArgsOrExit } from './core/parse_args_or_exit.mjs'
import { REPO_ROOT } from './core/repo_root.mjs'
import { isBareSuiteContinuation, resolveSelector } from './core/selector.mjs'
import { readState } from './core/state.mjs'
import { updateManifestEstimates } from './core/update_estimates.mjs'
import { runTestDisplay } from './display/index.mjs'
import { ensureTestKernel, KERNEL_ACTIONS, rebootTestKernel, shutdownTestKernel } from './kernel/ensure.mjs'

const { positionals, values } = parseArgsOrExit({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		all: { type: 'boolean', default: false },
		force: { type: 'boolean', default: false },
		debug: { type: 'boolean', default: false },
		watch: { type: 'boolean', default: false },
		'update-estimates': { type: 'boolean', default: false },
		list: { type: 'boolean', default: false },
		kernel: { type: 'string' },
		help: { type: 'boolean', short: 'h', default: false },
	},
})

if (values.help || positionals.includes('help')) {
	console.log(geti18n('fountConsole.test.help'))
	process.exit(0)
}

if (values.kernel && (values.watch || values.all || values.force || values.debug || values['update-estimates'] || positionals.length)) {
	console.error(geti18n('fountConsole.test.kernel.incompatible'))
	process.exit(2)
}

if (values.kernel && !KERNEL_ACTIONS.has(values.kernel)) {
	console.errorI18n('fountConsole.test.kernel.unknownAction', { action: values.kernel })
	process.exit(2)
}

if (values['update-estimates'] && (values.watch || values.all || values.force || values.debug || values.list)) {
	console.error(geti18n('fountConsole.test.updateEstimates.incompatible'))
	process.exit(2)
}

if (values.list && (values.watch || values.all || values.force || values.debug || values.kernel)) {
	console.error(geti18n('fountConsole.test.list.incompatible'))
	process.exit(2)
}

if (values.watch && (values.all || values.force || values.debug || positionals.length)) {
	console.error(geti18n('fountConsole.test.watchNoGroups'))
	process.exit(2)
}

/**
 * 将 CLI 选择器字符串按逗号/空白切分。
 * @param {string} raw 原始选择器串
 * @returns {string[]} 非空 token 列表
 */
function splitSelectors(raw) {
	return raw.split(/[\s,]+/).map(token => token.trim()).filter(Boolean)
}

/**
 * @typedef {{ manifestSelectors: string[], suiteSelectors: string[], subtestSelectors: Record<string, string[]> }} GroupInput
 */

/**
 * 解析 CLI positional 为 manifest/suite/subtest 分组输入。
 * @param {string[]} args CLI positional
 * @param {string[]} knownIds 已知 manifest id
 * @param {import('./core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @returns {{ groups: GroupInput[] | undefined } | { error: string, token: string }} 分组输入
 */
function parseGroupSelectors(args, knownIds, allSuites) {
	if (!args.length)
		return { groups: undefined }

	/** @type {GroupInput[]} */
	const groups = []
	/** @type {GroupInput | null} */
	let current = null

	for (const token of args) {
		const resolved = resolveSelector(token, knownIds)
		if (resolved) {
			current = {
				manifestSelectors: [resolved.manifestId],
				suiteSelectors: resolved.suiteSelectors,
				subtestSelectors: resolved.subtestSelectors ?? {},
			}
			groups.push(current)
			continue
		}

		const manifestResolved = resolveManifestSelectors([token], knownIds, allSuites)
		if (manifestResolved.manifestIds.length) {
			current = { manifestSelectors: [token], suiteSelectors: [], subtestSelectors: {} }
			groups.push(current)
		}
		else if (isBareSuiteContinuation(token, knownIds) && current) {
			const parts = splitSelectors(token)
			for (const part of parts) {
				const colon = part.indexOf(':')
				if (colon < 0) {
					current.suiteSelectors.push(part)
					continue
				}
				const suite = part.slice(0, colon)
				const subtest = part.slice(colon + 1)
				if (!current.suiteSelectors.includes(suite))
					current.suiteSelectors.push(suite)
				if (subtest) {
					const list = current.subtestSelectors[suite] ?? []
					if (!list.includes(subtest)) list.push(subtest)
					current.subtestSelectors[suite] = list
				}
			}
		}
		else
			return { error: 'unknownFirstToken', token }
	}

	return { groups }
}

/**
 * 将已解析分组展开为去重 suite 列表。
 * @param {import('./core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @param {GroupInput[]} groups CLI 分组
 * @param {string[]} knownIds 已知 manifest id
 * @returns {import('./core/manifest.mjs').SuiteDef[]} 去重后的 suite
 */
function suitesFromGroups(allSuites, groups, knownIds) {
	const seen = new Map()
	for (const input of groups) {
		const resolved = resolveManifestSelectors(input.manifestSelectors, knownIds, allSuites)
		for (const suite of filterSuites(allSuites, {
			manifestIds: resolved.manifestIds,
			suiteSelectors: input.suiteSelectors.length ? input.suiteSelectors : undefined,
		}))
			seen.set(`${suite.manifestId}\0${suite.name}`, suite)
	}
	return [...seen.values()]
}

/**
 * 加载全部 suite 并解析 CLI 选择器；未知 token 直接退出。
 * @returns {Promise<{ allSuites: import('./core/manifest.mjs').SuiteDef[], knownIds: string[], parsed: Exclude<ReturnType<typeof parseGroupSelectors>, { error: string }> }>} 选择结果
 */
async function loadCliSelection() {
	const allSuites = await loadAllSuites(REPO_ROOT)
	const knownIds = listManifestIds(allSuites)
	const parsed = parseGroupSelectors(positionals, knownIds, allSuites)
	if ('error' in parsed) {
		console.errorI18n('fountConsole.test.unknown.manifestId', { ids: parsed.token })
		console.errorI18n('fountConsole.test.available', { ids: knownIds.join(', ') })
		process.exit(2)
	}
	return { allSuites, knownIds, parsed }
}

/**
 * 按 manifest id 分组并打印套件清单。
 * @param {import('./core/manifest.mjs').SuiteDef[]} suites 要列出的 suite
 * @returns {void}
 */
function printSuiteList(suites) {
	const byManifest = new Map()
	for (const suite of suites) {
		const group = byManifest.get(suite.manifestId) ?? []
		group.push(suite)
		byManifest.set(suite.manifestId, group)
	}
	for (const manifestId of sortManifestIds([...byManifest.keys()], suites)) {
		console.log(geti18n('fountConsole.test.list.header', { manifestId }))
		for (const suite of byManifest.get(manifestId)) {
			console.log(geti18n('fountConsole.test.list.suite', {
				name: suite.name,
				expected: suite.expectedMs != null
					? geti18n('fountConsole.test.list.expected', { expected: formatDuration(suite.expectedMs) })
					: '',
			}))
			for (const subtest of suite.subtests ?? [])
				console.log(geti18n('fountConsole.test.list.subtest', { name: subtest.name }))
		}
	}
}

process.exit(await (async () => {
	if (values.kernel === 'shutdown') {
		const status = await shutdownTestKernel()
		console.logI18n(status === 'already_down'
			? 'fountConsole.test.kernel.alreadyDown'
			: 'fountConsole.test.kernel.stopped')
		return 0
	}
	if (values.kernel === 'reboot') {
		await rebootTestKernel()
		console.logI18n('fountConsole.test.kernel.rebooted')
		return 0
	}

	if (values['update-estimates']) {
		const { allSuites, knownIds, parsed } = await loadCliSelection()
		const suites = parsed.groups ? suitesFromGroups(allSuites, parsed.groups, knownIds) : allSuites
		if (parsed.groups && !suites.length) {
			console.error(geti18n('fountConsole.test.noMatchingSuites'))
			process.exit(2)
		}
		const result = await updateManifestEstimates({
			repoRoot: REPO_ROOT,
			suites,
			state: await readState(REPO_ROOT),
		})
		console.logI18n('fountConsole.test.updateEstimates.summary', result)
		return 0
	}

	if (values.list) {
		const { allSuites, knownIds, parsed } = await loadCliSelection()
		const suites = parsed.groups ? suitesFromGroups(allSuites, parsed.groups, knownIds) : allSuites
		if (parsed.groups && !suites.length) {
			console.error(geti18n('fountConsole.test.noMatchingSuites'))
			process.exit(2)
		}
		printSuiteList(suites)
		return 0
	}

	await ensureTestKernel()
	if (values.watch)
		return runTestDisplay({ watch: true })

	const { parsed } = await loadCliSelection()
	return runTestDisplay({
		job: {
			runAll: values.all,
			force: values.force,
			debug: values.debug,
			groups: parsed.groups,
		},
	})
})())
