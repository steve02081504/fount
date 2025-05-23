// This file will contain wrapper functions for API calls specific to the 'home' shell.

export async function setHomeDefaultPart(partType, partName) {
  try {
    const response = await fetch('/api/shells/home/setdefault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parttype: partType, partname: partName }),
    });
    return response;
  } catch (error) {
    console.error('Error setting home default part:', error);
    // Return a mock response object with an error status to allow the caller to handle it
    return {
      ok: false,
      status: 500, // Internal Server Error
      text: async () => 'Failed to fetch due to network or server error'
    };
  }
}

export async function getHomeRegistry() {
  try {
    const response = await fetch('/api/shells/home/gethomeregistry');
    if (response.ok) {
      return await response.json();
    }
    console.error('Error fetching home registry:', await response.text());
    return null;
  } catch (error) {
    console.error('Error fetching home registry:', error);
    return null;
  }
}

export async function getHomeDefaultParts() {
  try {
    const response = await fetch('/api/shells/home/getdefaultparts');
    if (response.ok) {
      return await response.json();
    }
    console.error('Error fetching default parts:', await response.text());
    return null;
  } catch (error) {
    console.error('Error fetching default parts:', error);
    return null;
  }
}
