//! Title / description / hashtag generation and full-video viral moment
//! discovery (SupoClip workflow) with structured JSON output.

use pulsecut_core::config::AiConfig;
use pulsecut_core::error::{PulseError, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GeneratedMetadata {
    pub title: String,
    pub description: String,
    pub hashtags: Vec<String>,
    pub hook: String,
}

/// A viral clip moment selected by analyzing the full-video transcript.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ViralMomentProposal {
    pub start_sec: f64,
    pub end_sec: f64,
    pub title: String,
    pub hook: String,
    pub description: String,
    pub hashtags: Vec<String>,
    pub virality_score: f64,
    pub reason: String,
}

#[async_trait::async_trait]
pub trait AiBackend: Send + Sync {
    fn name(&self) -> &'static str;
    fn is_available(&self) -> bool { true }
    async fn generate(&self, prompt: &str) -> Result<GeneratedMetadata>;

    /// Analyze a full-video timestamped transcript and return the strongest
    /// viral short-form moments (SupoClip workflow).
    async fn discover_clips(
        &self,
        _transcript: &str,
        _max_clips: usize,
        _duration_secs: f64,
    ) -> Result<Vec<ViralMomentProposal>> {
        Ok(Vec::new())
    }
}

pub fn build_prompt(transcript: &str, hints: &str) -> String {
    format!(
        "You are a viral short-form video editor. Given the transcript of a clip, \
         return ONLY a JSON object with keys: title (<=60 chars), description (<=180 chars), \
         hashtags (array of 5-8 lowercase tags without #), hook (one short punchy line <=45 chars). \
         Do not explain. Use the language of the transcript.\n\nHINTS: {hints}\n\nTRANSCRIPT:\n{transcript}"
    )
}

/// Build the SupoClip-style viral moment selection prompt over a full-video
/// timestamped transcript.
pub fn build_clip_discovery_prompt(transcript: &str, max_clips: usize, duration_secs: f64) -> String {
    format!(
        "You are an expert viral short-form video editor (TikTok, YouTube Shorts, Instagram Reels).\n\
         Analyze the FULL timestamped transcript below (total video length: {duration_secs:.0} seconds) \
         and pick the top {max_clips} most viral, self-contained moments.\n\n\
         Selection rules:\n\
         - Each clip MUST be between 20 and 60 seconds long and NEVER overlap another clip.\n\
         - Start right on a strong attention-grabbing hook or story setup (never mid-sentence).\n\
         - End right after a punchline, revelation, emotional payoff, or complete thought.\n\
         - Score each clip on virality_score (0.0 to 1.0) based on Hook, Emotional Spike, Value/Insight, and Shareability.\n\n\
         Return ONLY valid JSON with this exact schema:\n\
         {{\"clips\":[{{\"start_sec\":12.5,\"end_sec\":48.0,\"title\":\"Short punchy title <=55 chars\",\
         \"hook\":\"Big 4-7 word hook title <=42 chars\",\"description\":\"1-2 sentence caption\",\
         \"hashtags\":[\"shorts\",\"viral\"],\"virality_score\":0.92,\"reason\":\"Why this moment hits\"}}]}}\n\n\
         TRANSCRIPT:\n{transcript}"
    )
}

/// Extract the first balanced JSON object from a model response. Models often
/// wrap JSON in ```json fences or add a chatty prefix; this handles that.
pub fn parse_json_object(text: &str) -> Result<GeneratedMetadata> {
    let start = text.find('{').ok_or_else(|| PulseError::Ai("no JSON object in response".into()))?;
    let end = text.rfind('}').ok_or_else(|| PulseError::Ai("no closing brace in response".into()))?;
    if end < start {
        return Err(PulseError::Ai("malformed JSON response".into()));
    }
    let v: Value = serde_json::from_str(&text[start..=end])
        .map_err(|e| PulseError::Ai(format!("invalid JSON from model: {e}")))?;
    Ok(GeneratedMetadata {
        title: v["title"].as_str().unwrap_or("").trim().to_string(),
        description: v["description"].as_str().unwrap_or("").trim().to_string(),
        hashtags: v["hashtags"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.trim_start_matches('#').to_string())).collect())
            .unwrap_or_default(),
        hook: v["hook"].as_str().unwrap_or("").trim().to_string(),
    })
}

