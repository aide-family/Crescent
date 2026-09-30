# Quick start

1. Open Crescent after [installing](/en/guide/install) it.
2. Configure an OpenAI-compatible model provider and select a model.
3. Describe the check you want beside the terminal.

For the current machine:

```text
Check the current machine's disk, memory, and system services, then summarize abnormal findings and recommendations.
```

For a remote environment you have already configured:

```text
Connect to production, inspect abnormal Pods in the Kubernetes cluster, and summarize the troubleshooting result.
```

The Agent inspects the current terminal, runs one useful command, reads the output, and then continues, applies a fix, or summarizes. High-risk commands go through [command review](/en/guide/command-review) first.

## What one loop looks like

1. Understand the goal.
2. See which machine and directory the terminal is on.
3. Run one useful command.
4. Analyze the output.
5. Keep checking, apply a fix, or write the conclusion.

Inspections, pre-deployment checks, and troubleshooting fit this pace. The goal is not one unattended script.
