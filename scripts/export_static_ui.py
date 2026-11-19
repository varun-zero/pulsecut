"""Export the embedded dashboard UI as a standalone index.html.

Google AI Studio (and other static hosts) can open the generated file without
the Rust server; API calls fall back to local demo data when no server exists.
Run: python scripts/export_static_ui.py
"""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
src = root / "crates" / "app" / "src" / "web.rs"
text = src.read_text(encoding="utf-8")

start_marker = 'r##"<!doctype html>'
start = text.index(start_marker) + len('r##"')
end = text.index('"##\n}', start)
html = text[start:end]

fallback = """
/* --- Static-preview fallback for Google AI Studio --- */
const __serverApi = api;
api = async function(path, opts = {}) {
  try { return await __serverApi(path, opts); }
  catch (e) { return mockApi(path, opts); }
};
const MOCK_CLIPS = [
  {id:'demo-1', title:'Highlight 1 · sample', template:'tiktok_hook', status:'ready', confidence:0.82, channel:'vod', description:'Auto-clipped by PulseCut', hashtags:['shorts','clips','fyp'], created_at_ms:1},
  {id:'demo-2', title:'Breaking moment', template:'breaking_news', status:'approved', confidence:0.91, channel:'demo', description:'Live chat spike', hashtags:['news','clips'], created_at_ms:2}
];
const MOCK_JOBS = [{id:'demo-job', url:'https://example.com/video.mp4', status:'done', progress:100, message:'2 clip(s) ready', clip_ids:['demo-1','demo-2'], created_at_ms:1}];
function mockApi(path, opts) {
  const method = (opts.method || 'GET').toUpperCase();
  if (path === '/api/clips') return {clips: MOCK_CLIPS};
  if (path === '/api/jobs' && method === 'POST') {
    const body = JSON.parse(opts.body || '{}');
    const job = {id:'job-' + Date.now(), url:body.url || '', status:'queued', progress:0, message:'queued', clip_ids:[], created_at_ms:Date.now()};
    MOCK_JOBS.unshift(job); return {job};
  }
  if (path === '/api/jobs') return {jobs: MOCK_JOBS};
  if (path.startsWith('/api/jobs/')) return {job: MOCK_JOBS.find(j => path.endsWith(j.id)) || MOCK_JOBS[0]};
  if (path === '/api/app/info') return {name:'PulseCut (static preview)', version:'0.1.0', engine:'demo data', templates:window.yzTemplates.map(t=>t.id), layouts:['solo','pip','split','centered'], canvas:['solid','blur','padding'], capabilities:['demo preview']};
  if (path === '/api/engine/call') {
    const cmd = JSON.parse(opts.body || '{}').command;
    if (cmd === 'templates') return {templates: window.yzTemplates.map(t=>({id:t.id,name:t.name}))};
    if (cmd === 'layouts') return {layouts:['solo','pip','split','centered'], canvas:['solid','blur','padding']};
    return {ok:true, demo:true};
  }
  if (path === '/api/projects/state') return {clips:MOCK_CLIPS.length, jobs:MOCK_JOBS.length, persisted:false};
  if (path === '/api/projects/save') return {saved:true, clips:MOCK_CLIPS.length};
  if (path.includes('/configure')) return {clip: MOCK_CLIPS[0]};
  if (path.includes('/approve')) return {ok:true};
  if (path.includes('/media')) return {};
  if (path.includes('/edits')) return {ok:true};
  return {ok:true, demo:true};
}
"""

pos = html.rfind("</script>")
assert pos != -1
html = html[:pos] + fallback + html[pos:]
(root / "index.html").write_text(html, encoding="utf-8")
print(f"wrote {root / 'index.html'} ({len(html)} bytes)")
