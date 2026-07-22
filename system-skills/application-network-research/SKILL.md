---
name: application-network-research
description: Research application connectivity and online information safely, including DNS, HTTP/TLS reachability, proxy constraints, external documentation lookup via available tools, and evidence-based summaries.
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
