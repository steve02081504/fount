// Helper function to make API calls (internal to this module)
async function callApi(endpoint, method, body) {
  const response = await fetch(`/api/shells/user_settings/${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

export async function changePassword(username, currentPassword, newPassword) {
  return callApi('change-password', 'POST', { username, currentPassword, newPassword });
}

export async function viewDevices(username) {
  return callApi('view-devices', 'POST', { username });
}

export async function revokeDevice(username, deviceId) {
  return callApi('revoke-device', 'POST', { username, deviceId });
}

export async function renameUser(currentUsername, newUsername) {
  return callApi('rename-user', 'POST', { currentUsername, newUsername });
}

export async function deleteAccount(username, password) {
  return callApi('delete-account', 'POST', { username, password });
}
