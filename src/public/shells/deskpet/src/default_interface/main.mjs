export function createDefaultDeskpetInterface(charAPI, ownerUsername, charname) {
	return {
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
