/**
 * fount test CLI
 *
 *   fount test [--all] [--since <commit>] [<manifest-ids> [<suite-selectors>]]
 */
import process from 'node:process'
import { parseArgs } from 'node:util'

import { geti18n } from '../i18n.mjs'

import { runTests } from './runner/index.mjs'

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

/** @type {string[] | undefined} */
let manifestSelectors
/** @type {string[] | undefined} */
let suiteSelectors

if (positionals.length >= 1)
	manifestSelectors = positionals[0].split(',').map(token => token.trim()).filter(Boolean)
if (positionals.length >= 2)
	suiteSelectors = positionals.slice(1).flatMap(raw => raw.split(',').map(token => token.trim()).filter(Boolean))

const FIVE_MINUTES_MS = 5 * 60 * 1000
const started = Date.now()
const exitCode = await runTests({
	runAll: values.all,
	since: values.since,
	genReport: values['gen-report'],
	jobs: values.jobs ? Number(values.jobs) : undefined,
	manifestSelectors,
	suiteSelectors,
})
if (Date.now() - started > FIVE_MINUTES_MS)
	process.stdout.write('\x07\x07\x07')
process.exit(exitCode)
