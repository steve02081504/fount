import { initNode } from '../node/instance.mjs'

initNode({ nodeDir: './.signaling-smoke-tmp' })
await import('../signaling_room.mjs')
console.log('signaling_room no server import OK')
