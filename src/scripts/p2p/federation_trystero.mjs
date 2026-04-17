/**
 * Trystero MQTT 联邦房间（与 shell 解耦，供 subfounts / 群聊复用）
 *
 * @param {object} config Trystero `joinRoom` 所需配置
 * @param {string} config.appId MQTT 应用标识
 * @param {typeof import('npm:node-datachannel/polyfill').RTCPeerConnection} config.rtcPolyfill WebRTC 构造函数 polyfill
 * @param {string} config.password 房间共享口令
 * @param {string} roomId 房间/频道 id（与对端一致方可互通）
 * @returns {Promise<unknown>} Trystero `joinRoom` 返回的房间对象（含信令与数据通道 API）
 */
export async function joinMqttRoom(config, roomId) {
	const { joinRoom } = await import('npm:trystero/mqtt')
	return joinRoom(config, roomId)
}
