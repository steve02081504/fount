/**
 * Chat live 测试 driver：按 suite 自启 fount 节点并运行 scripts/ 下对应脚本。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from 'fount/scripts/test/core/repo_root.mjs'
import { runLiveSuiteCli } from 'fount/scripts/test/live/runner.mjs'
import { resolveLiveNodeFleet } from 'fount/scripts/test/node/launch.mjs'

const liveDir = dirname(fileURLToPath(import.meta.url))
const chatBootstrap = join(liveDir, '../node_bootstrap.mjs')
const chatFixtures = join(liveDir, 'fixtures/chars')
const liveFixtures = join(liveDir, 'fixtures')

/** 联邦 live 套件默认双节点；个别套件可声明更大 fedNodes。 */
const FED_LIVE_MAX_NODES = 6
const { ports, releasePort } = await resolveLiveNodeFleet(FED_LIVE_MAX_NODES)

/**
 * @param {number} index 0-based 节点序号
 * @returns {() => Promise<void>} 释放该节点端口
 */
const releaseHeldPort = index => () => releasePort(ports[index])

/**
 * @param {number} index 0-based 节点序号
 * @param {object} [extra] 覆盖项
 * @returns {object} launchNode 选项
 */
function chatFedNodeConfig(index, extra = {}) {
	const port = ports[index]
	const nodeIndex = index + 1
	const username = index === 0 ? 'CI-user' : index === 1 ? 'nodeb' : `node${nodeIndex}`
	const envKeySuffix = nodeIndex === 1 ? 'A' : nodeIndex === 2 ? 'B' : String(nodeIndex)
	const apiKey = process.env[`FOUNT_TEST_NODE_${envKeySuffix}_KEY`]
		|| (index === 0
			? `fount-ci-test-key-${port}`
			: `node${nodeIndex}-fed-test-key-${port}`)
	return {
		port,
		username,
		apiKey,
		loadParts: ['shells/chat'],
		p2p: true,
		bootstrap: chatBootstrap,
		releasePort: releaseHeldPort(index),
		...index === 0
			? {
				fixtureCopies: [
					{ from: join(chatFixtures, 'test_streamer'), to: 'chars/test_streamer' },
					{ from: join(liveFixtures, 'worlds/test_world'), to: 'worlds/test_world' },
					{ from: join(liveFixtures, 'personas/test_persona'), to: 'personas/test_persona' },
				],
			}
			: {},
		...extra,
	}
}

const fedScripts = join(liveDir, 'scripts/federation')

/** Chat live 测试 suite 表。 */
/** @type {Record<string, { fed?: boolean, run: string[] }>} */
const suites = {
	e2e_single: { run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/e2e_single.ps1')] },
	e2e_single_ext: { run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/e2e_single_ext.ps1')] },
	smoke_chat: { run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/smoke_chat.ps1')] },
	smoke_ai: { run: ['pwsh', '-NoProfile', '-File', join(liveDir, 'scripts/smoke_ai.ps1')] },
	// 脚本 import fount/*，须 deno -c deno.json；node 无法解析 import map。
	ws_test: { run: ['deno', 'run', '--allow-all', '-c', join(REPO_ROOT, 'deno.json'), join(liveDir, 'scripts/ws_test.mjs')] },
	ws_rpc_test: { run: ['deno', 'run', '--allow-all', '-c', join(REPO_ROOT, 'deno.json'), join(liveDir, 'scripts/ws_rpc_test.mjs')] },
	ws_stream_test: { run: ['deno', 'run', '--allow-all', '-c', join(REPO_ROOT, 'deno.json'), join(liveDir, 'scripts/ws_stream_test.mjs')] },
	av_relay_test: { run: ['deno', 'run', '--allow-all', '-c', join(REPO_ROOT, 'deno.json'), join(liveDir, 'scripts/av_relay_test.mjs')] },
	fed_test: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'test.ps1')] },
	fed_e2e_ext: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'e2e_ext.ps1')] },
	fed_dm: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'dm.ps1')] },
	fed_archive_month: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'archive_month.ps1')] },
	fed_mailbox: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'mailbox.ps1')] },
	fed_ban: { fed: true, fedNodes: 3, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'ban.ps1')] },
	fed_emoji: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'emoji.ps1')] },
	fed_emoji_nonmember: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'emoji_nonmember.ps1')] },
	fed_emoji_nearcache: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'emoji_nearcache.ps1')] },
	fed_file_transfer: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'file_transfer.ps1')] },
	fed_control_plane: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'control_plane.ps1')] },
	fed_reputation_owner: { fed: true, run: ['pwsh', '-NoProfile', '-File', join(fedScripts, 'reputation_owner.ps1')] },
}

await runLiveSuiteCli({
	suites,
	repoRoot: REPO_ROOT,
	nodeA: chatFedNodeConfig(0),
	nodeB: chatFedNodeConfig(1),
	/**
	 * 第 index 个联邦节点的 launch 配置（index ≥ 2）。
	 * @param {number} index 0-based 节点序号
	 * @returns {object} launchNode 选项
	 */
	nodeFleet: index => chatFedNodeConfig(index),
})
