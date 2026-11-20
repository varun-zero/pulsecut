import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpikeGraphGeometry,
  formatCompactCount,
  formatMonitorStatusLabel,
  parseStreamUrlsInput,
} from './liveMonitor';
import type { MonitorRatePoint } from '../types';

test('parseStreamUrlsInput parses multiple Kick, YouTube Live, and Twitch streams and deduplicates', () => {
  const input = [
    'https://kick.com/eray',
    'kick.com/ERAY?ref=test',
    'https://www.youtube.com/live/YNp4gpjgNH4?feature=share',
    'https://youtu.be/YNp4gpjgNH4',
    'https://twitch.tv/shroud',
    'not-a-stream-link',
  ].join('\n');

  const res = parseStreamUrlsInput(input);
  assert.equal(res.valid.length, 3);
  assert.equal(res.duplicatesRemoved, 2);
  assert.equal(res.invalid.length, 1);

  assert.deepEqual(
    res.valid.map((v) => `${v.platform}:${v.channel}`),
    ['kick:eray', 'youtube:YNp4gpjgNH4', 'twitch:shroud']
  );
  assert.equal(res.valid[0].normalizedUrl, 'https://kick.com/eray');
  assert.equal(res.valid[1].normalizedUrl, 'https://www.youtube.com/watch?v=YNp4gpjgNH4');
  assert.equal(res.valid[2].normalizedUrl, 'https://www.twitch.tv/shroud');
});

test('parseStreamUrlsInput rejects reserved paths and bare youtube channel pages without video ID', () => {
  const res = parseStreamUrlsInput('https://kick.com/browse, https://youtube.com/@MrBeast');
  assert.equal(res.valid.length, 0);
  assert.equal(res.invalid.length, 2);
});

test('buildSpikeGraphGeometry produces deterministic SVG paths and spike trigger markers', () => {
  const empty = buildSpikeGraphGeometry([], 400, 120);
  assert.equal(empty.hasData, false);
  assert.equal(empty.ratePoints, '');

  const history: MonitorRatePoint[] = [
    { ts_ms: 1000, rate: 1.0, baseline: 1.0, z_score: 0, hype_score: 12, unique_authors: 3, triggered: false },
    { ts_ms: 2000, rate: 1.4, baseline: 1.1, z_score: 0.6, hype_score: 20, unique_authors: 5, triggered: false },
    { ts_ms: 3000, rate: 8.5, baseline: 1.1, z_score: 4.9, hype_score: 92, unique_authors: 22, triggered: true },
    { ts_ms: 4000, rate: 3.2, baseline: 1.2, z_score: 1.5, hype_score: 40, unique_authors: 10, triggered: false },
  ];

  const geom = buildSpikeGraphGeometry(history, 400, 120);
  assert.equal(geom.hasData, true);
  assert.equal(geom.peakRate, 8.5);
  assert.ok(geom.yMax >= 10, `yMax should give headroom above 8.5, got ${geom.yMax}`);
  assert.equal(geom.ratePoints.split(' ').length, 4);
  assert.equal(geom.baselinePoints.split(' ').length, 4);
  assert.ok(geom.areaPath.startsWith('M ') && geom.areaPath.endsWith(' Z'));
  assert.equal(geom.markers.length, 1);
  assert.equal(geom.markers[0].rate, 8.5);
  assert.equal(geom.markers[0].hypeScore, 92);
});

test('formatCompactCount & formatMonitorStatusLabel format live telemetry cleanly', () => {
  assert.equal(formatCompactCount(null), '—');
  assert.equal(formatCompactCount(840), '840');
  assert.equal(formatCompactCount(4360), '4.4K');
  assert.equal(formatCompactCount(25400), '25K');
  assert.equal(formatCompactCount(1400000), '1.4M');

  assert.equal(formatMonitorStatusLabel('calibrating', 58), 'Calibrating 58%');
  assert.equal(formatMonitorStatusLabel('watching'), 'Watching Live');
  assert.equal(formatMonitorStatusLabel('spike'), 'Hype Spike');
});