fn parse_time_field(val: &Value) -> Option<f64> {
    if let Some(n) = val.as_f64() {
        return Some(n);
    }
    let s = val.as_str()?.trim().trim_matches(|c| c == '[' || c == ']');
    if let Ok(n) = s.parse::<f64>() {
        return Some(n);
    }
    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        2 => {
            let m = parts[0].parse::<f64>().ok()?;
            let sec = parts[1].parse::<f64>().ok()?;
            Some(m * 60.0 + sec)
        }
        3 => {
            let h = parts[0].parse::<f64>().ok()?;
            let m = parts[1].parse::<f64>().ok()?;
            let sec = parts[2].parse::<f64>().ok()?;
            Some(h * 3600.0 + m * 60.0 + sec)
        }
        _ => None,
    }
}

/// Parse an LLM response containing `{"clips": [...]}` or a bare `[...]` array
/// into validated `ViralMomentProposal` items sorted by virality score.
pub fn parse_clip_proposals(text: &str) -> Result<Vec<ViralMomentProposal>> {
    let trimmed = text.trim();
    let json_slice = if let (Some(s), Some(e)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if e >= s { &trimmed[s..=e] } else { trimmed }
    } else if let (Some(s), Some(e)) = (trimmed.find('['), trimmed.rfind(']')) {
        if e >= s { &trimmed[s..=e] } else { trimmed }
    } else {
        return Err(PulseError::Ai("no JSON clip proposals in response".into()));
    };

    let v: Value = serde_json::from_str(json_slice)
        .map_err(|e| PulseError::Ai(format!("invalid clip proposal JSON: {e}")))?;

    let arr = v
        .get("clips")
        .and_then(|c| c.as_array())
        .or_else(|| v.as_array())
        .ok_or_else(|| PulseError::Ai("clip proposal JSON missing clips array".into()))?;

    let mut proposals = Vec::new();
    for item in arr {
        let start_sec = parse_time_field(&item["start_sec"])
            .or_else(|| parse_time_field(&item["start"]))
            .unwrap_or(-1.0);
        let end_sec = parse_time_field(&item["end_sec"])
            .or_else(|| parse_time_field(&item["end"]))
            .unwrap_or(-1.0);
        if start_sec < 0.0 || end_sec <= start_sec + 5.0 {
            continue;
        }
        let raw_score = item["virality_score"]
            .as_f64()
            .or_else(|| item["score"].as_f64())
            .unwrap_or(0.8);
        let score = if raw_score > 1.0 { (raw_score / 100.0).clamp(0.0, 1.0) } else { raw_score.clamp(0.0, 1.0) };
        let title = item["title"].as_str().unwrap_or("").trim().to_string();
        let hook = item["hook"].as_str().unwrap_or(&title).trim().to_string();
        let description = item["description"].as_str().unwrap_or("").trim().to_string();
        let reason = item["reason"].as_str().unwrap_or("AI viral moment").trim().to_string();
        let hashtags = item["hashtags"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.trim_start_matches('#').to_ascii_lowercase()))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        proposals.push(ViralMomentProposal {
            start_sec,
            end_sec,
            title,
            hook,
            description,
            hashtags,
            virality_score: score,
            reason,
        });
    }
    proposals.sort_by(|a, b| {
        b.virality_score
            .partial_cmp(&a.virality_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(proposals)
}

/// Local Ollama backend. Uses JSON mode so we get a parseable object even from
/// small 4B models.
pub struct Ollama {
    url: String,
    model: String,
    client: Client,
}

impl Ollama {
    pub fn new(cfg: &AiConfig) -> Self {
        Self { url: cfg.ollama_url.trim_end_matches('/').to_string(), model: cfg.ollama_model.clone(), client: Client::new() }
    }

    async fn prompt_json(&self, prompt: &str) -> Result<String> {
        let body = json!({
            "model": self.model,
            "prompt": prompt,
            "format": "json",
            "stream": false,
            "options": { "temperature": 0.3 }
        });
        let text = self.client
            .post(format!("{}/api/generate", self.url))
            .json(&body)
            .send()
            .await
            .map_err(|e| PulseError::Ai(format!("ollama request failed: {e}")))?
            .json::<Value>()
            .await
            .map_err(|e| PulseError::Ai(e.to_string()))?["response"]
            .as_str()
            .unwrap_or("")
            .to_string();
        Ok(text)
    }
}

pub struct OpenRouter {
    url: String,
    model: String,
    key_env: String,
    client: Client,
}

impl OpenRouter {
    pub fn new(cfg: &AiConfig) -> Self {
        Self {
            url: cfg.openrouter_url.clone(),
            model: cfg.openrouter_model.clone(),
            key_env: cfg.api_key_env.clone(),
            client: Client::new(),
        }
    }

    async fn prompt_json(&self, prompt: &str) -> Result<String> {
        let key = crate::require_key(&self.key_env)?;
        let body = json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": "Reply with valid JSON only." },
                { "role": "user", "content": prompt }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.3
        });
        let text = self.client
            .post(&self.url)
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .map_err(|e| PulseError::Ai(format!("openrouter request failed: {e}")))?
            .json::<Value>()
            .await
            .map_err(|e| PulseError::Ai(e.to_string()))?["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();
        Ok(text)
    }
}

/// Offline deterministic backend used in tests and when AI is disabled.
#[derive(Debug, Default)]
pub struct MockAi {
    pub metadata: Option<GeneratedMetadata>,
}

#[async_trait::async_trait]
impl AiBackend for MockAi {
    fn name(&self) -> &'static str { "mock" }
    async fn generate(&self, prompt: &str) -> Result<GeneratedMetadata> {
        if let Some(m) = &self.metadata {
            return Ok(m.clone());
        }
        Ok(GeneratedMetadata {
            title: format!("Clip: {}", prompt.chars().take(40).collect::<String>()),
            description: "Auto-generated by PulseCut".into(),
            hashtags: vec!["shorts".into(), "clips".into(), "viral".into()],
            hook: "Wait for it".into(),
        })
    }
}

fn probe(host: &str, port: u16) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    let Ok(mut addrs) = (host, port).to_socket_addrs() else { return false };
    match addrs.next() {
        Some(addr) => TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(400)).is_ok(),
        None => false,
    }
}

