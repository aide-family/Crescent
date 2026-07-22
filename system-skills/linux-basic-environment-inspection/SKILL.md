---
name: linux-basic-environment-inspection
description: Inspect Linux base environments, including OS version, kernel, CPU, memory, disk, filesystem, network, DNS, time sync, services, logs, users, limits, and security posture.
---

# Linux Basic Environment Inspection

Use this skill when the user asks for Linux host inspection, baseline health checks, resource diagnosis, operating-system inventory, or preflight validation.

## Workflow

1. Identify host, user, OS release, kernel, uptime, timezone, and virtualization/container context.
2. Check CPU, memory, swap, disk usage, inode usage, mount points, filesystems, and high-load processes.
3. Check network interfaces, routes, DNS configuration, listening ports, firewall state, and connectivity only to user-relevant targets.
4. Check time sync, critical services, failed systemd units, recent kernel/system logs, and security-relevant limits.
5. Keep commands read-only unless the user asks for remediation. Ask for approval before service restarts, config writes, cleanup, or package operations.
6. If a report is requested without a destination, finish the inspection summary first and ask for a local Crescent-machine path.

## Useful Read-Only Checks

- `hostnamectl`, `uname -a`, `uptime`, `date`
- `free -h`, `df -hT`, `df -ih`, `lsblk`
- `top -b -n1` or `ps aux --sort=-%mem | head`
- `ip addr`, `ip route`, `ss -lntup`
- `systemctl --failed`, `journalctl -p warning -n 200 --no-pager`

## Output

Report normal baseline, abnormal findings, evidence, impact, and recommended next checks or remediation.
