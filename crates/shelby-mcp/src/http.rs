//! Streamable HTTP transport with the discovery and health endpoints the TS server exposes.
use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{any, get};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use serde_json::json;

use crate::VERSION;
use crate::config::ServeConfig;
use crate::server::{SharedMemory, ShelbyServer};

fn discovery() -> serde_json::Value {
    json!({
        "name": "shelbymcp",
        "version": VERSION,
        "description": "Knowledge-graph memory server for AI tools via MCP",
        "transport": "streamable-http",
        "endpoint": "/mcp",
        "capabilities": { "tools": 12, "prompts": 3, "resources": 1, "logging": true, "completions": true }
    })
}

async fn oauth_not_configured() -> Response {
    (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "oauth_not_configured", "error_description": "Set SHELBY_API_KEY to enable OAuth" }))).into_response()
}

#[derive(Clone)]
struct Auth {
    api_key: Option<String>,
}

async fn bearer_guard(State(auth): State<Auth>, req: Request<Body>, next: Next) -> Response {
    if let Some(key) = &auth.api_key {
        let token = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("");
        if !crate::oauth::verify_bearer_token(token, key) {
            return (
                StatusCode::UNAUTHORIZED,
                [(header::WWW_AUTHENTICATE, "Bearer")],
                Json(json!({ "jsonrpc": "2.0", "error": { "code": -32001, "message": "Unauthorized" }, "id": null })),
            )
                .into_response();
        }
    }
    next.run(req).await
}

pub async fn serve(memory: SharedMemory, cfg: &ServeConfig) -> std::io::Result<()> {
    let mut config = StreamableHttpServerConfig::default();
    if cfg.http_host == "0.0.0.0" || cfg.http_host == "::" {
        // Container/remote deployments: the Host header is whatever the operator exposes.
        config = config.disable_allowed_hosts();
    } else {
        config = config.with_allowed_hosts([
            "localhost".to_string(),
            "127.0.0.1".into(),
            "::1".into(),
            cfg.http_host.clone(),
            format!("{}:{}", cfg.http_host, cfg.http_port),
            format!("localhost:{}", cfg.http_port),
            format!("127.0.0.1:{}", cfg.http_port),
        ]);
    }
    let handler_memory = memory.clone();
    let mcp = StreamableHttpService::new(
        move || Ok(ShelbyServer::new(handler_memory.clone())),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let auth = Auth {
        api_key: cfg.api_key.clone(),
    };
    let oauth: axum::Router = match &cfg.api_key {
        Some(key) => {
            crate::oauth::router(crate::oauth::OAuthState::new(key.clone(), memory.clone()))
        }
        None => axum::Router::new()
            .route(
                "/.well-known/oauth-authorization-server",
                get(oauth_not_configured),
            )
            .route("/register", any(oauth_not_configured))
            .route("/authorize", any(oauth_not_configured))
            .route("/token", any(oauth_not_configured)),
    };
    let app = axum::Router::new()
        .route("/health", get(|| async { Json(json!({ "status": "ok" })) }))
        .route("/.well-known/mcp.json", get(|| async { Json(discovery()) }))
        .route(
            "/.well-known/mcp/server.json",
            get(|| async { Json(discovery()) }),
        )
        .merge(oauth)
        .nest_service(
            "/mcp",
            axum::Router::new()
                .fallback_service(mcp)
                .layer(middleware::from_fn_with_state(auth, bearer_guard)),
        )
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found" }))) });
    let listener = tokio::net::TcpListener::bind((cfg.http_host.as_str(), cfg.http_port)).await?;
    eprintln!(
        "[INFO] shelby-mcp running on http://{}:{}/mcp",
        cfg.http_host, cfg.http_port
    );
    if cfg.api_key.is_some() {
        eprintln!("[INFO] Bearer token auth enabled");
    } else {
        eprintln!("[WARN] No SHELBY_API_KEY set — running without auth");
    }
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
}
