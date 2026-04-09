/**
 * Trystero MQTT 联邦房间（与 shell 解耦，供 subfounts / 群聊复用）
 * @param {object} config
 * @param {string} config.appId
 * @param {typeof import('npm:node-datachannel/polyfill').RTCPeerConnection} config.rtcPolyfill
 * @param {string} config.password
 * @param {string} roomId
 */
export async function joinMqttRoom(config, roomId) {
	const { joinRoom } = await import('npm:trystero/mqtt')
	return joinRoom(config, roomId)
}
