/**
 * 从屏幕边缘探进来的触手：Verlet 链 + 距离约束 + 沿长度传播的蠕动波，尖端追着指针。
 * WebGL2 管体网格绘制，与背景血肉同一套质感与指针光照；没被照到的部分是透明的——它们一直在黑暗里，只在光下现形。
 */
import { GLSL_NOISE, createProgram, uniformSetters } from '../scripts/lib/shaderCanvas.mjs'

const SEGMENTS = 30
const ITERATIONS = 5
/** 管体截面的边数（另加一列接缝顶点，让 UV 连续）。 */
const SIDES = 22
const RING = SIDES + 1
/** 渲染时在每两节骨架之间用 Catmull-Rom 插几圈，让管体轮廓圆滑。 */
const SUBDIVISION = 3
const RINGS = (SEGMENTS - 1) * SUBDIVISION + 1
/** 每个顶点：位置 3 + 法线 3 + 弧长 + 截面角 + 半径 + 沿长比例。 */
const STRIDE = 10
/** 触手锚点：`[x, y, 伸入角度]`，x / y 是视口比例（超出 0~1 即锚在画面外）。 */
const ANCHORS = [
	[-0.03, 0.22, 0], [-0.03, 0.62, 0], [-0.03, 0.93, -0.5],
	[1.03, 0.12, Math.PI], [1.03, 0.48, Math.PI], [1.03, 0.84, Math.PI + 0.4],
	[0.18, 1.04, -Math.PI / 2], [0.85, 1.04, -Math.PI / 2],
]
const TENDRILS = ANCHORS.length

