/**
 * Social live 测试 driver：自启 fount 节点并运行 scripts/ 下对应脚本。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from 'fount/scripts/test/core/repo_root.mjs'
import { denoLiveRun } from 'fount/scripts/test/live/deno_run.mjs'
import { runLiveSuiteCli } from 'fount/scripts/test/live/runner.mjs'
import { resolveLiveNodePorts } from 'fount/scripts/test/node/launch.mjs'

const liveDir = dirname(fileURLToPath(import.meta.url))
const socialBootstrap = join(liveDir, '../node_bootstrap.mjs')
const scriptsDir = join(liveDir, 'scripts')

const { nodeAPort, nodeBPort, releasePort } = await resolveLiveNodePorts()

/** @returns {Promise<void>} */
const releaseHeldNodeAPort = () => releasePort(nodeAPort)
/** @returns {Promise<void>} */
const releaseHeldNodeBPort = () => releasePort(nodeBPort)

/** Social live 测试 suite 表。 */
/** @type {Record<string, { fed?: boolean, run: string[], node?: object }>} */
const suites = {
	e2e_single: {
		run: denoLiveRun(join(scriptsDir, 'e2e_single.mjs')),
		node: { loadParts: ['shells/social'] },
	},
	cross_shell_emoji: {
		fed: true,
		run: denoLiveRun(join(scriptsDir, 'cross_shell_emoji.mjs')),
		node: { loadParts: ['shells/social', 'shells/chat'] },
	},
	ws: {
		run: denoLiveRun(join(scriptsDir, 'ws.mjs')),
		node: { loadParts: ['shells/social'] },
	},
}

await runLiveSuiteCli({
	suites,
	repoRoot: REPO_ROOT,
	defaultSuite: 'e2e_single',
	nodeA: {
		port: nodeAPort,
		username: 'CI-user',
		apiKey: process.env.FOUNT_TEST_NODE_1_KEY || `fount-ci-social-key-${nodeAPort}`,
		p2p: true,
		bootstrap: socialBootstrap,
		releasePort: releaseHeldNodeAPort,
	},
	nodeB: {
		port: nodeBPort,
		username: 'nodeb',
		apiKey: process.env.FOUNT_TEST_NODE_2_KEY || `nodeb-fed-test-key-${nodeBPort}`,
		p2p: true,
		bootstrap: socialBootstrap,
		releasePort: releaseHeldNodeBPort,
	},
})
