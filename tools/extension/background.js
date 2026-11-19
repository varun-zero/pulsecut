// PulseCut Extension Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('[PulseCut] Live Chat Hype Extension installed.');
  chrome.storage.sync.set({
    serverUrl: 'http://127.0.0.1:8756',
    lookbackSecs: 30,
    sensitivityThreshold: 70,
    autoClipMode: 'ask',
    cooldownSecs: 45
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'NOTIFY_CLIP') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'PulseCut Clip Triggered!',
      message: `Clipped the last ${request.lookbackSecs}s on ${request.channel}!`
    });
    sendResponse({ ok: true });
  }
});
