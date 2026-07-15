/**
 * 【文件】public/shared/avRelayPresets.mjs
 * 【职责】WebCodecs AV 采集/编码画质预设（thumb / low / med / high）。
 * 【关联】avRelayClient（默认 med）；hub/codecsAv（可选手动切换）
 */

/**
 * WebCodecs AV 采集/编码预设（分辨率、码率、帧率）。
 * @type {Record<string, { codec: string, w: number, h: number, bps: number, fps: number }>}
 */
export const CODECS_PRESETS = {
	thumb: { codec: 'vp8', w: 160, h: 120, bps: 64_000, fps: 5 },
	low: { codec: 'vp8', w: 320, h: 240, bps: 200_000, fps: 10 },
	med: { codec: 'vp8', w: 640, h: 480, bps: 600_000, fps: 15 },
	high: { codec: 'vp8', w: 1280, h: 720, bps: 1_500_000, fps: 30 },
}
