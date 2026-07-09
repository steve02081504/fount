/**
 * fount test CLI
 *
 *   fount test [--all] [--continue] [--outdated] [--no-parallel] [--force] [--since <commit>] [<groups>...]
 *
 * 分组语法：manifest、manifest:suite、manifest/suite（空格分隔多组）
 */
import 'fount/scripts/test/env.mjs'

import process from 'node:process'

import { geti18n } from '../i18n/bare.mjs'
import { ms } from '../ms.mjs'

import {
	listManifestIds,
	loadAllSuites,
	resolveManifestSelectors,
} from './core/manifest.mjs'
import { parseArgsOrExit } from './core/parse_args_or_exit.mjs'
import { REPO_ROOT } from './core/repo_root.mjs'
import { isBareSuiteContinuation, resolveSelector } from './core/selector.mjs'
import { runTests } from './runner/index.mjs'

const { positionals, values } = parseArgsOrExit({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		since: { type: 'string' },
		all: { type: 'boolean', default: false },
		continue: { type: 'boolean', default: false },
		outdated: { type: 'boolean', default: false },
		'no-parallel': { type: 'boolean', default: false },
		force: { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false },
	},
})

if (values.help || positionals.includes('help')) {
	console.log(geti18n('fountConsole.test.help'))
	process.exit(0)
}

/**
 * 将 CLI 选择器字符串按逗号/空白切分。
 * @param {string} raw 原始选择器串
 * @returns {string[]} 非空 token 列表
 */
function splitSelectors(raw) {
	return raw.split(/[,\s]+/).map(token => token.trim()).filter(Boolean)
}

/**
 * @typedef {{ manifestSelectors: string[], suiteSelectors: string[] }} GroupInput
 */

/**
 * 解析 CLI positional 为 manifest/suite 分组输入。
 * @param {string[]} args CLI positional
 * @param {string[]} knownIds 已知 manifest id
 * @param {import('./core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @returns {{ groups: GroupInput[] | undefined }} 分组输入；无 positional 时为 undefined
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
			}
			groups.push(current)
			continue
		}

		const manifestResolved = resolveManifestSelectors([token], knownIds, allSuites)
		if (manifestResolved.manifestIds.length) {
			current = { manifestSelectors: [token], suiteSelectors: [] }
			groups.push(current)
		}
		else if (isBareSuiteContinuation(token, knownIds) && current)
			current.suiteSelectors.push(...splitSelectors(token))
		else
			return { error: 'unknownFirstToken', token }
	}

	return { groups }
}

process.exit(await (async () => {
	const allSuites = await loadAllSuites(REPO_ROOT)
	const knownIds = listManifestIds(allSuites)
	const parsed = parseGroupSelectors(positionals, knownIds, allSuites)

	if ('error' in parsed) {
		console.errorI18n('fountConsole.test.unknownManifestId', { ids: parsed.token })
		console.errorI18n('fountConsole.test.available', { ids: knownIds.join(', ') })
		process.exit(2)
	}

	const runStarted = Date.now()
	const exitCode = await runTests({
		runAll: values.all,
		since: values.since,
		continueRun: values.continue,
		outdated: values.outdated,
		noParallel: values['no-parallel'],
		force: values.force,
		groups: parsed.groups,
	})
	if (Date.now() - runStarted > ms('5m'))
		process.stdout.write('\x07\x07\x07')
	return exitCode
})())
