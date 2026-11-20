import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const hypeEngine = require('../../tools/extension/hypeEngine.js');

test('parseViewerCount & formatViewerCount handle Kick, YouTube Live, and Twitch viewer strings', () => {
  assert.equal(hypeEngine.parseViewerCount('12,450 watching now'), 12450);
  assert.equal(hypeEngine.parseViewerCount('18.4K'), 18400);
  assert.equal(hypeEngine.parseViewerCount('1.2M watching'), 1200000);
  assert.equal(hypeEngine.parseViewerCount('845 viewers'), 845);
  assert.equal(hypeEngine.parseViewerCount(4200), 4200);
  assert.equal(hypeEngine.parseViewerCount('offline'), null);

  assert.equal(hypeEngine.formatViewerCount(845), '845');
  assert.equal(hypeEngine.formatViewerCount(4250), '4.3K');
  assert.equal(hypeEngine.formatViewerCount(18400), '18K');
  assert.equal(hypeEngine.formatViewerCount(1500000), '1.5M');
});

test('viewer-aware adaptive baseline scales cleanly from 80-viewer to 40,000-viewer streams', () => {
  const smallPrior = hypeEngine.estimateViewerBaselineRate(80);
  const mediumPrior = hypeEngine.estimateViewerBaselineRate(2000);
  const megaPrior = hypeEngine.estimateViewerBaselineRate(40000);

  assert.ok(smallPrior < 0.8, `80-viewer baseline should be low, got ${smallPrior}`);
  assert.ok(mediumPrior > 1.8 && mediumPrior < 3.0, `2K-viewer baseline unexpected: ${mediumPrior}`);
  assert.ok(megaPrior > 8.0 && megaPrior < 12.0, `40K-viewer baseline unexpected: ${megaPrior}`);

  const now = 500_000;

  // Scenario A: 40,000-viewer stream running at NORMAL chat pace (~10 msg/s = 60 msgs in 6s)
  // Previously this caused constant 100% false triggers! Now it must stay CALM (< 45%).
  const normalMegaChat = Array.from({ length: 60 }, (_, i) => ({
    ts: now - i * 95,
    author: `user_${i}`,
    text: i % 5 === 0 ? 'W stream' : 'hello chat what game next',
  }));
  const megaCalm = hypeEngine.analyzeChatWindow({
    messages: normalMegaChat,
    nowMs: now,
    viewerCount: 40000,
    baselineRatePerSec: megaPrior,
  });
  assert.ok(
    megaCalm.score < 45,
    `Normal 10 msg/s chat on 40K stream must stay calm, got score=${megaCalm.score}`
  );

  // Scenario B: Same 40,000-viewer stream GOES CRAZY (~30 msg/s = 180 msgs in 6s, diverse authors + hype)
  const crazyMegaChat = Array.from({ length: 180 }, (_, i) => ({
    ts: now - i * 32,
    author: `viewer_${i}`,
    text: i % 2 === 0 ? 'NO WAY CLIP IT 😭🔥' : 'WWWWW INSANE BRO',
  }));
  const megaSpike = hypeEngine.analyzeChatWindow({
    messages: crazyMegaChat,
    nowMs: now,
    viewerCount: 40000,
    baselineRatePerSec: megaPrior,
  });
  assert.ok(
    megaSpike.score >= 75,
    `Crazy surge on 40K stream must trigger strongly, got score=${megaSpike.score}`
  );

  // Scenario C: Small 80-viewer stream with a genuine burst (15 msgs in 6s = 2.5 msg/s from 10 chatters)
  const smallBurst = Array.from({ length: 15 }, (_, i) => ({
    ts: now - i * 350,
    author: `fan_${i % 10}`,
    text: i % 2 === 0 ? 'OMG NO WAY CLIP IT 🔥' : 'INSANE CLUTCH BRO',
  }));
  const smallSpike = hypeEngine.analyzeChatWindow({
    messages: smallBurst,
    nowMs: now,
    viewerCount: 80,
    baselineRatePerSec: smallPrior,
  });
  assert.ok(
    smallSpike.score >= 65,
    `Genuine burst on 80-viewer stream must trigger, got score=${smallSpike.score}`
  );
});

