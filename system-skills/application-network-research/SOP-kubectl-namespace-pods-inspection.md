# SOP：查看 / 巡检 Kubernetes 命名空间 Pods

- 适用范围：对已有 kubectl 权限的集群查看或巡检指定命名空间的 Pods（含 default）
- 前置条件：终端已登录到可访问目标集群的环境，`kubectl` 可用，集群上下文正确
- 操作性质：全部为只读命令，无状态变更、无写操作
- 验证实例：aide 测试集群（单节点 node-1，v1.35.5），`default` 命名空间

## 步骤

1. 环境确认（只读，可合并执行）
   ```bash
   kubectl version --short
   kubectl get nodes -o wide
   ```

2. 概览：列出目标命名空间全部 Pods
   ```bash
   kubectl get pods -n <namespace> -o wide
   ```

3. 定位异常：过滤非 Running / Completed 的 Pod
   ```bash
   kubectl get pods -n <namespace> --no-headers | awk '$4!="Running"&&$4!="Completed"'
   ```

4. 仅对异常 Pod 深钻（每个异常 Pod 独立执行一次，不批量深钻健康 Pod）
   ```bash
   kubectl describe pod <pod> -n <namespace>
   kubectl logs <pod> -n <namespace> --tail=100
   ```

5. 健康服务按命名空间聚合为一行，不逐 Pod 罗列。

## 报告模板（问题前置，仅输出一次）

- **❌ 异常服务**｜表格置顶：服务 / 命名空间 / 状态 / 原因
- **🔧 修复建议**｜编号列表，每条可直接执行
- **✅ 健康摘要**｜每命名空间一行
- **概览**｜节点 / 版本 / 运行时间 / 内存 / 磁盘
- **总体评价**｜≤2 句

## 注意事项

- 连续信息采集把多个只读命令写在同一次 bash 调用中（用 `;` 分隔）；写操作必须独立成单独调用。
- 禁止在任务末尾启动后台进程（`&` / `nohup`）、`kill`、常驻 `port-forward`；需要临时 port-forward 时用单条前台命令包裹超时（`timeout 8 sh -c '...& PF=$!; sleep 2; curl ...; kill $PF'`），不留残留进程。
- 同一命令失败后不原样重试，先分析 stderr 再换方案。
- 容器内无 curl/wget 时访问集群内服务优先 `kubectl port-forward`，避免 exec curl → exec wget → port-forward 的试错链。
- 图类输出一律用 mermaid 代码块，禁止 ASCII 框线图。
