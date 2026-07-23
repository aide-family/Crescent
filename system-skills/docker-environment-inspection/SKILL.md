---
name: docker-environment-inspection
description: "Docker environment inspection and troubleshooting: check Docker daemon status, client/server versions, containers, images, volumes, networks, Compose projects, storage driver, logs, restart loops, disk usage, and resource pressure. Use when the user asks to inspect Docker, docker compose, container runtime, image/container/network/volume problems, 容器环境巡检, Docker 环境检查, 容器日志, 容器网络, 镜像, 卷, or daemon issues."
aliases: ["Docker environment inspection", "Docker daemon health check", "Docker Compose inspection", "container runtime troubleshooting", "Docker 环境巡检", "Docker 容器检查", "容器网络检查", "容器日志排查", "镜像卷网络巡检"]
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