test('single-user spam protection prevents 1 chatter spamming W/CLIP IT from triggering an auto-clip', () => {
  const now = 200_000;
  const oneSpammer = Array.from({ length: 20 }, (_, i) => ({
    ts: now - i * 200,
    author: 'toxic_spammer_99',
    text: 'WWWWW CLIP IT OMG INSANE 🔥💀',
  }));

  const res = hypeEngine.analyzeChatWindow({
    messages: oneSpammer,
    nowMs: now,
    viewerCount: 500,
    baselineRatePerSec: 1.0,
  });
  assert.equal(res.spamDampened, true);
  assert.equal(res.uniqueAuthors, 1);
  assert.ok(res.score <= 35, `Single spammer must be dampened <= 35, got ${res.score}`);
});

test('adaptive baseline tracker warms up cleanly and resists spike poisoning', () => {
  let state = hypeEngine.createBaselineState(1000, 10000);
  assert.equal(state.calibrated, false);

  // Feed 15 seconds of steady ~5 msg/s normal chat
  for (let sec = 1; sec <= 15; sec += 1) {
    state = hypeEngine.updateAdaptiveBaseline(state, 5.0, 10000, 1000 + sec * 1000);
  }
  assert.equal(state.calibrated, true);
  assert.equal(state.calibrationPct, 100);
  const preSpikeMean = state.mean;
  assert.ok(preSpikeMean >= 4.2 && preSpikeMean <= 6.0, `Expected steady mean ~5, got ${preSpikeMean}`);

  // Inject 3 seconds of massive 40 msg/s hype explosion — baseline must NOT explode to 20+
  for (let sec = 16; sec <= 18; sec += 1) {
    state = hypeEngine.updateAdaptiveBaseline(state, 40.0, 10000, 1000 + sec * 1000);
  }
  assert.ok(
    state.mean < preSpikeMean * 1.25,
    `Baseline should resist spike poisoning: before=${preSpikeMean}, after=${state.mean}`
  );
});

test('trigger gate enforces warm-up calibration and sustained burst for auto-clips while keeping manual clicks instant', () => {
  const now = 100_000;

  // Blocked while calibrating
  const calibrating = hypeEngine.evaluateTriggerGate({
    source: 'auto',
    nowMs: now,
    calibrated: false,
    sustainedHotTicks: 3,
  });
  assert.equal(calibrating.allowed, false);
  assert.equal(calibrating.reason, 'calibrating');

  // Blocked on 1-tick blip (needs 2 consecutive hot ticks)
  const blip = hypeEngine.evaluateTriggerGate({
    source: 'auto',
    nowMs: now,
    calibrated: true,
    sustainedHotTicks: 1,
    sustainedTicksRequired: 2,
  });
  assert.equal(blip.allowed, false);
  assert.equal(blip.reason, 'confirming');

  // Allowed once calibrated + sustained
  const confirmed = hypeEngine.evaluateTriggerGate({
    source: 'auto',
    nowMs: now,
    calibrated: true,
    sustainedHotTicks: 2,
    sustainedTicksRequired: 2,
  });
  assert.equal(confirmed.allowed, true);

  // Manual click always bypasses calibration & sustained burst
  const manual = hypeEngine.evaluateTriggerGate({
    source: 'manual',
    nowMs: now,
    calibrated: false,
    sustainedHotTicks: 0,
  });
  assert.equal(manual.allowed, true);
});

test('YouTube Live detection works for /watch?v= with chatframe or watching-now text and /live/ URLs', () => {
  const watchLiveViaChat = hypeEngine.detectStreamContext('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
    channelHandle: '@IShowSpeed',
    hasLiveChatFrame: true,
    viewerCount: '84,200 watching now',
  });
  assert.equal(watchLiveViaChat.platform, 'youtube');
  assert.equal(watchLiveViaChat.channel, 'IShowSpeed');
  assert.equal(watchLiveViaChat.isLive, true);
  assert.equal(watchLiveViaChat.viewerCount, 84200);
  assert.equal(watchLiveViaChat.supported, true);

  const livePath = hypeEngine.detectStreamContext('https://www.youtube.com/live/YNp4gpjgNH4', {
    viewerCount: '5.4K watching now',
  });
  assert.equal(livePath.platform, 'youtube');
  assert.equal(livePath.videoId, 'YNp4gpjgNH4');
  assert.equal(livePath.isLive, true);
  assert.equal(livePath.viewerCount, 5400);

  const ytVod = hypeEngine.detectStreamContext('https://www.youtube.com/watch?v=abc123', {
    channelHandle: '@MrBeast',
    hasLiveBadge: false,
    hasLiveChatFrame: false,
    hasWatchingNow: false,
  });
  assert.equal(ytVod.isLive, false);
});
