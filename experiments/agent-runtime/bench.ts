import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { classifyByStaticRules } from '../../src/shared/command-guard.ts'
import { createOpenAiExperiment } from './openai.ts'
import { createClineExperiment } from './cline.ts'
import type { ExperimentOptions, ExperimentEvent, HostTool, ToolCall } from './types.ts'

// Fixtures represent host decisions and transports. They perform no filesystem, SSH or shell work.
const cases = [
  { name: 'readonly', command: 'kubectl get pods', expected: 1, approvals: 0 },
  { name: 'approved-write', command: 'kubectl delete pod fixture', expected: 1, approvals: 1 },
  { name: 'rejected-write', command: 'rm fixture', expected: 0, approvals: 1, deny: true },
  {
    name: 'target-drift-after-approval',
    command: 'kubectl delete pod fixture',
    expected: 0,
    approvals: 1,
    drift: true
  },
  {
    name: 'ssh-unavailable',
    command: 'kubectl get pods',
    expected: 0,
    approvals: 0,
    unavailable: true
  },
  { name: 'timeout', command: 'kubectl get pods', expected: 0, approvals: 0, timeout: true },
  {
    name: 'cancel-pending-approval',
    command: 'rm fixture',
    expected: 0,
    approvals: 1,
    cancel: true
  },
  {
    name: 'mcp-write-denied',
    command: 'mcp mutation',
    toolName: 'host_mcp',
    expected: 0,
    approvals: 1,
    deny: true
  },
  {
    name: 'subagent-host-tools',
    command: 'kubectl get pods',
    toolName: 'host_subagent',
    expected: 1,
    approvals: 0
  },
  {
    name: 'sequential-tools',
    command: 'kubectl get pods',
    expected: 2,
    approvals: 0,
    parallel: true
  },
  {
    name: 'unknown-command',
    command: 'unrecognized fixture',
    expected: 0,
    approvals: 1,
    deny: true
  }
]
const results: Record<string, unknown>[] = []
for (const create of [createOpenAiExperiment, createClineExperiment]) {
  for (const scenario of cases) {
    const controller = new AbortController()
    const events: ExperimentEvent[] = []
    let approvals = 0,
      executions = 0,
      target = 'fixture-host-a',
      active = 0,
      maxActive = 0
    const toolName = scenario.toolName ?? 'host_command'
    const host: HostTool = {
      name: toolName,
      description: 'Host-owned fixture capability; all execution is reviewed by the host.',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
        additionalProperties: false
      },
      async execute(input, signal) {
        const startedTarget = target
        if (
          !input ||
          typeof input !== 'object' ||
          !('command' in input) ||
          typeof input.command !== 'string'
        )
          throw new Error('INVALID_ARGUMENTS')
        signal?.throwIfAborted()
        if (scenario.unavailable) throw new Error('SSH_TARGET_UNAVAILABLE')
        if (classifyByStaticRules(input.command) !== 'low') {
          approvals++
          if (scenario.cancel) {
            controller.abort()
            signal?.throwIfAborted()
            throw new Error('CANCELED')
          }
          if (scenario.deny) throw new Error('APPROVAL_DENIED')
          if (scenario.drift) target = 'fixture-host-b'
        }
        signal?.throwIfAborted()
        if (target !== startedTarget) throw new Error('SSH_TARGET_CHANGED')
        if (scenario.timeout)
          await delay(1000, undefined, {
            signal: AbortSignal.any([signal ?? controller.signal, AbortSignal.timeout(20)])
          })
        active++
        maxActive = Math.max(maxActive, active)
        try {
          await delay(5, undefined, { signal })
          executions++
          return { ok: true, output: 'fixture result' }
        } finally {
          active--
        }
      }
    }
    const calls: ToolCall[] = Array.from({ length: scenario.parallel ? 2 : 1 }, () => ({
      name: toolName,
      input: { command: scenario.command }
    }))
    const options: ExperimentOptions = { tools: [host], calls, emit: (event) => events.push(event) }
    const runtime = create(options)
    const start = performance.now()
    let error: string | undefined
    try {
      await runtime.run('Execute the fixture request.', controller.signal)
    } catch (e) {
      error = e instanceof Error ? e.name : String(e)
    } finally {
      runtime.abort()
    }
    assert.equal(
      executions,
      scenario.expected,
      `${runtime.id}/${scenario.name}: executed wrong number of side effects`
    )
    assert.equal(
      approvals,
      scenario.approvals,
      `${runtime.id}/${scenario.name}: wrong approval count`
    )
    assert.ok(maxActive <= 1, `${runtime.id}: mutation ordering changed`)
    results.push({
      runtime: runtime.id,
      scenario: scenario.name,
      passed: true,
      fixture: true,
      approvals,
      executions,
      maxActive,
      streamTokens: events.filter((x) => x.type === 'token').length,
      toolEvents: events.filter((x) => x.type !== 'token').length,
      elapsedMs: Math.round(performance.now() - start),
      ...(error ? { error } : {})
    })
  }
  const runtime = create({ tools: [], calls: [] })
  await runtime.run('First fixture turn')
  const snapshot = JSON.parse(JSON.stringify(runtime.save()))
  const restored = create({ tools: [], calls: [] })
  restored.restore(snapshot)
  const output = await restored.run('Resume from the host-owned transcript')
  assert.ok(output.length)
  assert.ok(JSON.stringify(restored.save()).length > JSON.stringify(snapshot).length)
  results.push({ runtime: runtime.id, scenario: 'transcript-resume', passed: true, fixture: true })
}

