---
name: k8s-version-cluster-inspection
description: "Kubernetes/K8s version-aware cluster inspection and troubleshooting: inspect cluster version, nodes, roles, workloads, pods, events, storage, networking, ingress, services, CoreDNS, CNI, add-ons, API resources, deprecated APIs, and upgrade-sensitive behavior. Use when the user asks to inspect, audit,巡检, 排查, troubleshoot, health-check, or produce an operations report for Kubernetes/K8s 集群状态、版本、节点、Pod 异常、存储、网络、事件、升级兼容性。"
aliases: ["Kubernetes cluster inspection", "K8s health check", "K8s version audit", "kubectl cluster report", "K8s 集群巡检", "Kubernetes 集群检查", "集群版本检查", "节点 Pod 事件存储巡检", "集群健康检查"]
---

# Kubernetes Version-Aware Cluster Inspection

Use this skill when the user asks to inspect, audit, troubleshoot, or produce an operations report for a Kubernetes or K8s cluster.

## Workflow

1. Confirm the active cluster context before running checks. Use read-only commands first.
2. Identify the Kubernetes server version and adapt checks to that version. Prefer stable commands such as `kubectl version --short`, `kubectl get nodes -o wide`, `kubectl get pods -A`, and `kubectl get events -A --sort-by=.lastTimestamp`.
3. Check nodes, control-plane components, system namespaces, workloads, storage, networking, ingress, services, events, and recent restarts.
4. For version-sensitive behavior, avoid deprecated assumptions. Check API availability with `kubectl api-resources` or `kubectl explain` before using version-specific fields.
5. For risky fixes, collect evidence first and ask for approval before changing resources.
6. If the user wants a report and did not provide a local destination, summarize findings first and ask for a Crescent client-machine directory before writing.

## Minimum Read-Only Evidence

- Cluster context and server version.
- Node readiness, roles, Kubernetes versions, container runtime, and taints.
- Non-running pods, restart counts, pending pods, CrashLoopBackOff, ImagePullBackOff, and unhealthy workloads.
- PV/PVC state, StorageClass configuration, and volume attachment issues.
- Services, ingress/controllers, CoreDNS, CNI-related pods, and recent warning events.

## Output

Return a concise inspection summary with checked scope, abnormal findings, affected namespaces or nodes, evidence commands, and recommended next steps.
