/**
 * Chat live 测试 driver：按 suite 自启 fount 节点并运行 scripts/ 下对应脚本。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from 'fount/scripts/test/core/repo_root.mjs'
import { runLiveSuiteCli } from 'fount/scripts/test/live/runner.mjs'
import { resolveLiveNodePorts } from 'fount/scripts/test/node/launch.mjs'

const liveDir = dirname(fileURLToPath(import.meta.url))
const chatBootstrap = join(liveDir, '../node_bootstrap.mjs')
const chatFixtures = join(liveDir, 'fixtures/chars')

const { nodeAPort, nodeBPort } = await resolveLiveNodePorts()

/** Chat live 测试 suite 表。 */
/** @type {Record<string, { fed?: boolean, run: string[] }>} */
const suites = {
	e2e_single: { run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/e2e_single.ps1')] },
	e2e_single_ext: { run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/e2e_single_ext.ps1')] },
	smoke_chat: { run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/smoke_chat.ps1')] },
	smoke_ai: { run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/smoke_ai.ps1')] },
	ws_test: { run: ['node', join(liveDir, 'scripts/ws_test.mjs')] },
	ws_rpc_test: { run: ['node', join(liveDir, 'scripts/ws_rpc_test.mjs')] },
	ws_stream_test: { run: ['node', join(liveDir, 'scripts/ws_stream_test.mjs')] },
	av_relay_test: { run: ['node', join(liveDir, 'scripts/av_relay_test.mjs')] },
	fed_test: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_test.ps1')] },
	fed_e2e_ext: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_e2e_ext.ps1')] },
	fed_dm: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_dm.ps1')] },
	fed_archive_month: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_archive_month.ps1')] },
	fed_mailbox: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_mailbox.ps1')] },
	fed_ban: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_ban.ps1')] },
	fed_emoji: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_emoji.ps1')] },
	fed_emoji_nonmember: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_emoji_nonmember.ps1')] },
	fed_emoji_nearcache: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_emoji_nearcache.ps1')] },
	fed_file_transfer: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_file_transfer.ps1')] },
	fed_misc: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/fed_misc.ps1')] },
}

await runLiveSuiteCli({
	suites,
	repoRoot: REPO_ROOT,
	nodeA: {
		port: nodeAPort,
		username: 'CI-user',
		apiKey: process.env.FOUNT_TEST_NODE_A_KEY || `fount-ci-test-key-${nodeAPort}`,
		loadParts: ['shells/chat'],
		p2p: true,
		bootstrap: chatBootstrap,
		fixtureCopies: [{
			from: join(chatFixtures, 'test_streamer'),
			to: 'chars/test_streamer',
		}],
	},
	nodeB: {
		port: nodeBPort,
		username: 'nodeb',
		apiKey: process.env.FOUNT_TEST_NODE_B_KEY || `nodeb-fed-test-key-${nodeBPort}`,
		loadParts: ['shells/chat'],
		p2p: true,
		bootstrap: chatBootstrap,
	},
})