if (process.argv.includes('--live')) {
  assert.ok(process.env.OPENAI_API_KEY, 'Existing OpenAI key is required')
  let probes = 0
  const host: HostTool = {
    name: 'host_probe',
    description: 'Return a fixed fixture marker. No OS or network access.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    async execute(_input, signal) {
      signal?.throwIfAborted()
      probes++
      return { marker: 'fixture-ok' }
    }
  }
  const runtime = createOpenAiExperiment({
    tools: [host],
    liveModel: process.env.CRESCENT_POC_MODEL ?? 'gpt-4.1-mini'
  })
  try {
    const output = await runtime.run(
      'Call host_probe exactly once and then reply HOST_COMPLETE.',
      AbortSignal.timeout(45000)
    )
    assert.equal(probes, 1)
    assert.ok(output.includes('HOST_COMPLETE'))
    results.push({
      runtime: runtime.id,
      scenario: 'live-model-host-tool',
      passed: true,
      fixture: false,
      api: process.env.CRESCENT_POC_CHAT === '1' ? 'chat-completions' : 'responses',
      probes,
      model: process.env.CRESCENT_POC_MODEL ?? 'gpt-4.1-mini'
    })
  } catch (error) {
    // Never include raw provider errors, which may contain headers or credentials.
    results.push({
      runtime: runtime.id,
      scenario: 'live-model-host-tool',
      passed: false,
      fixture: false,
      api: process.env.CRESCENT_POC_CHAT === '1' ? 'chat-completions' : 'responses',
      probes,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      status:
        error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
          ? error.status
          : undefined,
      category:
        error instanceof Error
          ? /timeout|abort|timed out/i.test(error.message)
            ? 'timeout'
            : /401|auth|api.key/i.test(error.message)
              ? 'authentication'
              : /connect|fetch|network/i.test(error.message)
                ? 'transport'
                : /unsupported|unknown|not.found/i.test(error.message)
                  ? 'unsupported'
                  : /probe|assert/i.test(error.message)
                    ? 'expectation'
                    : 'provider-response'
          : 'unknown'
    })
    process.exitCode = 1
  } finally {
    runtime.abort()
  }
}
await mkdir('../../out/implementation', { recursive: true })
await writeFile(
  '../../out/implementation/runtime-benchmark.json',
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      results,
      unverified: [
        'Real SSH and Kubernetes transports',
        'MCP server transport',
        'Nested Crescent PTY subagents',
        'SDK steering parity',
        'SDK compaction parity',
        'Token-cost performance comparison'
      ]
    },
    null,
    2
  )
)
console.log(
  JSON.stringify(
    results.map((result) => ({
      runtime: result.runtime,
      scenario: result.scenario,
      passed: result.passed
    })),
    null,
    2
  )
)
