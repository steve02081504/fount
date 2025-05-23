import { initTranslations } from '../../scripts/i18n.mjs';
import {
  changePassword,
  viewDevices,
  revokeDevice,
  renameUser,
  deleteAccount
} from './src/public/endpoints.mjs';

async function initializeUserSettingsShell() {
  // Initialize translations for the 'userSettings' page/context
  await initTranslations('userSettings');

  // Change Password
  document.getElementById('changePasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = event.target.usernameChangePassword.value;
    const currentPassword = event.target.currentPassword.value;
    const newPassword = event.target.newPassword.value;
    const result = await changePassword(username, currentPassword, newPassword);
    alert(result.message); // Assuming result.message is already internationalized server-side
    if (result.success) event.target.reset();
  });

  // View Devices
  document.getElementById('viewDevicesForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = event.target.usernameViewDevices.value;
    const result = await viewDevices(username);
    const deviceList = document.getElementById('deviceList');
    deviceList.innerHTML = ''; 
    if (result.success && result.devices) {
      if (result.devices.length === 0) {
        const li = document.createElement('li');
        // Use window.i18n.get (or just i18n.get if initTranslations makes it global differently)
        li.textContent = window.i18n.get('userSettings.userDevices.noDevicesFound', 'No devices found for this user.');
        deviceList.appendChild(li);
      } else {
        result.devices.forEach(device => {
          const li = document.createElement('li');
          li.textContent = `Device ID: ${device.deviceId} (Expires: ${new Date(device.expiry).toLocaleString()})`;
          const revokeButton = document.createElement('button');
          revokeButton.textContent = window.i18n.get('userSettings.userDevices.revokeButton', 'Revoke');
          revokeButton.onclick = async () => {
            const revokeResult = await revokeDevice(username, device.deviceId);
            alert(revokeResult.message); 
            if (revokeResult.success) {
              document.getElementById('viewDevicesForm').dispatchEvent(new Event('submit'));
            }
          };
          li.appendChild(revokeButton);
          deviceList.appendChild(li);
        });
      }
    } else {
      alert(result.message); 
    }
  });

  // Rename User
  document.getElementById('renameUserForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentUsername = event.target.currentUsernameRename.value;
    const newUsername = event.target.newUsernameRename.value;
    const result = await renameUser(currentUsername, newUsername);
    alert(result.message); 
    if (result.success) event.target.reset();
  });

  // Delete Account
  document.getElementById('deleteAccountForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const confirmMessage = window.i18n.get('userSettings.deleteAccount.confirmDelete', 'Are you sure you want to delete this account? This action cannot be undone.');
    if (!confirm(confirmMessage)) {
      return;
    }
    const username = event.target.usernameDelete.value;
    const password = event.target.passwordDelete.value;
    const result = await deleteAccount(username, password);
    alert(result.message); 
    if (result.success) event.target.reset();
  });
}

// Initialize the shell
initializeUserSettingsShell().catch(error => {
  console.error("Error initializing User Settings shell:", error);
  // Optionally, display a user-friendly error message on the page
  alert("Failed to initialize user settings page: " + error.message);
});
