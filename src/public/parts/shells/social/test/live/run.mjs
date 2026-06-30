/**
 * Social live 测试 driver：自启 fount 节点并运行 scripts/ 下对应脚本。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from 'fount/scripts/test/core/repo_root.mjs'
import { runLiveSuiteCli } from 'fount/scripts/test/live/runner.mjs'
import { resolveLiveNodePorts } from 'fount/scripts/test/node/launch.mjs'

const liveDir = dirname(fileURLToPath(import.meta.url))
const socialBootstrap = join(liveDir, '../node_bootstrap.mjs')

const { nodeAPort, nodeBPort, releasePort } = await resolveLiveNodePorts()

/**
 * spawn 前释放节点 A 端口持有。
 * @returns {Promise<void>}
 */
const releaseHeldNodeAPort = () => releasePort(nodeAPort)
/**
 * spawn 前释放节点 B 端口持有。
 * @returns {Promise<void>}
 */
const releaseHeldNodeBPort = () => releasePort(nodeBPort)

/** Social live 测试 suite 表。 */
/** @type {Record<string, { fed?: boolean, run: string[], node?: object }>} */
const suites = {
	e2e_single: {
		run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/e2e_single.ps1')],
		node: { loadParts: ['shells/social'] },
	},
	cross_shell_emoji: {
		fed: true,
		run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/cross_shell_emoji.ps1')],
		node: { loadParts: ['shells/social', 'shells/chat'] },
	},
	ws_test: {
		// Node 无法解析 deno.json 的 fount/ 别名；改用 deno run 与 live runner 一致。
		run: ['deno', 'run', '--allow-all', '-c', join(REPO_ROOT, 'deno.json'), join(liveDir, 'scripts/ws_test.mjs')],
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
