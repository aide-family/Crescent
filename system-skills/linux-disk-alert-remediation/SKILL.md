---
name: linux-disk-alert-remediation
description: 'Linux disk usage alert remediation and cleanup workflow: handle filesystem usage alerts such as /home, /var, /data, /var/lib, or root partition over 80/90/95%, low available space, inode pressure, large files, deleted-but-open files, logs, cache, backup, tmp, Docker/container disk usage, and safe cleanup verification. Use when the user asks to handle, process, fix, remediate, or close a disk alert, 磁盘告警, 分区使用率超过阈值, 可用空间不足, /home 使用率超过 90%, 清理磁盘, 大文件排查, 日志清理。'
aliases:
  [
    'Linux disk alert handling',
    'filesystem usage remediation',
    'disk cleanup workflow',
    'partition usage alert',
    '磁盘告警处理',
    '分区使用率告警',
    '磁盘空间清理',
    '/home 分区告警',
    '大文件排查',
    '日志清理'
  ]
---

# Linux Disk Alert Remediation

Use this skill when the user asks to handle or remediate a disk usage alert on a Linux host, for example a filesystem over 90%, available space below a threshold, inode pressure, or a named mount such as `/home`, `/var`, `/data`, `/var/lib`, or `/`.

## Goals

1. Confirm the alert is on the intended host and filesystem.
2. Use any SOP named in the alert before falling back to the built-in workflow.
3. Identify what is consuming space without crossing filesystem boundaries unless needed.
4. Separate safe cleanup candidates from business data.
5. Ask for approval before any destructive or state-changing cleanup.
6. Verify the alert condition after cleanup and summarize evidence.

## Fast Investigation Budget

Disk alerts are often handled through an interactive terminal where long recursive scans can make the agent appear stuck or exceed command-settle timeouts. Prefer quick, bounded probes first and only deepen the search when earlier evidence narrows the path.

- Default to commands that normally return within 5-20 seconds. Use `timeout` around recursive `du`, `find`, and `lsof` probes when available.
- Do not start with broad full-mount scans such as unbounded `du -sh *`, `du -xhd1 <mount>` without `timeout`, `find <mount> ... | sort ...`, or `/proc/*/fd` walks. These are fallback-only after faster evidence points to a need.
- Run one command at a time for expensive probes and inspect the result before deciding the next path. Avoid launching multiple recursive scans in parallel on a busy host.
- Prefer high-signal, bounded candidate checks over exhaustive inventory: inspect common known directories, the largest directory from the previous completed step, and alert-SOP paths before scanning the whole mount.
- If a bounded probe times out, stop deepening that branch. Report the timeout, keep the partial evidence if any, and ask for a narrower path, maintenance window, or approval for a heavier scan.

## Mandatory Triage Rules

- Treat the alert host and mount as the scope. For an alert like `10.0.0.42 /home`, keep the investigation centered on host `10.0.0.42` and filesystem `/home`.
- If the alert names SOPs such as `Home 盘磁盘空间不足清理 SOP` or `ETL 机器磁盘空间不足清理 SOP`, first use the knowledge-base SOP context supplied to the agent. If the named SOP is not present in the supplied context, say that it was not available locally and continue with this built-in fallback workflow.
- Prefer a real host shell or root host view for the target machine. If the current terminal is already on the target host, stay there. If the current terminal is on another host or a jump host, use `ssh <target> '<concrete read-only command>'` or another existing approved access path to collect the target host evidence.
- Do not turn a host filesystem alert into broad Kubernetes exploration. At most, use Kubernetes once to map an alert IP to a node name or confirm that a known workload uses `/home`; then return to host-level filesystem evidence.
- Do not use `kubectl exec` into `node-exporter`, `calico`, logging agents, or business Pods as the primary path. These are fallback-only, read-only probes and must stop after one failed or permission-limited attempt.
- Do not propose creating a privileged troubleshooting Pod unless all of these are true: direct host/root access is unavailable, safer read-only paths are exhausted, the suspected cause cannot be identified from existing evidence, and the user explicitly approves creating a temporary privileged Pod.
- If `du`, `find`, or `lsof` hits permission denied on important directories, summarize what is known, list the blocked paths, and ask for host/root access or approval for a specific escalation. Do not continue scanning unrelated containers or cluster resources.

## Workflow

1. Parse the alert:
   - Target cluster or environment, if present.
   - Target host/IP/FQDN.
   - Target mount, threshold, current usage, and available-space condition.
   - Named SOPs from the alert text.
