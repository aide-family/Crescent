---
name: application-program-inspection
description: "Application program and service inspection: inspect processes, ports, systemd services, logs, configuration, health endpoints, dependencies, runtime metrics, deployment state, and common middleware. Use when the user asks to inspect, troubleshoot, audit,巡检, 排查, or diagnose an application, API service, web service, daemon, worker, middleware, gateway, Nginx, Redis, MySQL, PostgreSQL, Elasticsearch, Java, Node.js, Go, Python, or Kubernetes workload; supports 应用服务、服务端口、进程、日志、配置、健康检查接口、依赖连通性、运行状态、应用程序检查。"
aliases: ["application service inspection", "service port log health check", "middleware troubleshooting", "API service diagnosis", "应用服务巡检", "应用程序检查", "服务端口日志排查", "健康检查接口诊断", "中间件服务检查"]
---

# Application Program Inspection

Use this skill when the user asks to inspect or troubleshoot an application, service, program, middleware component, API service, web service, worker, or daemon.

## Workflow

1. Identify the application name, host, deployment mode, service manager, runtime, ports, config paths, and expected health endpoint.
2. Check process state, listening ports, service status, recent logs, resource usage, dependency connectivity, and configuration drift with read-only commands.
3. Adapt to the application stack: systemd service, Docker container, Kubernetes workload, Java, Node.js, Go, Python, Nginx, Redis, MySQL, PostgreSQL, Elasticsearch, or custom daemons.
4. Avoid restarts, cleanup, migrations, config edits, or data changes until evidence supports the action and the user approves.
5. For multi-component applications, inspect from the entrypoint inward: gateway/load balancer, service, runtime, dependency, storage, and background jobs.
6. If a report is needed, ask for a local Crescent-machine destination unless the user already supplied one.

## Output

Summarize health state, affected components, evidence, likely causes, risk, and a prioritized next-action list.
