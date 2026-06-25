/**
 * fount test CLI
 *
 *   fount test [--all] [--since <commit>] [<manifest-ids> [<suite-selectors>]]
 */
import process from 'node:process'
import { parseArgs } from 'node:util'

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
	console.log(`\
usage: fount test [--all] [--gen-report] [-j <n>] [--since <commit>] [<manifest-ids> [<suite-selectors>]]

manifest id 来自各 test/manifest.json 顶层 "id" 字段。
多个 manifest id 用逗号分隔（勿用空格）：shells/chat,shells/social
无精确匹配时自动按「<指名>/*」展开（如 shells → shells/chat,shells/social）；
亦支持 glob（*、?、**），例如 shells/*、**。

suite 指名匹配各 suite 的 id 或 name，同样用逗号分隔。

在未提交修改时仅运行 diff 触发的测试；工作区干净时用 --since 对比 commit。
指定 manifest id 时启用失败记录（data/test/failures/）；存在失败记录时优先重跑失败项（与 suite 指名取交集）。

--gen-report  将失败/噪声 suite 输出落盘并生成 data/test/report/report.md + report.json。
-j, --jobs    全局并发上限（默认 CPU 线程数）。

examples:
  fount test
  fount test --all
  fount test --all --gen-report
  fount test p2p,shells/chat,shells/social --all --gen-report -j 16
  fount test shells/chat
  fount test shells
  fount test shells/*
  fount test shells/chat,shells/social
  fount test shells/chat frontend
  fount test shells/chat unit,fed_test
  fount test p2p
  fount test --since abc1234
`)
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
