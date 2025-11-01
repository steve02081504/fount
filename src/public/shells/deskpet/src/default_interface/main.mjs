/**
 *
 * @param {import('../../../../../decl/charAPI.ts').CharAPI_t} charAPI
 * @param {string} ownerUsername
 * @param {string} charname
 * @returns {{GetPetConfig: () => Promise<{url: string, windowOptions: {width: number, height: number}}>}}
 */
export function createDefaultDeskpetInterface(charAPI, ownerUsername, charname) {
	return {
		/**
		 * @returns {Promise<{url: string, windowOptions: {width: number, height: number}}>}
		 */
		GetPetConfig: async () => ({
			// The shell's public directory is automatically served at /shells/<shellname>/
			url: '/shells/deskpet/default_pet.html',
			windowOptions: {
				width: 150,
				height: 150,
			}
		})
	}
}
