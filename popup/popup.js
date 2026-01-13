// Popup state
let currentTab = null;
let pageType = 'web';
let clipperContent = null;

// Page type detection
const PAGE_TYPES = {
  YOUTUBE: {
    pattern: /^https?:\/\/(www\.)?youtube\.com\/watch/,
    icon: '▶️',
    label: 'YouTube Video',
    type: 'youtube'
  },
  PDF: {
    pattern: /^https?:\/\/.*\.pdf(\?|$)/i,
    icon: '📄',
    label: 'PDF Document',
    type: 'pdf'
  },
  WEB: {
    pattern: /^https?:\/\//,
    icon: '🌐',
    label: 'Web Page',
    type: 'web'
  }
};

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await getCurrentTab();
  detectPageType();
  setupEventListeners();
  updateUI();
});

// Load settings from storage
async function loadSettings() {
  const result = await chrome.storage.local.get(['defaultFolder', 'defaultTags', 'vaultName']);
  const settings = result.defaultFolder || '2 - Source Material/Clips';
  const tags = result.defaultTags || 'web-clip';

  const folderInput = document.getElementById('folderInput');
  const tagsInput = document.getElementById('tagsInput');

  if (folderInput) folderInput.value = settings;
  if (tagsInput) tagsInput.value = tags;
}

// Get current active tab
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  return tab;
}

// Detect page type from URL
function detectPageType() {
  if (!currentTab || !currentTab.url) {
    setPageType('WEB');
    return;
  }

  const url = currentTab.url;

  for (const [key, config] of Object.entries(PAGE_TYPES)) {
    if (config.pattern.test(url)) {
      setPageType(key);
      return;
    }
  }

  setPageType('WEB');
}

// Set page type in UI
function setPageType(type) {
  const config = PAGE_TYPES[type] || PAGE_TYPES.WEB;
  pageType = config.type;

  const iconEl = document.getElementById('pageIcon');
  const labelEl = document.getElementById('pageLabel');

  if (iconEl) iconEl.textContent = config.icon;
  if (labelEl) labelEl.textContent = config.label;
}

// Setup event listeners
function setupEventListeners() {
  // Clip button
  document.getElementById('clipBtn').addEventListener('click', handleClip);

  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', openSettings);

  // Title input - sync with page title
  const titleInput = document.getElementById('titleInput');
  titleInput.addEventListener('input', () => {
    clipperContent = { ...clipperContent, title: titleInput.value };
  });
}

// Update UI with current page info
function updateUI() {
  if (currentTab) {
    const titleInput = document.getElementById('titleInput');
    titleInput.value = currentTab.title || 'Untitled';
    clipperContent = { title: currentTab.title };
  }
}

// Ensure content script is loaded
async function ensureContentScriptLoaded(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' });
    return true;
  } catch (error) {
    // Content script not loaded, inject it
    console.log('Content script not found, injecting...');
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['lib/turndown.js', 'lib/readability.js', 'content.js']
    });
    // Wait a moment for scripts to initialize
    await new Promise(resolve => setTimeout(resolve, 100));
    return true;
  }
}

// Handle clip action
async function handleClip() {
  const clipBtn = document.getElementById('clipBtn');
  const status = document.getElementById('status');

  try {
    showStatus('loading', 'Clipping page...');
    clipBtn.disabled = true;

    // Ensure content script is loaded first
    await ensureContentScriptLoaded(currentTab.id);

    // Get content from content script
    const results = await chrome.tabs.sendMessage(currentTab.id, {
      action: 'clip',
      pageType: pageType
    });

    if (results && results.markdown) {
      await saveToObsidian(results);
    } else {
      showStatus('error', 'Failed to extract content');
    }
  } catch (error) {
    console.error('Clip error:', error);
    showStatus('error', error.message || 'Failed to clip page');
  } finally {
    clipBtn.disabled = false;
  }
}

// Save to Obsidian via URI scheme
async function saveToObsidian(data) {
  const settings = await chrome.storage.local.get(['vaultName', 'defaultFolder']);
  const titleInput = document.getElementById('titleInput');
  const folderInput = document.getElementById('folderInput');
  const tagsInput = document.getElementById('tagsInput');

  const title = sanitizeFilename(titleInput.value.trim() || 'Untitled');
  const folder = folderInput.value.trim();
  let tags = tagsInput.value.trim().split(/\s*,\s*/).filter(t => t);
  const vault = settings.vaultName || 'Main Vault';

  // Auto-add tags based on page type
  if (pageType === 'youtube' && !tags.includes('youtube')) {
    tags.push('youtube');
  }
  if (pageType === 'pdf' && !tags.includes('pdf')) {
    tags.push('pdf');
  }

  // Build file path
  const filePath = folder ? `${folder}/${title}` : title;

  // Build markdown content with frontmatter
  const markdown = buildMarkdown(data.markdown, data.metadata, tags);

  // Encode content for URI
  const encodedContent = encodeURIComponent(markdown);

  // Create Obsidian URI
  const obsidianUri = `obsidian://new?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(filePath)}&content=${encodedContent}`;

  // Open Obsidian URI by navigating the current window
  window.location.href = obsidianUri;
}

// Build markdown with frontmatter
function buildMarkdown(content, metadata, tags) {
  const frontmatter = [
    '---',
    `source: ${metadata.url || ''}`,
    `title: ${metadata.title || ''}`,
    metadata.author ? `author: ${metadata.author}` : '',
    `date_clipped: ${new Date().toISOString()}`,
    tags.length ? `tags: [${tags.map(t => t).join(', ')}]` : 'tags: [web-clip]',
    `type: ${metadata.type || 'article'}`,
    '---',
    ''
  ].filter(line => line !== '').join('\n');

  return frontmatter + content;
}

// Sanitize filename for safe file path
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

// Show status message
function showStatus(type, message) {
  const status = document.getElementById('status');
  status.className = `status ${type}`;
  status.textContent = message;
}

// Open settings page
function openSettings() {
  chrome.runtime.openOptionsPage();
}
