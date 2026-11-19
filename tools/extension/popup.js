// PulseCut Popup Logic
document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const statClips = document.getElementById('stat-clips');
  const statJobs = document.getElementById('stat-jobs');

  const autoClipMode = document.getElementById('autoClipMode');
  const lookbackSecs = document.getElementById('lookbackSecs');
  const sensitivityThreshold = document.getElementById('sensitivityThreshold');
  const sensitivityVal = document.getElementById('sensitivityVal');
  const serverUrl = document.getElementById('serverUrl');

  const DEFAULT_CONFIG = {
    serverUrl: 'http://127.0.0.1:8756',
    lookbackSecs: 30,
    sensitivityThreshold: 70,
    autoClipMode: 'ask'
  };

  // Load saved settings
  if (chrome && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
      serverUrl.value = items.serverUrl || DEFAULT_CONFIG.serverUrl;
      lookbackSecs.value = items.lookbackSecs || DEFAULT_CONFIG.lookbackSecs;
      sensitivityThreshold.value = items.sensitivityThreshold || DEFAULT_CONFIG.sensitivityThreshold;
      sensitivityVal.innerText = `${sensitivityThreshold.value}%`;
      autoClipMode.value = items.autoClipMode || DEFAULT_CONFIG.autoClipMode;
      checkServer(serverUrl.value);
    });
  } else {
    checkServer(serverUrl.value);
  }

  // Update slider label
  sensitivityThreshold.addEventListener('input', () => {
    sensitivityVal.innerText = `${sensitivityThreshold.value}%`;
    saveSettings();
  });

  autoClipMode.addEventListener('change', saveSettings);
  lookbackSecs.addEventListener('change', saveSettings);
  serverUrl.addEventListener('change', () => {
    saveSettings();
    checkServer(serverUrl.value);
  });

  function saveSettings() {
    const data = {
      serverUrl: serverUrl.value.trim() || 'http://127.0.0.1:8756',
      lookbackSecs: parseInt(lookbackSecs.value, 10) || 30,
      sensitivityThreshold: parseInt(sensitivityThreshold.value, 10) || 70,
      autoClipMode: autoClipMode.value
    };
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(data);
    }
  }

  async function checkServer(url) {
    try {
      const res = await fetch(`${url}/api/extension/status`, { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        statusBadge.className = 'status-badge';
        statusText.innerText = 'Connected';
        statClips.innerText = data.clips ?? 0;
        statJobs.innerText = data.jobs ?? 0;
      } else {
        throw new Error('bad response');
      }
    } catch (_) {
      statusBadge.className = 'status-badge offline';
      statusText.innerText = 'Offline';
    }
  }
});
