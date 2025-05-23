// src/public/scripts/endpoints.mjs

export async function ping() {
    return fetch('/api/ping');
}

export async function generateVerificationCode() {
    return fetch('/api/register/generateverificationcode', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

export async function whoami() {
    // Original code: await fetch('/api/whoami').then(res => res.json()).then(data => data.username)
    // The wrapper should return the promise that resolves to the JSON data directly for easier use.
    const response = await fetch('/api/whoami');
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

export async function login(username, password, deviceid) {
    return fetch('/api/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, deviceid }),
    });
}

export async function register(username, password, deviceid, verificationcode) {
    return fetch('/api/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, deviceid, verificationcode }),
    });
}

export async function authenticate() {
    return fetch('/api/authenticate', {
        method: 'POST'
    });
}

export async function runShell(shellname, args) {
    return fetch('/api/runshell', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shellname, args }),
    });
}
