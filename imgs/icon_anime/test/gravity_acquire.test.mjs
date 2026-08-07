/**
 * gravity_acquire：termux-sensor stdout / JSON 解析。
 */
/* global Deno */
import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert'

import { parseSensorStdout, valuesFromSensorJson } from '../gravity_acquire/termux.mjs'

Deno.test('gravity_acquire: pretty-printed termux-sensor stream (indent=2)', () => {
	// SensorAPI: sensorReadout.toString(INDENTATION) + "\n"
	const chunk = `{
  "BMI160 Gravity": {
    "values": [
      0.5,
      -9.7,
      1.2
    ]
  }
}
`
	const { samples, rest } = parseSensorStdout(chunk + chunk.slice(0, 20))
	assertEquals(samples.length, 1)
	assertAlmostEquals(samples[0][0], 0.5, 1e-9)
	assertAlmostEquals(samples[0][1], -9.7, 1e-9)
	assertAlmostEquals(samples[0][2], 1.2, 1e-9)
	assertEquals(rest.startsWith('{'), true)
	const again = parseSensorStdout(rest + chunk.slice(20))
	assertEquals(again.samples.length, 1)
	assertEquals(again.rest, '')
})

Deno.test('gravity_acquire: compact + concatenated sensor objects', () => {
	const firstPayload = '{"Gravity":{"values":[1,2,3]}}'
	const secondPayload = '{"accelerometer":{"values":[4,5,6]}}'
	const { samples, rest } = parseSensorStdout(firstPayload + secondPayload)
	assertEquals(samples, [[1, 2, 3], [4, 5, 6]])
	assertEquals(rest, '')
})

Deno.test('gravity_acquire: valuesFromSensorJson skips short values arrays', () => {
	assertEquals(valuesFromSensorJson({ empty: { values: [1] } }), null)
	assertEquals(valuesFromSensorJson({ Gravity: { values: [1, 2, 3] } }), [1, 2, 3])
})
