//! Durable-style publish queue with an explicit human approval gate.
//!
//! Auto-posting every detected spike is a great way to publish a clip of a
//! raid banner. By default a clip must be approved in the editor before it
//! leaves the machine; `auto_approve` is an explicit opt-in for unattended
//! channels.

use pulsecut_core::error::{PulseError, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueStatus {
    PendingApproval,
    Approved,
    Publishing,
    Published,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishRequest {
    pub package_id: String,
    pub video_path: String,
    pub targets: Vec<String>,
    pub token_env: String,
    pub title: String,
    pub description: String,
    pub hashtags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub id: String,
    pub request: PublishRequest,
    pub status: QueueStatus,
    pub created_at_ms: i64,
    pub attempts: u32,
    pub last_error: Option<String>,
}

#[derive(Debug)]
pub struct PublishQueue {
    pub items: Vec<QueueItem>,
    pub auto_approve: bool,
    pub spacing_ms: i64,
    last_publish_ms: i64,
}

impl PublishQueue {
    pub fn new(auto_approve: bool, spacing_secs: u32) -> Self {
        Self { items: Vec::new(), auto_approve, spacing_ms: spacing_secs as i64 * 1000, last_publish_ms: i64::MIN / 4 }
    }

    pub fn enqueue(&mut self, request: PublishRequest, now_ms: i64) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.items.push(QueueItem {
            id: id.clone(), request,
            status: if self.auto_approve { QueueStatus::Approved } else { QueueStatus::PendingApproval },
            created_at_ms: now_ms, attempts: 0, last_error: None,
        });
        id
    }

    pub fn approve(&mut self, id: &str) -> Result<()> {
        let item = self.items.iter_mut().find(|i| i.id == id)
            .ok_or_else(|| PulseError::Publish(format!("queue item {id} not found")))?;
        if item.status != QueueStatus::PendingApproval {
            return Err(PulseError::Publish(format!("item {id} is {:?}, not pending", item.status)));
        }
        item.status = QueueStatus::Approved;
        Ok(())
    }

    pub fn reject(&mut self, id: &str) -> Result<()> {
        let item = self.items.iter_mut().find(|i| i.id == id)
            .ok_or_else(|| PulseError::Publish(format!("queue item {id} not found")))?;
        item.status = QueueStatus::Failed;
        item.last_error = Some("rejected by editor".into());
        Ok(())
    }

    /// Next item that is approved and respects publish spacing.
    pub fn next_due(&mut self, now_ms: i64) -> Option<QueueItem> {
        if now_ms - self.last_publish_ms < self.spacing_ms {
            return None;
        }
        let idx = self.items.iter().position(|i| i.status == QueueStatus::Approved)?;
        let item = self.items[idx].clone();
        self.items[idx].status = QueueStatus::Publishing;
        self.items[idx].attempts += 1;
        self.last_publish_ms = now_ms;
        Some(item)
    }

    pub fn finish(&mut self, id: &str, ok: bool, error: Option<String>) -> Result<()> {
        let item = self.items.iter_mut().find(|i| i.id == id)
            .ok_or_else(|| PulseError::Publish(format!("queue item {id} not found")))?;
        item.status = if ok { QueueStatus::Published } else { QueueStatus::Failed };
        item.last_error = error;
        Ok(())
    }

    pub fn pending_count(&self) -> usize {
        self.items.iter().filter(|i| i.status == QueueStatus::PendingApproval).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> PublishRequest {
        PublishRequest {
            package_id: "p".into(), video_path: "v.mp4".into(), targets: vec!["tiktok".into()],
            token_env: "TOKEN".into(), title: "t".into(), description: "d".into(), hashtags: vec![],
        }
    }

    #[test]
    fn approval_gate_blocks_by_default() {
        let mut q = PublishQueue::new(false, 0);
        q.enqueue(req(), 1000);
        assert_eq!(q.pending_count(), 1);
        assert!(q.next_due(1000).is_none());
        let id = q.items[0].id.clone();
        q.approve(&id).unwrap();
        assert!(q.next_due(1000).is_some());
    }

    #[test]
    fn auto_approve_and_spacing() {
        // spacing is expressed in seconds by the config; 1s = 1000ms here.
        let mut q = PublishQueue::new(true, 1);
        q.enqueue(req(), 0);
        assert!(q.next_due(0).is_some());
        q.enqueue(req(), 100);
        assert!(q.next_due(100).is_none());
        assert!(q.next_due(1100).is_some());
    }
}
