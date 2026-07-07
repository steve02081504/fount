/**
 * fount test CLI
 *
 *   fount test [--all] [--continue] [--outdated] [--no-parallel] [--since <commit>] [<groups>...]
 *
 * 分组语法：manifest 或 manifest:suite1,suite2（空格分隔多组）
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
		help: { type: 'boolean', short: 'h', default: false },
	},
})

if (values.help || positionals.includes('help')) {
	console.log(geti18n('fountConsole.test.help'))
	process.exit(0)
}

/**
 * 逗号或空白分隔的 selector 列表（PowerShell 传参时逗号常被拆成独立 argv）。
 * @param {string} raw 原始片段
 * @returns {string[]} token 列表
 */
function splitSelectors(raw) {
	return raw.split(/[,\s]+/).map(token => token.trim()).filter(Boolean)
}

/**
 * @typedef {{ manifestSelectors: string[], suiteSelectors: string[] }} GroupInput
 */

/**
 * 解析分组冒号语法 positional 参数。
 * @param {string[]} args 位置参数
 * @param {string[]} knownIds 已知 manifest id
 * @param {import('./core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @returns {{ groups: GroupInput[] | undefined } | { error: 'unknownFirstToken', token: string }} 解析结果
 */
function parseGroupSelectors(args, knownIds, allSuites) {
	if (!args.length)
		return { groups: undefined }

	/** @type {GroupInput[]} */
	const groups = []
	/** @type {GroupInput | null} */
	let current = null

	for (const token of args)
		if (token.includes(':')) {
			const colon = token.indexOf(':')
			current = {
				manifestSelectors: [token.slice(0, colon)],
				suiteSelectors: splitSelectors(token.slice(colon + 1)),
			}
			groups.push(current)
		}
		else {
			const resolved = resolveManifestSelectors([token], knownIds, allSuites)
			if (resolved.manifestIds.length) {
				current = { manifestSelectors: [token], suiteSelectors: [] }
				groups.push(current)
			}
			else if (current)
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
		groups: parsed.groups,
	})
	if (Date.now() - runStarted > ms('5m'))
		process.stdout.write('\x07\x07\x07')
	return exitCode
})())
