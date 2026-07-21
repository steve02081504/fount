/**
 * Social live 测试 driver：按 suite 自启 fount 节点并运行 scripts/ 下对应脚本。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from 'fount/scripts/test/core/repo_root.mjs'
import { denoLiveRun } from 'fount/scripts/test/live/deno_run.mjs'
import { runLiveSuiteCli } from 'fount/scripts/test/live/runner.mjs'

const liveDir = dirname(fileURLToPath(import.meta.url))
const socialBootstrap = join(liveDir, '../node_bootstrap.mjs')
const scriptsDir = join(liveDir, 'scripts')

/** Social live 测试 suite 表。 */
/** @type {Record<string, { fed?: boolean, run: string[], node?: object }>} */
const suites = {
	smoke_social: {
		run: denoLiveRun(join(scriptsDir, 'smoke_social.mjs')),
		node: { loadParts: ['shells/social', 'shells/chat'], p2p: false, minP2pNode: true },
	},
	e2e_single: {
		run: denoLiveRun(join(scriptsDir, 'e2e_single.mjs')),
		node: { loadParts: ['shells/social', 'shells/chat'] },
	},
	cross_shell_emoji: {
		fed: true,
		run: denoLiveRun(join(scriptsDir, 'cross_shell_emoji.mjs')),
		node: { loadParts: ['shells/social', 'shells/chat'] },
	},
	ws: {
		run: denoLiveRun(join(scriptsDir, 'ws.mjs')),
		node: { loadParts: ['shells/social', 'shells/chat'] },
	},
}

await runLiveSuiteCli({
	suites,
	repoRoot: REPO_ROOT,
	defaultSuite: 'e2e_single',
	/**
	 * @param {number} index 0-based
	 * @param {{ port: number, releasePort: () => Promise<void> }} context 已分配端口
	 * @returns {object} launchNode 选项
	 */
	buildNode: (index, { port, releasePort }) => index === 0
		? {
			port,
			username: 'CI-user',
			apiKey: process.env.FOUNT_TEST_NODE_1_KEY || `fount-ci-social-key-${port}`,
			p2p: true,
			bootstrap: socialBootstrap,
			releasePort,
		}
		: {
			port,
			username: 'nodeb',
			apiKey: process.env.FOUNT_TEST_NODE_2_KEY || `nodeb-fed-test-key-${port}`,
			p2p: true,
			bootstrap: socialBootstrap,
			releasePort,
		},
})
