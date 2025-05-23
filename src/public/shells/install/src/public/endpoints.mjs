// src/public/shells/install/src/public/endpoints.mjs

export async function importFiles(formData) {
    return fetch('/api/shells/install/file', {
        method: 'POST',
        body: formData,
    });
}

export async function importText(text) {
    return fetch('/api/shells/install/text', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
    });
}

export async function uninstallPart(type, name) {
    return fetch(`/api/shells/install/uninstall?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`, {
        method: 'POST', // Method was POST in original code
        headers: {
            'Content-Type': 'application/json', // Kept header as it was in original
        },
        // Original POST had body: JSON.stringify({ type, name }), which is redundant if using query params.
        // Let's send an empty body or what the server expects for this specific endpoint.
        // Given the original code, it sent both query params AND a body.
        // For minimal change, we replicate this.
        body: JSON.stringify({ type, name }),
    });
}
