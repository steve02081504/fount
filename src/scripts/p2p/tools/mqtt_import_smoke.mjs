import { initNode } from '../node/instance.mjs'

initNode({ nodeDir: './.mqtt-smoke-tmp' })
await import('../mqtt_room.mjs')
console.log('mqtt_room no server import OK')
