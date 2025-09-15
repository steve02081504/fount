export async function importFiles(formData) {
	return fetch('/api/shells/install/file', {
		method: 'POST',
		body: formData,
	})
}

export async function importText(text) {
	return fetch('/api/shells/install/text', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ text }),
	})
}

export async function uninstallPart(parttype, partname) {
	return fetch('/api/shells/install/uninstall', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ parttype, partname }),
	})
}
