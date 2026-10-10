/**
 * 背景血肉与眼睛：片元着色器源码 + CPU 侧的眼睛模拟（睁闭、眨眼、扫视、瞳孔），每帧打包成 uniform。
 */
import { GLSL_NOISE } from '../scripts/lib/shaderCanvas.mjs'

/** 着色器里眼睛数组的容量。 */
const MAX_EYES = 48

/**
 * 血肉 + 眼睛片元着色器。坐标全部以 CSS 像素计（见 `fragPoint()`）。
 */
export const FLESH_FRAGMENT = `
uniform vec2 uPointer;
uniform float uLight;
uniform float uCorruption;
uniform float uPulse;
uniform float uLucid;
uniform float uShock;
uniform float uScroll;
uniform vec4 uVeil;
uniform float uDilate;
uniform int uEyeCount;
uniform vec4 uEyeA[${MAX_EYES}];
uniform vec4 uEyeB[${MAX_EYES}];
${GLSL_NOISE}

vec3 irisTint(float seed) {
	float pick = fract(seed * 7.13);
	if (pick < 0.4) return vec3(0.62, 0.45, 0.06);
	if (pick < 0.7) return vec3(0.22, 0.36, 0.12);
	if (pick < 0.88) return vec3(0.55, 0.02, 0.03);
	return vec3(0.75, 0.78, 0.8);
}

void main() {
	vec2 p = fragPoint();
	float aspect = uResolution.x / uResolution.y;
	vec2 uv = (p + vec2(0.0, uScroll * 0.25)) / uResolution.y;
	vec2 center = vec2(0.5 * aspect, 0.5);
	uv = center + (uv - center) * (1.0 - 0.018 * uPulse - 0.006 * sin(uTime * 0.7));
	float t = uTime * 0.03;
	vec2 shake = uShock * 0.04 * vec2(sin(uTime * 41.0), cos(uTime * 37.0));

	vec2 q = vec2(fbm(uv * 2.4 + vec2(0.0, t)), fbm(uv * 2.4 + vec2(5.2, 1.3) - t));
	vec2 r = vec2(fbm(uv * 2.4 + 3.6 * q + vec2(1.7, 9.2) + 0.7 * t), fbm(uv * 2.4 + 3.6 * q + vec2(8.3, 2.8) - 0.5 * t));
	vec2 surface = uv * 2.4 + 3.6 * r + shake;
	float f = fbm(surface);
	float probe = 3.6 / uResolution.y;
	vec2 slope = (vec2(fbm(surface + vec2(probe, 0.0)), fbm(surface + vec2(0.0, probe))) - f) / 1.5;
	float vein = ridge(uv * 6.0 + 2.2 * r, 10.0);
	float capillary = ridge(uv * 17.0 + 3.0 * q + 7.0, 16.0);

	vec3 col = mix(vec3(0.03, 0.0, 0.006), vec3(0.4, 0.025, 0.055), smoothstep(0.25, 0.75, f));
	col = mix(col, vec3(0.8, 0.55, 0.45), smoothstep(0.64, 0.95, f) * 0.5);
	col = mix(col, vec3(0.3, 0.28, 0.03), smoothstep(0.5, 0.85, q.x * r.y * 1.6) * 0.22);
	col = mix(col, vec3(0.07, 0.015, 0.1), vein * 0.75);
	col = mix(col, vec3(0.22, 0.0, 0.04), capillary * 0.45);

	vec3 normal = normalize(vec3(-slope * 55.0, 1.0));
	vec3 toLight = vec3(uPointer - p, 200.0);
	float distance2 = dot(toLight.xy, toLight.xy);
	toLight = normalize(toLight);
	float attenuation = uLight / (1.0 + distance2 / (240.0 * 240.0));
	float diffuse = max(dot(normal, toLight), 0.0);
	float specular = pow(max(dot(reflect(-toLight, normal), vec3(0.0, 0.0, 1.0)), 0.0), 36.0);
	float ambient = mix(0.1, 0.55, uCorruption) + 0.12 * uPulse;
	col = col * (ambient + diffuse * attenuation * 1.8) + specular * attenuation * vec3(1.0, 0.82, 0.78) * 0.7;

	float pinholes = 0.0;
	for (int i = 0; i < ${MAX_EYES}; i++) {
		if (i >= uEyeCount) break;
		vec4 a = uEyeA[i];
		vec4 b = uEyeB[i];
		vec2 d = p - a.xy;
		float radius = a.z;
		vec2 lookScreen = b.xy;
		pinholes += smoothstep(3.2, 1.8, length(p - a.xy - lookScreen * radius * 0.25)) * step(0.3, a.w);
		if (dot(d, d) > radius * radius * 2.4) continue;
		float c = cos(b.z), s = sin(b.z);
		vec2 l = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / radius;
		vec2 look = vec2(c * lookScreen.x + s * lookScreen.y, -s * lookScreen.x + c * lookScreen.y);
		float ring = length(l * vec2(0.92, 1.7));
		float socket = smoothstep(1.5, 0.85, ring) * smoothstep(-0.1, 0.4, a.w + 0.15);
		col *= 1.0 - 0.6 * socket;
		col += vec3(0.3, 0.05, 0.05) * socket * pow(abs(sin(ring * 22.0 - b.w * 9.0)), 10.0) * 0.25;

		float lid = a.w * 0.6 * max(1.0 - l.x * l.x, 0.0);
		float inside = step(abs(l.x), 1.0) * smoothstep(lid, lid - 0.04, abs(l.y));
		float lashes = smoothstep(0.07, 0.0, abs(abs(l.y) - lid)) * step(abs(l.x), 1.0) * socket;
		col = mix(col, vec3(0.015, 0.0, 0.0), lashes * 0.85);
		if (inside <= 0.0) continue;

		vec2 il = l - look * 0.42;
		float ir = length(il);
		float irisRadius = 0.4;
		vec3 sclera = vec3(0.86, 0.79, 0.64);
		sclera = mix(sclera, vec3(0.75, 0.12, 0.08), ridge(l * 7.0 + b.w * 13.0, 9.0) * smoothstep(0.25, 1.0, length(l)) * 0.8);
		sclera *= 0.5 + 0.5 * smoothstep(1.0, 0.15, length(l * vec2(1.0, 1.4)));
		vec3 iris = irisTint(b.w);
		float angle = atan(il.y, il.x);
		iris *= 0.45 + 0.9 * noise(vec2(angle * 7.0, ir * 16.0) + b.w * 31.0);
		iris *= 1.0 - 0.75 * smoothstep(irisRadius * 0.72, irisRadius, ir);
		float pupilRadius = mix(0.1, 0.3, uDilate);
		float goat = step(0.74, fract(b.w * 3.7));
		float pupilDistance = mix(length(il), length(il * vec2(0.5, 2.6)), goat);
		vec3 eye = mix(sclera, iris, smoothstep(irisRadius, irisRadius - 0.03, ir));
		eye = mix(eye, vec3(0.0), smoothstep(pupilRadius, pupilRadius - 0.025, pupilDistance));
		eye *= 0.4 + 0.6 * smoothstep(0.0, 0.2, lid - abs(l.y));
		eye += smoothstep(0.075, 0.0, length(il - vec2(-0.13, -0.13))) * 0.9;
		eye *= clamp(0.25 + ambient * 1.2 + attenuation * 1.6, 0.0, 1.3);
		col = mix(col, eye, inside);
	}

	float column = smoothstep(uVeil.y, uVeil.y + uVeil.z, abs(p.x - uVeil.x));
	col *= mix(1.0 - uVeil.w, 1.0, column);
	col *= mix(0.45, 1.0, uCorruption);

	vec2 screen = p / uResolution - 0.5;
	col *= 1.0 - 0.75 * pow(length(screen * vec2(1.05, 1.25)) * 1.25, 2.4);
	col = mix(col, vec3(length(col) * 0.9, 0.0, 0.02), uShock * 0.6);

	vec3 paper = vec3(0.925, 0.915, 0.895);
	paper -= 0.035 * step(0.97, fract(p.x / 32.0)) + 0.035 * step(0.97, fract(p.y / 32.0));
	paper -= 0.04 * pow(length(screen) * 1.3, 2.0);
	paper = mix(paper, vec3(0.05, 0.03, 0.03), clamp(pinholes, 0.0, 1.0));
	col = mix(col, paper, uLucid);

	col += (hash21(p + fract(uTime) * 311.0) - 0.5) * mix(0.06, 0.025, uLucid);
	fragColor = vec4(max(col, 0.0), 1.0);
}
`

