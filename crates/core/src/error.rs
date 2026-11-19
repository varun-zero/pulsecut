use thiserror::Error;

/// Every fallible operation in PulseCut returns this error type.
///
/// Keeping a single crate-level error makes it easy to report failures from
/// the chat listeners, the ffmpeg wrapper, the AI backends and the publishers
/// through one API boundary.
#[derive(Debug, Error)]
pub enum PulseError {
    #[error("configuration error: {0}")]
    Config(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("external process failed: {0}")]
    Process(String),

    #[error("HTTP request failed: {0}")]
    Http(String),

    #[error("chat connector error: {0}")]
    Chat(String),

    #[error("detector error: {0}")]
    Detect(String),

    #[error("render error: {0}")]
    Render(String),

    #[error("AI backend error: {0}")]
    Ai(String),

    #[error("publisher error: {0}")]
    Publish(String),

    #[error("editor error: {0}")]
    Editor(String),

    #[error("not implemented: {0}")]
    NotImplemented(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, PulseError>;
