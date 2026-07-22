---
name: docker-environment-inspection
description: Inspect Docker runtime environments, including daemon status, versions, containers, images, storage, logs, networks, compose projects, resource pressure, and safety checks.
---

# Docker Environment Inspection

Use this skill when the user asks to inspect or troubleshoot a Docker host, Docker daemon, Docker Compose workload, container runtime, image, network, or storage issue.

## Workflow

1. Confirm host identity and Docker availability with read-only commands.
2. Check Docker client/server versions, daemon status, runtime info, storage driver, root dir, cgroup mode, and logging driver.
3. Inspect container health, restart loops, exited containers, image usage, volumes, networks, and disk pressure.
4. For Compose deployments, identify project files and use read-only `docker compose ps`, `config`, and bounded logs where safe.
5. Avoid destructive commands such as prune, rm, restart, or image deletion unless the user explicitly approves after evidence review.
6. If creating a report, write it only to a user-specified or user-confirmed local Crescent machine path.

## Useful Read-Only Checks

- `docker version`, `docker info`, `systemctl status docker`
- `docker ps -a --no-trunc`
- `docker stats --no-stream`
- `docker system df`
- `docker network ls`, `docker volume ls`
- Bounded logs: `docker logs --tail 200 <container>`

## Output

Summarize daemon state, container health, storage pressure, abnormal containers, likely causes, and next recommended actions.