/**
 * 可复现的伪随机数发生器（mulberry32），保证每次布局的眼睛排列一致又互不相同。
 * @param {number} seed 种子。
 * @returns {() => number} [0, 1) 随机数。
 */
function random(seed) {
	return () => {
		seed |= 0
		seed = seed + 0x6D2B79F5 | 0
		let value = Math.imul(seed ^ seed >>> 15, 1 | seed)
		value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
		return ((value ^ value >>> 14) >>> 0) / 4294967296
	}
}

/**
 * 在视口里撒眼睛：互不重叠，大小有长尾；第一只是一只大眼睛，最先睁开。
 * @param {number} width 视口宽（CSS 像素）。
 * @param {number} height 视口高（CSS 像素）。
 * @returns {object[]} 眼睛状态数组。
 */
function scatterEyes(width, height) {
	const next = random(0x5A7A)
	const eyes = []
	const target = Math.min(MAX_EYES, Math.max(12, Math.round(width * height / 24000)))
	/**
	 * 抽一只眼睛的半径：第一只固定为大眼，其余多数很小、少数很大。
	 * @param {number} index 第几只。
	 * @returns {number} 半径（CSS 像素）。
	 */
	const placeRadius = index => {
		if (index === 0) return Math.min(width, height) * 0.13
		const roll = next()
		if (roll < 0.06) return 70 + next() * 60
		if (roll < 0.3) return 30 + next() * 26
		return 9 + next() * 18
	}
	for (let index = 0, attempts = 0; eyes.length < target && attempts < 4000; attempts++) {
		const radius = placeRadius(index)
		const x = index === 0 ? width * 0.8 : next() * width
		const y = index === 0 ? height * 0.3 : next() * height
		if (eyes.some(eye => Math.hypot(eye.x - x, eye.y - y) < (eye.radius + radius) * 1.35 + 8)) continue
		eyes.push({
			x, y, radius,
			angle: next() < 0.12 ? Math.PI / 2 + (next() - 0.5) * 0.3 : (next() - 0.5) * 0.5,
			seed: next(),
			threshold: index === 0 ? 0.015 : 0.04 + next() ** 1.3 * 0.9,
			stares: next() < 0.1,
			open: 0,
			lookX: 0, lookY: 0, targetX: 0, targetY: 0,
			saccadeIn: next(),
			blinkIn: 2 + next() * 7,
			blinking: 0,
		})
		index++
	}
	return eyes
}

