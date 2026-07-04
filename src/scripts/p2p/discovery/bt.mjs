/**
 * Bluetooth discovery 仍未落地：这里只保留显式入口，避免运行时误以为已经支持。
 *
 * @returns {import('./index.mjs').DiscoveryProvider}
 */
export function createBluetoothDiscoveryProvider() {
	throw new Error('p2p: bluetooth discovery provider is not implemented yet')
}
