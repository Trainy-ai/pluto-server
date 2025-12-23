use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum StatusCode {
    Init,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InitData {
    pub run_id: String,
    pub run_name: String,
    pub project_id: String,
    pub metadata: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StatusRequest {
    pub status: StatusCode,
    pub data: InitData,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StatusResponse {
    pub message: String,
}
