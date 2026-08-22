import { Type } from 'typebox'
import type { WebContents } from 'electron'

import { safeWebContentsSend } from '../safe-ipc-send'
import type {
  AgentCaptureRequestedPayload,
  CaptureKind,
  CaptureScope
} from '../../shared/agent-types'
import { loadPiAi, type PiSdkFacade } from './pi-sdk'
import { getPtyBashExecContext } from './pi-terminal-bash'

export const CREATE_CAPTURE_DISCIPLINE = [
  '# SOP / Skill 存库工具',
  '- 用户要把本轮或整段会话存成 Skill / SOP 时，调用 create-skill 或 create-sop（默认 scope=session）。',
  '- 不要用 bash / write / edit 落 SKILL.md 或 wiki；不要询问保存路径。',
  '- 工具只触发后台草稿；操作者稍后在对话里打开确认才会写入。'
].join('\n')

export const CREATE_CAPTURE_TOOL_NAMES = ['create-skill', 'create-sop'] as const

export type CreateCaptureToolName = (typeof CREATE_CAPTURE_TOOL_NAMES)[number]

export interface CreateCaptureToolParams {
  scope?: CaptureScope
  notes?: string
  titleHint?: string
}

function requestCaptureDraft(input: {
  sessionKey: string
  kind: CaptureKind
  params: CreateCaptureToolParams
}): {
  ok: boolean
  kind: CaptureKind
  scope: CaptureScope
  message?: string
  error?: string
} {
  const context = getPtyBashExecContext(input.sessionKey)
  const webContents: WebContents | undefined = context?.webContents
  if (!context || !webContents || webContents.isDestroyed()) {
    return {
      ok: false,
      kind: input.kind,
      scope: input.params.scope === 'turn' ? 'turn' : 'session',
      error: 'No active agent session. Start a run before creating a skill or SOP draft.'
    }
  }

  const scope: CaptureScope = input.params.scope === 'turn' ? 'turn' : 'session'
  const seedText = [input.params.titleHint, input.params.notes]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
  const payload: AgentCaptureRequestedPayload = {
    kind: input.kind,
    scope,
    seedText: seedText || undefined,
    chatTabId: context.chatTabId
  }
  safeWebContentsSend(webContents, 'agent:capture-requested', payload)
  return {
    ok: true,
    kind: input.kind,
    scope,
    message:
      'Background draft generation started. The operator will confirm in the capture dialog before anything is written.'
  }
}

export async function createCaptureToolDefinitions(
  pi: PiSdkFacade,
  sessionKey: string
): Promise<Array<ReturnType<PiSdkFacade['defineTool']>>> {
  const { StringEnum } = await loadPiAi()
  const parameters = Type.Object({
    scope: Type.Optional(StringEnum(['session', 'turn'] as const)),
    titleHint: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String())
  })

  return [
    pi.defineTool({
      name: 'create-skill',
      label: 'Create skill',
      description: [
        'Turn this session (or the current turn) into a Skill draft.',
        'The host generates the draft in the background; the operator confirms before SKILL.md is written.',
        'Do not write SKILL.md with bash, write, or edit.'
      ].join(' '),
      promptSnippet: 'create-skill — capture the session as a confirm-before-write Skill draft',
      promptGuidelines: [
        'When the user wants to save the workflow as a skill, call create-skill (scope=session unless they named this turn).'
      ],
      parameters,
      executionMode: 'sequential',
      async execute(_toolCallId, params) {
        const result = requestCaptureDraft({
          sessionKey,
          kind: 'skill',
          params: params as CreateCaptureToolParams
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          details: result
        }
      }
    }),
    pi.defineTool({
      name: 'create-sop',
      label: 'Create SOP',
      description: [
        'Turn this session (or the current turn) into a wiki SOP draft.',
        'The host generates the draft in the background; the operator confirms before the wiki is written.',
        'Do not write SOP markdown with bash, write, or edit.'
      ].join(' '),
      promptSnippet: 'create-sop — capture the session as a confirm-before-write wiki SOP draft',
      promptGuidelines: [
        'When the user wants to save the workflow as an SOP, call create-sop (scope=session unless they named this turn).'
      ],
      parameters,
      executionMode: 'sequential',
      async execute(_toolCallId, params) {
        const result = requestCaptureDraft({
          sessionKey,
          kind: 'sop',
          params: params as CreateCaptureToolParams
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          details: result
        }
      }
    })
  ]
}
