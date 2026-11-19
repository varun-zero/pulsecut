//! Shared types, configuration and errors for PulseCut.
//!
//! This crate deliberately has no I/O dependencies. Every other crate speaks
//! in terms of the types defined here, which keeps the pipeline testable.

pub mod config;
pub mod edl;
pub mod error;
pub mod model;

pub use config::{AiConfig, CaptureConfig, Config, DetectionConfig, PlatformTarget, PublishingConfig, RenderConfig};
pub use edl::{EditDecisionList, EditOp};
pub use error::{PulseError, Result};
pub use model::{
    ChatMessage, ClipPackage, ClipStatus, ClipWindow, HypeEvent, Platform, PlatformProfile,
    Word,
};