/**
 * 眼睛模拟器：每帧按指针、腐化程度、平静区与“离开”状态推进，再输出着色器 uniform。
 * @returns {{ step: Function, uniforms: Function, watching: () => number }} 模拟器。
 */
export function createEyes() {
	let eyes = [], width = 0, height = 0, groupBlinkIn = 18
	const eyeA = new Float32Array(MAX_EYES * 4)
	const eyeB = new Float32Array(MAX_EYES * 4)

	return {
		/**
		 * 推进一帧。
		 * @param {object} state 帧状态。
		 * @param {number} state.delta 帧间隔（秒）。
		 * @param {number} state.width 视口宽。
		 * @param {number} state.height 视口高。
		 * @param {number} state.corruption 腐化程度 0..1。
		 * @param {{ x: number, y: number, present: boolean, idle: number }} state.pointer 指针。
		 * @param {boolean} state.calm 指针停在“出路”段落上：眼睛垂下。
		 */
		step({ delta, width: nextWidth, height: nextHeight, corruption, pointer, calm }) {
			if (Math.abs(nextWidth - width) > 40 || Math.abs(nextHeight - height) > 120) {
				const previous = eyes
				eyes = scatterEyes(nextWidth, nextHeight)
				eyes.forEach((eye, index) => { eye.open = previous[index]?.open ?? 0 })
				width = nextWidth
				height = nextHeight
			}
			groupBlinkIn -= delta
			const groupBlink = groupBlinkIn < 0
			if (groupBlink) groupBlinkIn = 14 + Math.random() * 18
			const stare = pointer.present ? Math.min(1, Math.max(0, (pointer.idle - 3) / 4)) : 1
			for (const eye of eyes) {
				eye.blinkIn -= delta
				if (eye.blinkIn < 0 || groupBlink) {
					eye.blinking = 0.13
					eye.blinkIn = 2.5 + Math.random() * 8 - stare * 2
				}
				eye.blinking = Math.max(0, eye.blinking - delta)
				const awake = corruption > eye.threshold
				let target = awake ? 1 + stare * 0.3 : 0
				if (calm) target *= 0.12
				if (eye.blinking > 0) target = 0
				const speed = eye.blinking > 0 ? 28 : target > eye.open ? eye.open < 0.3 ? 0.9 : 3 : 6
				eye.open += (target - eye.open) * Math.min(1, speed * delta)

				eye.saccadeIn -= delta
				if (eye.saccadeIn < 0) {
					eye.saccadeIn = 0.12 + Math.random() * 0.7
					if (eye.stares) [eye.targetX, eye.targetY] = [(Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08]
					else {
						const dx = pointer.x - eye.x, dy = pointer.y - eye.y
						const distance = Math.hypot(dx, dy) || 1
						const reach = Math.min(1, distance / (eye.radius * 3)) * (calm ? 0.4 : 1)
						const sign = calm ? -1 : 1
						eye.targetX = sign * dx / distance * reach + (Math.random() - 0.5) * 0.06
						eye.targetY = sign * dy / distance * reach + (Math.random() - 0.5) * 0.06
					}
				}
				const snap = Math.min(1, 26 * delta)
				eye.lookX += (eye.targetX - eye.lookX) * snap
				eye.lookY += (eye.targetY - eye.lookY) * snap
			}
		},
		/**
		 * 打包给着色器的 uniform。
		 * @returns {Record<string, number | Float32Array>} uniform。
		 */
		uniforms() {
			const count = Math.min(MAX_EYES, eyes.length)
			for (let index = 0; index < count; index++) {
				const eye = eyes[index]
				eyeA.set([eye.x, eye.y, eye.radius, eye.open], index * 4)
				eyeB.set([eye.lookX, eye.lookY, eye.angle, eye.seed], index * 4)
			}
			return { uEyeCount: count, uEyeA: eyeA, uEyeB: eyeB }
		},
		/**
		 * @returns {number} 当前睁着的眼睛数。
		 */
		watching() {
			return eyes.filter(eye => eye.open > 0.5).length
		},
	}
}
