---
name: application-program-inspection
description: Inspect application programs and services across common stacks, including processes, ports, service managers, logs, configuration, health endpoints, dependencies, runtime metrics, and deployment state.
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
