/**
 * Social live 测试 driver：自启 fount 节点并运行 scripts/ 下对应脚本。
 */
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runLiveSuiteCli } from 'fount/scripts/test/live_suite_runner.mjs'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptsDir, '../../../../../../../')
const socialBootstrap = join(scriptsDir, '../node_bootstrap.mjs')

const nodeAPort = Number(process.env.FOUNT_TEST_NODE_A_PORT) || 8931
const nodeBPort = Number(process.env.FOUNT_TEST_NODE_B_PORT) || nodeAPort + 1

/** @type {Record<string, { fed?: boolean, run: string[], node?: object }>} */
const suites = {
	e2e_single: {
		run: ['pwsh', '-NoProfile', '-File', join(scriptsDir, 'scripts/e2e_single.ps1')],
		node: { loadParts: ['shells/social'] },
	},
	cross_shell_emoji: {
		fed: true,
		run: ['pwsh', '-NoProfile', '-File', join(scriptsDir, 'scripts/cross_shell_emoji.ps1')],
		node: { loadParts: ['shells/social', 'shells/chat'] },
	},
	ws_test: {
		run: ['node', join(scriptsDir, 'scripts/ws_test.mjs')],
		node: { loadParts: ['shells/social'] },
	},
}

await runLiveSuiteCli({
	suites,
	scriptsDir,
	repoRoot,
	defaultSuite: 'e2e_single',
	nodeA: {
		port: nodeAPort,
		username: 'CI-user',
		apiKey: process.env.FOUNT_TEST_NODE_A_KEY || `fount-ci-social-key-${nodeAPort}`,
		p2p: true,
		bootstrap: socialBootstrap,
	},
	nodeB: {
		port: nodeBPort,
		username: 'nodeb',
		apiKey: process.env.FOUNT_TEST_NODE_B_KEY || `nodeb-fed-test-key-${nodeBPort}`,
		p2p: true,
		bootstrap: socialBootstrap,
	},
})
