import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadDenylist, addDenylistEntry } from '../denylist.mjs'
import { loadNetwork } from '../network.mjs'
import { getNodeHash, ensureNodeDefaults } from '../node/identity.mjs'
import { initNode } from '../node/instance.mjs'

const nodeDir = path.join(tmpdir(), `fount_p2p_smoke_${Date.now().toString(36)}`)

initNode({ nodeDir })
ensureNodeDefaults()
const hash = getNodeHash()
if (!hash || hash.length !== 64) throw new Error('nodeHash invalid')
await addDenylistEntry({ scope: 'node', value: '0'.repeat(64) })
if (!loadDenylist().blocked.length) throw new Error('denylist failed')
if (!Array.isArray(loadNetwork().trustedPeers)) throw new Error('network failed')
console.log('p2p standalone smoke OK', hash.slice(0, 8))
