//! URL-to-clip job tracking for the dashboard.

use pulsecut_core::error::{PulseError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Downloading,
    Clipping,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub url: String,
    pub status: JobStatus,
    pub progress: u32,
    pub message: String,
    pub clip_ids: Vec<String>,
    pub created_at_ms: i64,
}

#[derive(Debug)]
pub struct JobStore {
    path: PathBuf,
    jobs: HashMap<String, Job>,
}

impl JobStore {
    pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("jobs.json");
        let jobs = if path.exists() {
            let text = std::fs::read_to_string(&path)?;
            serde_json::from_str(&text).unwrap_or_default()
        } else {
            HashMap::new()
        };
        Ok(Self { path, jobs })
    }

    fn flush(&self) -> Result<()> {
        let text = serde_json::to_string_pretty(&self.jobs)?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    pub fn create(&mut self, url: &str) -> Job {
        let job = Job {
            id: uuid::Uuid::new_v4().to_string(),
            url: url.to_string(),
            status: JobStatus::Queued,
            progress: 0,
            message: "queued".into(),
            clip_ids: Vec::new(),
            created_at_ms: now_ms(),
        };
        self.jobs.insert(job.id.clone(), job.clone());
        let _ = self.flush();
        job
    }

    pub fn get(&self, id: &str) -> Option<&Job> { self.jobs.get(id) }

    pub fn update(&mut self, id: &str, status: JobStatus, progress: u32, message: &str) -> Result<()> {
        let job = self.jobs.get_mut(id).ok_or_else(|| PulseError::Editor(format!("job {id} not found")))?;
        job.status = status;
        job.progress = progress;
        job.message = message.to_string();
        self.flush()
    }

    pub fn finish(&mut self, id: &str, clip_ids: Vec<String>) -> Result<()> {
        let job = self.jobs.get_mut(id).ok_or_else(|| PulseError::Editor(format!("job {id} not found")))?;
        job.status = JobStatus::Done;
        job.progress = 100;
        job.message = format!("{} clip(s) ready", clip_ids.len());
        job.clip_ids = clip_ids;
        self.flush()
    }

    pub fn fail(&mut self, id: &str, message: &str) -> Result<()> {
        self.update(id, JobStatus::Failed, 100, message)
    }

    pub fn list(&self) -> Vec<&Job> {
        let mut v: Vec<_> = self.jobs.values().collect();
        v.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        v
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_lifecycle() {
        let dir = std::env::temp_dir().join(format!("pcut-jobs-{}", uuid::Uuid::new_v4()));
        let mut s = JobStore::open(&dir).unwrap();
        let j = s.create("https://example.com/v.mp4");
        assert_eq!(j.status, JobStatus::Queued);
        s.update(&j.id, JobStatus::Downloading, 20, "fetching").unwrap();
        s.finish(&j.id, vec!["c1".into()]).unwrap();
        assert_eq!(s.get(&j.id).unwrap().status, JobStatus::Done);
        assert_eq!(s.get(&j.id).unwrap().clip_ids.len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
