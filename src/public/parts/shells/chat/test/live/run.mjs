/**
 * Chat live 测试 driver：按 suite 自启 fount 节点并运行 scripts/ 下对应脚本。
 */
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from 'fount/scripts/test/core/repo_root.mjs'
import { denoLiveRun } from 'fount/scripts/test/live/deno_run.mjs'
import { runLiveSuiteCli } from 'fount/scripts/test/live/runner.mjs'
import { resolveLiveNodeFleet } from 'fount/scripts/test/node/launch.mjs'

const liveDir = dirname(fileURLToPath(import.meta.url))
const chatBootstrap = join(liveDir, '../node_bootstrap.mjs')
const chatFixtures = join(liveDir, 'fixtures/chars')
const liveFixtures = join(liveDir, 'fixtures')
const scriptsDir = join(liveDir, 'scripts')
const fedScripts = join(scriptsDir, 'federation')

/** 单节点 live 套件：不启 WebRTC/P2P 栈，仅离线 node 身份（避免 node-datachannel 与 p2p:live 叠加 OOM）。 */
const SINGLE_NODE_LIVE = { p2p: false, minP2pNode: true }

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

/** Chat live 测试 suite 表。 */
/** @type {Record<string, { fed?: boolean, run: string[], node?: object }>} */
const suites = {
	e2e_single: { run: denoLiveRun(join(scriptsDir, 'e2e_single.mjs')), node: SINGLE_NODE_LIVE },
	e2e_single_extended: { run: denoLiveRun(join(scriptsDir, 'e2e_single_extended.mjs')), node: SINGLE_NODE_LIVE },
	smoke_chat: { run: denoLiveRun(join(scriptsDir, 'smoke_chat.mjs')), node: SINGLE_NODE_LIVE },
	smoke_ai: { run: denoLiveRun(join(scriptsDir, 'smoke_ai.mjs')), node: SINGLE_NODE_LIVE },
	ws: { run: denoLiveRun(join(scriptsDir, 'ws.mjs')), node: SINGLE_NODE_LIVE },
	ws_read_marker: { run: denoLiveRun(join(scriptsDir, 'ws_read_marker.mjs')), node: SINGLE_NODE_LIVE },
	ws_rpc: { run: denoLiveRun(join(scriptsDir, 'ws_rpc.mjs')), node: SINGLE_NODE_LIVE },
	ws_stream: { run: denoLiveRun(join(scriptsDir, 'ws_stream.mjs')), node: SINGLE_NODE_LIVE },
	av_relay: { run: denoLiveRun(join(scriptsDir, 'av_relay.mjs')), node: SINGLE_NODE_LIVE },
	fed_core: { fed: true, run: denoLiveRun(join(fedScripts, 'core.mjs')) },
	fed_e2e_extended: { fed: true, run: denoLiveRun(join(fedScripts, 'e2e_extended.mjs')) },
	fed_dm: { fed: true, run: denoLiveRun(join(fedScripts, 'dm.mjs')) },
	fed_archive_month: { fed: true, run: denoLiveRun(join(fedScripts, 'archive_month.mjs')) },
	fed_mailbox: { fed: true, run: denoLiveRun(join(fedScripts, 'mailbox.mjs')) },
	fed_ban: { fed: true, fedNodes: 3, run: denoLiveRun(join(fedScripts, 'ban.mjs')) },
	fed_emoji: { fed: true, run: denoLiveRun(join(fedScripts, 'emoji.mjs')) },
	fed_emoji_nonmember: {
		fed: true,
		run: denoLiveRun(join(fedScripts, 'emoji_nonmember.mjs')),
		node: {
			loadParts: ['shells/chat', 'shells/social'],
			bootstrap: join(fedScripts, 'emoji_nonmember_bootstrap.mjs'),
		},
	},
	fed_emoji_nearcache: { fed: true, run: denoLiveRun(join(fedScripts, 'emoji_nearcache.mjs')) },
	fed_file_transfer: { fed: true, run: denoLiveRun(join(fedScripts, 'file_transfer.mjs')) },
	fed_control_plane: { fed: true, run: denoLiveRun(join(fedScripts, 'control_plane.mjs')) },
	fed_reputation_owner: { fed: true, run: denoLiveRun(join(fedScripts, 'reputation_owner.mjs')) },
	fed_entity_search: { fed: true, run: denoLiveRun(join(fedScripts, 'entity_search.mjs')) },
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
