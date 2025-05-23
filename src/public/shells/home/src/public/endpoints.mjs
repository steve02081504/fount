export async function setDefaultPart(parttype, partname) {
    return fetch('/api/shells/home/setdefault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parttype, partname }),
    });
}

export async function getHomeRegistry() {
    return fetch('/api/shells/home/gethomeregistry');
}

export async function getDefaultParts() {
    return fetch('/api/shells/home/getdefaultparts');
}
