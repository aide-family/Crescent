---
name: application-network-research
description: "Application network research and connectivity investigation: verify DNS, HTTP/HTTPS, TLS certificates, proxy/VPN/firewall constraints, external reachability, API endpoints, and online documentation lookup. Use when the user asks to check whether an application, domain, URL, service endpoint, website, webhook, or external dependency can connect or be reached; also supports 应用联网检查、网络连通性、DNS 解析、HTTP/TLS 检查、代理/VPN/防火墙排查、外部文档检索。"
aliases: ["application network connectivity", "DNS HTTP TLS check", "endpoint reachability investigation", "external dependency lookup", "应用联网检查", "网络连通性排查", "域名 DNS 解析检查", "HTTPS TLS 检查", "接口连通性验证"]
---

# Application Network Research

Use this skill when the user asks to verify application network connectivity, investigate online reachability, check DNS/TLS/HTTP behavior, or gather external information for an application.

## Workflow

1. Clarify the target application, domain, endpoint, environment, and whether external network access is allowed.
2. Prefer configured search, browser, OpenAPI, or retrieval tools when available. If no retrieval tool is configured, state the limitation and use terminal network checks only when appropriate.
3. For connectivity checks, use bounded read-only commands such as `dig`, `nslookup`, `curl -I --max-time`, `openssl s_client`, `traceroute`, or `nc -vz` as available.
4. Respect proxy, VPN, firewall, and internal-network constraints. Do not bypass access controls.
5. Separate observed local connectivity from external documentation or search findings.
6. Summarize sources, commands, status codes, DNS answers, TLS validity, latency symptoms, and next steps.

## Safety

Avoid load tests, credential submission, destructive API calls, or scans across broad ranges unless explicitly approved.
