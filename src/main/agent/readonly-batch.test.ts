import { describe, expect, it } from 'vitest'

import { classifyByStaticRules } from '../../shared/command-guard'
import {
  CRES_BATCH_SEP,
  applyBatchOutputFormatting,
  injectBatchSeparators,
  parseBatchedToolOutput,
  planReadonlyBatch,
  splitBatchOutput,
  splitShellSegments,
  stripAnsi
} from '../../shared/readonly-batch'

describe('splitShellSegments', () => {
  it('splits on ; && and newlines', () => {
    expect(splitShellSegments('kubectl get pods; kubectl get svc')).toEqual([
      'kubectl get pods',
      'kubectl get svc'
    ])
    expect(splitShellSegments('a && b && c')).toEqual(['a', 'b', 'c'])
    expect(splitShellSegments('a\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  it('does not split on ; inside single quotes', () => {
    expect(splitShellSegments("echo 'a;b'; kubectl get pods")).toEqual([
      "echo 'a;b'",
      'kubectl get pods'
    ])
  })

  it('does not split on ; inside double quotes', () => {
    expect(splitShellSegments('echo "a;b"; kubectl get pods')).toEqual([
      'echo "a;b"',
      'kubectl get pods'
    ])
  })
})

describe('planReadonlyBatch', () => {
  it('injects separators for pure readonly compound scripts', () => {
    const script = 'kubectl get pods; kubectl get svc'
    expect(classifyByStaticRules(script)).toBe('low')
    const plan = planReadonlyBatch(script)
    expect(plan.inject).toBe(true)
    expect(plan.segments).toHaveLength(2)
    expect(plan.ptyCommand).toContain(CRES_BATCH_SEP)
    const sepCount = plan.ptyCommand.split(CRES_BATCH_SEP).length - 1
    expect(sepCount).toBe(2)
    expect(plan.ptyCommand).not.toContain('delete')
  })

  it('does not inject when script contains HIGH write verbs', () => {
    const script = 'kubectl get pods; kubectl delete pod x'
    expect(classifyByStaticRules(script)).toBe('high')
    const plan = planReadonlyBatch(script)
    expect(plan.inject).toBe(false)
    expect(plan.reason).toBe('not-readonly')
    expect(plan.ptyCommand).toBe(script)
    expect(plan.ptyCommand).not.toContain(CRES_BATCH_SEP)
  })

  it('does not inject single commands', () => {
    const plan = planReadonlyBatch('kubectl get pods')
    expect(plan.inject).toBe(false)
    expect(plan.reason).toBe('single')
    expect(plan.ptyCommand).toBe('kubectl get pods')
  })

  it('safety: injected command never contains delete', () => {
    const plan = planReadonlyBatch('kubectl get pods; kubectl get svc; kubectl get nodes')
    expect(plan.inject).toBe(true)
    expect(plan.ptyCommand).not.toContain('delete')
    expect(plan.ptyCommand).not.toContain('rm ')
    expect(plan.ptyCommand).not.toContain('apply')
  })
})

describe('injectBatchSeparators / splitBatchOutput', () => {
  it('keeps each command and SEP echo as independent shell statements', () => {
    const segments = [
      'kubectl get pods',
      'kubectl get svc',
      'kubectl get nodes'
    ]
    const injected = injectBatchSeparators(segments)
    const sepEcho = `echo "${CRES_BATCH_SEP}"`
    const statements = injected.split(';').map((part) => part.trim()).filter(Boolean)

    expect(statements).toEqual([
      'kubectl get pods',
      sepEcho,
      'kubectl get svc',
      sepEcho,
      'kubectl get nodes',
      sepEcho
    ])

    // SEP echo must not swallow the next command as an argument:
    // bad form was: echo "SEP" kubectl get svc
    expect(injected).not.toMatch(
      new RegExp(`echo "${CRES_BATCH_SEP}"\\s+\\S`)
    )
  })

  it('simulates shell sequential execution so each segment yields real output', () => {
    const segments = ['kubectl get pods', 'kubectl get svc', 'kubectl get nodes']
    const injected = injectBatchSeparators(segments)
    const fakeOutputs: Record<string, string> = {
      'kubectl get pods': 'PODS_OK',
      'kubectl get svc': 'SVC_OK',
      'kubectl get nodes': 'NODES_OK'
    }

    const statements = injected.split(';').map((part) => part.trim()).filter(Boolean)
    const rawChunks: string[] = []
    for (const statement of statements) {
      if (statement === `echo "${CRES_BATCH_SEP}"`) {
        rawChunks.push(`${CRES_BATCH_SEP}\n`)
        continue
      }
      const output = fakeOutputs[statement]
      expect(output, `missing fake output for: ${statement}`).toBeTruthy()
      rawChunks.push(`${output}\n`)
    }

    const parts = splitBatchOutput(rawChunks.join(''))
    expect(parts.slice(0, segments.length)).toEqual(['PODS_OK', 'SVC_OK', 'NODES_OK'])
    expect(parts[1]).toContain('SVC_OK')
  })

  it('round-trips two segment outputs after ANSI strip', () => {
    const segments = ['kubectl get pods', 'kubectl get svc']
    const injected = injectBatchSeparators(segments)
    expect(injected.split(CRES_BATCH_SEP).length - 1).toBe(2)
    expect(injected).toBe(
      `kubectl get pods; echo "${CRES_BATCH_SEP}"; kubectl get svc; echo "${CRES_BATCH_SEP}"`
    )

    const raw = `\u001b[32mpods-out\u001b[0m\n${CRES_BATCH_SEP}\nsvc-out\n${CRES_BATCH_SEP}\n`
    const parts = splitBatchOutput(raw)
    expect(parts[0]).toContain('pods-out')
    expect(parts[0]).not.toContain('\u001b')
    expect(parts[1]).toContain('svc-out')
    expect(parts).toHaveLength(3)

    const { formatted } = applyBatchOutputFormatting(
      { inject: true, segments, ptyCommand: injected, reason: 'ok' },
      raw
    )
    expect(formatted).toContain('command 1/2: kubectl get pods')
    expect(formatted).toContain('command 2/2: kubectl get svc')
    expect(formatted).toContain('pods-out')
    expect(formatted).toContain('svc-out')

    const parsed = parseBatchedToolOutput(formatted)
    expect(parsed).toHaveLength(2)
    expect(parsed?.[0]).toMatchObject({ command: 'kubectl get pods', output: 'pods-out' })
    expect(parsed?.[1]).toMatchObject({ command: 'kubectl get svc', output: 'svc-out' })
  })

  it('stripAnsi removes CSI sequences', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red')
  })
})
