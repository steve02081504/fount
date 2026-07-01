/**
 * fount test CLI
 *
 *   fount test [--all] [--since <commit>] [<manifest-ids> [<suite-selectors>]]
 */
import process from 'node:process'
import { parseArgs } from 'node:util'

import { geti18n } from '../i18n.mjs'

import {
	listManifestIds,
	loadAllSuites,
	resolveManifestSelectors,
} from './core/manifest.mjs'
import { REPO_ROOT } from './core/repo_root.mjs'
import { runTests } from './runner/index.mjs'

// 后台异步错误（P2P/MQTT 瞬断等）不应中断测试编排进程
for (const event of ['uncaughtException', 'unhandledRejection'])
	process.on(event, err => console.error(`${event}: `, err))

const { positionals, values } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		since: { type: 'string' },
		all: { type: 'boolean', default: false },
		'gen-report': { type: 'boolean', default: false },
		jobs: { type: 'string', short: 'j' },
		help: { type: 'boolean', short: 'h', default: false },
	},
})

if (values.help || positionals.includes('help')) {
	console.log(geti18n('fountConsole.test.help'))
	process.exit(0)
}

/**
 * 逗号或空白分隔的 selector 列表（PowerShell 传参时逗号常被折叠为空格）。
 * @param {string} raw 原始片段
 * @returns {string[]} token 列表
 */
function splitSelectors(raw) {
	return raw.split(/[,\s]+/).map(token => token.trim()).filter(Boolean)
}

/**
 * 解析 CLI 位置参数为 manifest / suite 指名。
 * @param {string[]} args 位置参数
 * @returns {Promise<{ manifestSelectors: string[] | undefined, suiteSelectors: string[] | undefined }>} 解析后的指名
 */
async function parseCliSelectors(args) {
	if (!args.length)
		return { manifestSelectors: undefined, suiteSelectors: undefined }

	const firstTokens = splitSelectors(args[0])
	if (args.length >= 2) {
		const suites = args.slice(1).flatMap(splitSelectors)
		return {
			manifestSelectors: firstTokens.length ? firstTokens : undefined,
			suiteSelectors: suites.length ? suites : undefined,
		}
	}

	if (firstTokens.length === 1)
		return { manifestSelectors: firstTokens, suiteSelectors: undefined }

	const knownIds = listManifestIds(await loadAllSuites(REPO_ROOT))
	const resolved = resolveManifestSelectors(firstTokens, knownIds)
	return {
		manifestSelectors: resolved.manifestIds.length ? resolved.manifestIds : undefined,
		suiteSelectors: resolved.unmatched.length ? resolved.unmatched : undefined,
	}
}

const FIVE_MINUTES_MS = 5 * 60 * 1000
process.exit(await (async () => {
	const { manifestSelectors, suiteSelectors } = await parseCliSelectors(positionals)
	const runStarted = Date.now()
	const exitCode = await runTests({
		runAll: values.all,
		since: values.since,
		genReport: values['gen-report'],
		jobs: values.jobs ? Number(values.jobs) : undefined,
		manifestSelectors,
		suiteSelectors,
	})
	if (Date.now() - runStarted > FIVE_MINUTES_MS)
		process.stdout.write('\x07\x07\x07')
	return exitCode
})())
