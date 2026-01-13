// Default settings
const DEFAULT_SETTINGS = {
  vaultName: 'Main Vault',
  defaultFolder: '2 - Source Material/Clips',
  defaultTags: 'web-clip',
  includeTimestamps: true,
  savedFolders: ['2 - Source Material/Clips']
};

// Current settings
let settings = { ...DEFAULT_SETTINGS };

// Initialize options page
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
  renderSavedFolders();
});

// Load settings from storage
function loadSettings() {
  chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (result) => {
    settings = { ...DEFAULT_SETTINGS, ...result };
    populateForm();
  });
}

// Populate form with current settings
function populateForm() {
  document.getElementById('vaultName').value = settings.vaultName || '';
  document.getElementById('defaultFolder').value = settings.defaultFolder || '';
  document.getElementById('defaultTags').value = settings.defaultTags || '';
  document.getElementById('includeTimestamps').checked = settings.includeTimestamps !== false;
}

// Setup event listeners
function setupEventListeners() {
  // Save button
  document.getElementById('saveBtn').addEventListener('click', saveSettings);

  // Reset button
  document.getElementById('resetBtn').addEventListener('click', resetSettings);

  // Add folder button
  document.getElementById('addFolder').addEventListener('click', addFolder);

  // New folder input - enter key
  document.getElementById('newFolder').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFolder();
    }
  });
}

// Save settings to storage
function saveSettings() {
  settings = {
    vaultName: document.getElementById('vaultName').value.trim() || DEFAULT_SETTINGS.vaultName,
    defaultFolder: document.getElementById('defaultFolder').value.trim() || DEFAULT_SETTINGS.defaultFolder,
    defaultTags: document.getElementById('defaultTags').value.trim() || DEFAULT_SETTINGS.defaultTags,
    includeTimestamps: document.getElementById('includeTimestamps').checked,
    savedFolders: settings.savedFolders
  };

  chrome.storage.local.set(settings, () => {
    showStatus('success', 'Settings saved successfully!');
  });
}

// Reset settings to defaults
function resetSettings() {
  if (confirm('Are you sure you want to reset all settings to default values?')) {
    settings = { ...DEFAULT_SETTINGS };
    populateForm();
    renderSavedFolders();
    chrome.storage.local.set(settings, () => {
      showStatus('success', 'Settings reset to defaults!');
    });
  }
}

// Add new folder to saved list
function addFolder() {
  const input = document.getElementById('newFolder');
  const folder = input.value.trim();

  if (!folder) {
    showStatus('error', 'Please enter a folder path');
    return;
  }

  if (settings.savedFolders.includes(folder)) {
    showStatus('error', 'Folder already exists');
    return;
  }

  settings.savedFolders.push(folder);
  input.value = '';
  renderSavedFolders();

  // Auto-save
  chrome.storage.local.set({ savedFolders: settings.savedFolders });
}

// Remove folder from saved list
function removeFolder(folder) {
  settings.savedFolders = settings.savedFolders.filter(f => f !== folder);
  renderSavedFolders();

  // Auto-save
  chrome.storage.local.set({ savedFolders: settings.savedFolders });
}

// Render saved folders list
function renderSavedFolders() {
  const container = document.getElementById('savedFolders');
  container.innerHTML = '';

  settings.savedFolders.forEach(folder => {
    const div = document.createElement('div');
    div.className = 'folder-tag';
    div.innerHTML = `
      <span>${escapeHtml(folder)}</span>
      <button class="remove-btn" data-folder="${escapeHtml(folder)}">&times;</button>
    `;
    container.appendChild(div);
  });

  // Add remove listeners
  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFolder(btn.dataset.folder);
    });
  });
}

// Show status message
function showStatus(type, message) {
  const status = document.getElementById('status');
  status.className = `status ${type}`;
  status.textContent = message;

  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
