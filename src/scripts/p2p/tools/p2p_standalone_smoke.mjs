import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadBlocklist, addBlocklistEntry } from '../blocklist.mjs'
import { loadNetwork } from '../network.mjs'
import { getNodeHash, ensureNodeDefaults } from '../node/identity.mjs'
import { initNode } from '../node/instance.mjs'

const nodeDir = path.join(tmpdir(), `fount_p2p_smoke_${Date.now().toString(36)}`)

initNode({ nodeDir })
ensureNodeDefaults()
const hash = getNodeHash()
if (!hash || hash.length !== 64) throw new Error('nodeHash invalid')
await addBlocklistEntry({ scope: 'node', value: '0'.repeat(64) })
if (!loadBlocklist().blocked.length) throw new Error('blocklist failed')
if (!Array.isArray(loadNetwork().trustedPeers)) throw new Error('network failed')
console.log('p2p standalone smoke OK', hash.slice(0, 8))
