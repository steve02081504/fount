/**
 * Creates a proxy that completely intercepts operations on an object returned by a base function.
 *
 * @param {() => object} base A function that returns the target object on each call.
 * @returns {object} A proxy object.
 */
export function FullProxy(base) {
	return new Proxy({}, {
		apply(target, thisArg, argArray) {
			return Reflect.apply(base(), thisArg, argArray)
		},
		construct(target, argArray, newTarget) {
			return Reflect.construct(base(), argArray, newTarget)
		},
		defineProperty(target, property, attributes) {
			return Reflect.defineProperty(base(), property, attributes)
		},
		deleteProperty(target, p) {
			return Reflect.deleteProperty(base(), p)
		},
		get(target, p, receiver) {
			return Reflect.get(base(), p, receiver)
		},
		getOwnPropertyDescriptor(target, p) {
			return Reflect.getOwnPropertyDescriptor(base(), p)
		},
		getPrototypeOf(target) {
			return Reflect.getPrototypeOf(base())
		},
		has(target, p) {
			return Reflect.has(base(), p)
		},
		isExtensible(target) {
			return Reflect.isExtensible(base())
		},
		ownKeys(target) {
			return Reflect.ownKeys(base())
		},
		preventExtensions(target) {
			return Reflect.preventExtensions(base())
		},
		set(target, p, newValue, receiver) {
			return Reflect.set(base(), p, newValue, receiver)
		},
		setPrototypeOf(target, v) {
			return Reflect.setPrototypeOf(base(), v)
		},
	})
}