#[async_trait::async_trait]
impl AiBackend for Ollama {
    fn name(&self) -> &'static str { "ollama" }
    fn is_available(&self) -> bool {
        let Ok(parsed) = reqwest::Url::parse(&self.url) else { return false };
        match (parsed.host_str(), parsed.port().unwrap_or(11434)) {
            (Some(host), port) => probe(host, port),
            _ => false,
        }
    }
    async fn generate(&self, prompt: &str) -> Result<GeneratedMetadata> {
        let text = self.prompt_json(prompt).await?;
        parse_json_object(&text)
    }
    async fn discover_clips(
        &self,
        transcript: &str,
        max_clips: usize,
        duration_secs: f64,
    ) -> Result<Vec<ViralMomentProposal>> {
        let prompt = build_clip_discovery_prompt(transcript, max_clips, duration_secs);
        let text = self.prompt_json(&prompt).await?;
        parse_clip_proposals(&text)
    }
}

#[async_trait::async_trait]
impl AiBackend for OpenRouter {
    fn name(&self) -> &'static str { "openrouter" }
    fn is_available(&self) -> bool {
        std::env::var(&self.key_env).map(|v| !v.trim().is_empty()).unwrap_or(false)
    }
    async fn generate(&self, prompt: &str) -> Result<GeneratedMetadata> {
        let text = self.prompt_json(prompt).await?;
        parse_json_object(&text)
    }
    async fn discover_clips(
        &self,
        transcript: &str,
        max_clips: usize,
        duration_secs: f64,
    ) -> Result<Vec<ViralMomentProposal>> {
        let prompt = build_clip_discovery_prompt(transcript, max_clips, duration_secs);
        let text = self.prompt_json(&prompt).await?;
        parse_clip_proposals(&text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_fenced_json() {
        let raw = "```json\n{\"title\":\"Amazing\",\"description\":\"d\",\"hashtags\":[\"#fyp\",\"clips\"],\"hook\":\"wow\"}\n```";
        let m = parse_json_object(raw).unwrap();
        assert_eq!(m.title, "Amazing");
        assert_eq!(m.hashtags, vec!["fyp", "clips"]);
    }

    #[test]
    fn parses_clip_proposals_with_mmss_and_scores() {
        let raw = r#"```json
        {"clips":[
          {"start_sec":"01:10","end_sec":"01:48","title":"Insane clutch","hook":"HE ACTUALLY DID IT","virality_score":94,"reason":"Huge payoff"},
          {"start_sec":12.0,"end_sec":42.5,"title":"Opening hook","hook":"WAIT FOR THIS","virality_score":0.82,"reason":"Strong hook"}
        ]}
        ```"#;
        let clips = parse_clip_proposals(raw).unwrap();
        assert_eq!(clips.len(), 2);
        assert_eq!(clips[0].title, "Insane clutch");
        assert!((clips[0].start_sec - 70.0).abs() < 0.01);
        assert!((clips[0].virality_score - 0.94).abs() < 0.01);
    }

    #[tokio::test]
    async fn mock_backend_works() {
        let m = MockAi::default().generate("hello").await.unwrap();
        assert!(!m.hashtags.is_empty());
    }
}