2. Confirm context and alert state:
   - `hostname -f 2>/dev/null || hostname`
   - `date`
   - `df -hT <mount>`
   - `df -ih <mount>`
   - `findmnt <mount>`
3. Build a quick candidate list before recursive scans:
   - `find <mount> -xdev -maxdepth 1 -mindepth 1 -printf '%y %p\n' 2>/dev/null | head -80`
   - For `/home` and ETL hosts, check only existing high-value paths first with bounded `du`:
     `for p in /home/work /home/admin /home/rd /home/zabbix /home/nexus/data /home/.varlibdocker /home/work/marathon /home/work/docker/logs /home/work/docker/data; do [ -e "$p" ] && timeout 15s du -xsh "$p" 2>/dev/null; done | sort -h`
4. Locate top-level usage only with a timeout:
   - `timeout 20s du -xhd1 <mount> 2>/dev/null | sort -h | tail -30`
   - Continue with `timeout 20s du -xhd1 <largest-dir> 2>/dev/null | sort -h | tail -30` only when the previous command completes and clearly identifies a large directory.
   - If `timeout` is unavailable, mention it and run at most one `du -xhd1` probe on the most likely narrow path rather than the whole mount.
5. For `/home` and ETL hosts, inspect common high-value paths in this order when they exist:
   - `/home/work`
   - `/home/admin`
   - `/home/rd`
   - `/home/zabbix`
   - `/home/nexus/data`
   - `/home/.varlibdocker`
   - `/home/work/marathon`
   - `/home/work/docker/logs`
   - `/home/work/docker/data`
   - Old logs, caches, temporary directories, old backups, old packages, and old ETL intermediate outputs under the largest directory.
6. Check common hidden causes with bounded probes, and only after quick directory checks:
   - Deleted but still open files: `timeout 15s lsof +L1 <mount> 2>/dev/null | awk 'NR==1 || $7 > 104857600 {print}' | tail -30`
   - Large files under a narrowed suspect path: `timeout 20s find <suspect-path> -xdev -type f -size +1G -printf '%s %TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | head -100`
   - Recent growth under a narrowed suspect path: `timeout 20s find <suspect-path> -xdev -type f -mtime -7 -size +100M -printf '%s %TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | head -100`
   - Avoid `find <mount> ... | sort -n | tail` as a default because sorting full-mount results can be slower than the scan itself.
7. Classify cleanup candidates:
   - Usually safe after confirmation: rotated logs, compressed old logs, old temporary files, package/cache directories, old build artifacts, duplicate archives, obsolete backups with retention evidence.
   - Requires explicit user approval and extra evidence: active logs, application data, database files, container volumes, user uploads, release artifacts, anything under unknown business directories.
   - Never delete only because a file is large.
8. For cleanup, propose exact commands and expected freed space first. Run only after approval:
   - Prefer bounded deletion of confirmed old logs/caches.
   - Prefer truncate over delete only for active log files when the owning service is understood.
   - If deleted-but-open files are the cause, identify the owning process and ask before restart/reload.
9. Verify:
   - Re-run `df -hT <mount>` and the relevant `du` command.
   - State before/after usage, freed space, what was cleaned, remaining risks, and whether the alert threshold is cleared.

## Safety Rules

- Start read-only. Do not delete, truncate, compress, move, restart services, or change configs before evidence and approval.
- Keep commands scoped to the alerted mount. Use `-xdev` for `du` and `find`.
- Keep recursive investigation bounded. Use `timeout` for `du`, `find`, and `lsof`; if a command times out, do not immediately retry with a broader or more expensive command.
- If the SSH session is closed or the terminal is no longer on the target host, reconnect or ask for reconnection before continuing. Do not run host cleanup checks on the local Crescent machine.
- If the user supplied a target host in the alert, verify `hostname` matches before any cleanup.
- If permission is denied, report the missing permission and continue with available evidence; do not invent sudo access.
- If the user explicitly says not to SSH, not to reconnect, or current-terminal-only, ask before using SSH. Do not treat generic post-login instructions from Crescent as a ban on SSH to the affected host.
- Treat delete, truncate, compress, move, service restart, Docker cleanup, Kubernetes resource creation, and privileged Pod creation as state-changing operations that need explicit user approval.

## Output

Return a concise incident-style summary:

- Target host and filesystem.
- Alert state before handling.
- Main space consumers with evidence.
- Cleanup decision and commands actually executed.
- Alert state after handling.
- Remaining risk and follow-up recommendations.