const VERTEX = `#version 300 es
in vec3 position;
in vec3 normal;
in vec4 surface;
uniform vec2 uResolution;
out vec3 vPosition;
out vec3 vNormal;
out vec4 vSurface;
void main() {
	vPosition = position;
	vNormal = normal;
	vSurface = surface;
	gl_Position = vec4(position.x / uResolution.x * 2.0 - 1.0, 1.0 - position.y / uResolution.y * 2.0, -position.z / 2000.0, 1.0);
}
`

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec4 vSurface;
uniform vec2 uPointer;
uniform float uLight;
uniform float uTime;
uniform float uPulse;
uniform float uShock;
uniform float uLucid;
uniform float uCorruption;
uniform vec4 uVeil;
out vec4 fragColor;
${GLSL_NOISE}
void main() {
	float arc = vSurface.x, around = vSurface.y, radius = vSurface.z;
	vec2 skin = vec2(arc / 60.0, around * 0.55);
	float f = fbm(skin * 1.6 + vec2(uTime * 0.04, 0.0));
	float vein = ridge(skin * vec2(2.2, 1.6) + f * 2.4, 9.0);
	vec3 base = mix(vec3(0.05, 0.0, 0.012), vec3(0.42, 0.03, 0.06), smoothstep(0.28, 0.75, f));
	base = mix(base, vec3(0.78, 0.52, 0.44), smoothstep(0.66, 0.95, f) * 0.45);
	base = mix(base, vec3(0.07, 0.015, 0.1), vein * 0.75);

	float underside = smoothstep(-0.35, -0.8, cos(around)) * smoothstep(0.9, 0.75, vSurface.w);
	vec2 cell = vec2(fract(arc / max(radius * 1.15, 9.0)) - 0.5, (mod(around, 6.2831853) - 3.14159265) / 1.1);
	float suckerDistance = length(cell);
	float rim = smoothstep(0.44, 0.36, suckerDistance) * underside;
	float hole = smoothstep(0.22, 0.15, suckerDistance) * underside;
	base = mix(base, vec3(0.8, 0.58, 0.52), rim * 0.75);
	base = mix(base, vec3(0.05, 0.0, 0.01), hole);

	vec3 n = normalize(vNormal);
	vec3 bumpGradient = vec3(dFdx(f), dFdy(f), 0.0) * 6.0;
	n = normalize(n - bumpGradient);
	vec3 toLight = vec3(uPointer, 230.0) - vPosition;
	float distance = length(toLight);
	toLight /= distance;
	float attenuation = uLight / (1.0 + distance * distance / (230.0 * 230.0));
	float wrap = max((dot(n, toLight) + 0.35) / 1.35, 0.0);
	float specular = pow(max(dot(reflect(-toLight, n), vec3(0.0, 0.0, 1.0)), 0.0), 42.0);
	float fresnel = pow(1.0 - max(n.z, 0.0), 3.0);
	vec3 color = base * wrap * attenuation * 2.2 + vec3(0.5, 0.05, 0.05) * fresnel * attenuation * 0.6;
	color += vec3(1.0, 0.86, 0.8) * specular * attenuation * 1.1;
	color += base * uShock * 0.9;

	vec3 farLight = normalize(vec3(-0.4, -0.7, 0.6));
	float glint = pow(max(dot(reflect(-farLight, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * uPulse * uCorruption * 0.35;
	color += vec3(0.9, 0.7, 0.68) * glint;

	float reveal = smoothstep(0.025, 0.3, attenuation * (0.35 + wrap) * 1.8);
	float alpha = clamp(max(reveal, uShock) + glint, 0.0, 1.0);
	float column = smoothstep(uVeil.y, uVeil.y + uVeil.z, abs(vPosition.x - uVeil.x));
	color *= mix(1.0 - uVeil.w, 1.0, column);
	color = mix(color, vec3(0.17, 0.16, 0.15), uLucid);
	alpha = mix(alpha, 0.2, uLucid);
	fragColor = vec4(color * alpha, alpha);
}
`

/**
 * 沿视口边缘布置触手。
 * @param {number} width 视口宽。
 * @param {number} height 视口高。
 * @returns {object[]} 触手状态。
 */
function plant(width, height) {
	return ANCHORS.map(([x, y, angle], index) => {
		const ax = x * width, ay = y * height
		const points = Array.from({ length: SEGMENTS }, () => ({ x: ax, y: ay, px: ax, py: ay }))
		return {
			ax, ay, angle, points,
			phase: index * 1.7,
			thickness: 34 + (index * 7) % 19,
			reach: 0.7 + (index * 37 % 30) / 100,
			recoil: 0,
		}
	})
}

/**
 * 管体三角形索引（所有触手共用同一套拓扑）。
 * @returns {Uint16Array} 索引。
 */
function tubeIndices() {
	const indices = []
	for (let tendril = 0; tendril < TENDRILS; tendril++) {
		const offset = tendril * RINGS * RING
		for (let ring = 0; ring < RINGS - 1; ring++)
			for (let side = 0; side < SIDES; side++) {
				const a = offset + ring * RING + side, b = a + RING
				indices.push(a, b, a + 1, a + 1, b, b + 1)
			}
	}
	return new Uint16Array(indices)
}

/**
 * 触手群。
 * @param {HTMLCanvasElement} canvas 画布（WebGL2；不支持时只跑物理不绘制）。
 * @returns {{ step: Function, recoil: Function, draw: Function }} 控制句柄。
 */
export function createTendrils(canvas) {
	const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true })
	let tendrils = [], width = 0, height = 0, pixelRatio = 1
	let program, setters, vertexBuffer, indexCount = 0
	const vertices = new Float32Array(TENDRILS * RINGS * RING * STRIDE)

	if (gl) {
		program = createProgram(gl, VERTEX, FRAGMENT)
		setters = uniformSetters(gl, program)
		const vao = gl.createVertexArray()
		gl.bindVertexArray(vao)
		vertexBuffer = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
		gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW)
		for (const [name, size, offset] of [['position', 3, 0], ['normal', 3, 3], ['surface', 4, 6]]) {
			const location = gl.getAttribLocation(program, name)
			gl.enableVertexAttribArray(location)
			gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset * 4)
		}
		const indices = tubeIndices()
		indexCount = indices.length
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
		gl.enable(gl.DEPTH_TEST)
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
	}

	/**
	 * 把触手骨架展开成管体顶点：Z 方向随时间起伏让它在屏幕前后翻卷，截面沿长度扭转。
	 * @param {number} time 时间（秒）。
	 * @param {number} pulse 心跳包络（管体随之微微鼓胀）。
	 */
	function buildMesh(time, pulse) {
		let cursor = 0
		for (const tendril of tendrils) {
			const { points, thickness, phase } = tendril
			const spine = []
			for (let index = 0; index < SEGMENTS - 1; index++) {
				const p0 = points[Math.max(0, index - 1)], p1 = points[index], p2 = points[index + 1], p3 = points[Math.min(SEGMENTS - 1, index + 2)]
				for (let step = 0; step < SUBDIVISION; step++) {
					const t = step / SUBDIVISION, t2 = t * t, t3 = t2 * t
					spine.push({
						x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
						y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
					})
				}
			}
			spine.push({ x: points[SEGMENTS - 1].x, y: points[SEGMENTS - 1].y })
			for (const [index, point] of spine.entries()) {
				const along = index / (RINGS - 1)
				point.z = Math.sin(time * 0.8 + phase + along * 4.5) * thickness * 2.2 * along
			}
			let arc = 0
			for (let index = 0; index < RINGS; index++) {
				const point = spine[index]
				const previous = spine[Math.max(0, index - 1)], next = spine[Math.min(RINGS - 1, index + 1)]
				if (index) arc += Math.hypot(point.x - previous.x, point.y - previous.y)
				let tx = next.x - previous.x, ty = next.y - previous.y, tz = next.z - previous.z
				const tangentLength = Math.hypot(tx, ty, tz) || 1
				tx /= tangentLength; ty /= tangentLength; tz /= tangentLength
				let bx = ty, by = -tx
				const bLength = Math.hypot(bx, by) || 1
				bx /= bLength; by /= bLength
				const nx = by * tz, ny = -bx * tz, nz = bx * ty - by * tx
				const along = index / (RINGS - 1)
				const radius = (thickness * (1 - 0.88 * along ** 1.3) + 1.5) * (1 + pulse * 0.07)
				const twist = along * 2.6 + phase
				for (let side = 0; side < RING; side++) {
					const angle = side / SIDES * Math.PI * 2
					const c = Math.cos(angle + twist), s = Math.sin(angle + twist)
					const dx = c * bx + s * nx, dy = c * by + s * ny, dz = s * nz
					vertices.set([point.x + dx * radius, point.y + dy * radius, point.z + dz * radius, dx, dy, dz, arc, angle, radius, along], cursor)
					cursor += STRIDE
				}
			}
		}
	}
	return {
		/**
		 * 推进一帧，返回离指针最近的尖端距离（供心跳与“触碰”判定）。
		 * @param {object} state 帧状态。
		 * @param {number} state.time 时间（秒）。
		 * @param {number} state.delta 帧间隔（秒）。
		 * @param {number} state.corruption 腐化程度 0..1。
		 * @param {{ x: number, y: number, present: boolean }} state.pointer 指针。
		 * @param {boolean} state.calm 平静区：触手缩回。
		 * @returns {number} 最近尖端距离（像素）。
		 */
		step({ time, delta, corruption, pointer, calm }) {
			const nextWidth = canvas.clientWidth, nextHeight = canvas.clientHeight
			if (nextWidth !== width || nextHeight !== height) {
				width = nextWidth
				height = nextHeight
				pixelRatio = Math.min(devicePixelRatio || 1, 1.5)
				canvas.width = Math.round(width * pixelRatio)
				canvas.height = Math.round(height * pixelRatio)
				tendrils = plant(width, height)
			}
			const short = Math.min(width, height)
			const emerge = Math.max(0, Math.min(1, (corruption - 0.08) / 0.45))
			let nearest = Infinity
			for (const tendril of tendrils) {
				tendril.recoil = Math.max(0, tendril.recoil - delta)
				const length = short * (0.1 + 0.55 * emerge * tendril.reach) * (calm ? 0.35 : 1) * (tendril.recoil > 0 ? 0.3 : 1)
				const segment = length / SEGMENTS
				const { points } = tendril
				const dirX = Math.cos(tendril.angle), dirY = Math.sin(tendril.angle)
				let targetX = tendril.ax + dirX * length * 0.8 + Math.sin(time * 0.31 + tendril.phase) * length * 0.5
				let targetY = tendril.ay + dirY * length * 0.8 + Math.cos(time * 0.23 + tendril.phase * 1.3) * length * 0.5
				const toPointer = Math.hypot(pointer.x - tendril.ax, pointer.y - tendril.ay)
				if (pointer.present && !calm && tendril.recoil <= 0 && toPointer < length * 1.25) {
					targetX = pointer.x
					targetY = pointer.y
				}
				for (let index = 1; index < SEGMENTS; index++) {
					const point = points[index]
					const vx = (point.x - point.px) * 0.9, vy = (point.y - point.py) * 0.9
					point.px = point.x
					point.py = point.y
					const along = index / SEGMENTS
					const wave = Math.sin(time * 2.2 - along * 7 + tendril.phase) * segment * 0.9 * along
					point.x += vx - dirY * wave * 0.25
					point.y += vy + dirX * wave * 0.25
				}
				const tip = points[SEGMENTS - 1]
				tip.x += (targetX - tip.x) * Math.min(1, 2.6 * delta)
				tip.y += (targetY - tip.y) * Math.min(1, 2.6 * delta)
				points[0].x = tendril.ax
				points[0].y = tendril.ay
				points[1].x = tendril.ax + dirX * segment
				points[1].y = tendril.ay + dirY * segment
				for (let index = 2; index < SEGMENTS - 1; index++) {
					const before = points[index - 2], previous = points[index - 1], point = points[index]
					point.x += (2 * previous.x - before.x - point.x) * 0.12
					point.y += (2 * previous.y - before.y - point.y) * 0.12
				}
				for (let iteration = 0; iteration < ITERATIONS; iteration++)
					for (let index = 2; index < SEGMENTS; index++) {
						const a = points[index - 1], b = points[index]
						const dx = b.x - a.x, dy = b.y - a.y
						const distance = Math.hypot(dx, dy) || 0.0001
						const fix = (distance - segment) / distance
						if (index === 2) {
							b.x -= dx * fix
							b.y -= dy * fix
						}
						else {
							a.x += dx * fix * 0.5
							a.y += dy * fix * 0.5
							b.x -= dx * fix * 0.5
							b.y -= dy * fix * 0.5
						}
					}
				if (pointer.present) nearest = Math.min(nearest, Math.hypot(tip.x - pointer.x, tip.y - pointer.y))
			}
			return nearest
		},
		/**
		 * 让离指针最近的触手猛地缩回。
		 * @param {{ x: number, y: number }} pointer 指针。
		 */
		recoil(pointer) {
			for (const tendril of tendrils) {
				const tip = tendril.points[SEGMENTS - 1]
				if (Math.hypot(tip.x - pointer.x, tip.y - pointer.y) < 80) tendril.recoil = 2.5 + Math.random() * 2
			}
		},
		/**
		 * 绘制。
		 * @param {Record<string, number | ArrayLike<number>>} uniforms 与背景共享的光照 uniform（`uPointer` / `uLight` / `uPulse` / `uShock` / `uLucid` / `uCorruption` / `uVeil`）。
		 * @param {number} time 时间（秒）。
		 */
		draw(uniforms, time) {
			if (!gl || gl.isContextLost() || !tendrils.length) return
			buildMesh(time, uniforms.uPulse)
			gl.viewport(0, 0, canvas.width, canvas.height)
			gl.clearColor(0, 0, 0, 0)
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
			gl.useProgram(program)
			gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices)
			setters.get('uResolution')?.([width, height])
			setters.get('uTime')?.(time)
			for (const [name, value] of Object.entries(uniforms)) setters.get(name)?.(value)
			gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0)
		},
	}
}
