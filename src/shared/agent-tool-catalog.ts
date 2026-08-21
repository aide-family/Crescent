import type { ToolCatalogEntry } from './agent-types'

/** Pi coding-agent built-in tools exposed by Crescent after the Pi migration. */
export const BUILT_IN_TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    name: 'read',
    method: 'get',
    path: 'pi://workspace/read',
    description: 'Read a file from the agent workspace cwd.',
    source: 'built-in',
    risk: 'low',
    requiresApproval: false,
    external: false,
    stateChanging: false
  },
  {
    name: 'write',
    method: 'post',
    path: 'pi://workspace/write',
    description: 'Write a file in the agent workspace cwd.',
    source: 'built-in',
    risk: 'medium',
    requiresApproval: false,
    external: false,
    stateChanging: true
  },
  {
    name: 'edit',
    method: 'post',
    path: 'pi://workspace/edit',
    description: 'Edit an existing file in the agent workspace cwd.',
    source: 'built-in',
    risk: 'medium',
    requiresApproval: false,
    external: false,
    stateChanging: true
  },
  {
    name: 'bash',
    method: 'post',
    path: 'pi://workspace/bash',
    description: 'Run a local bash command in the agent workspace cwd.',
    source: 'built-in',
    risk: 'high',
    requiresApproval: false,
    external: false,
    stateChanging: true
  },
  {
    name: 'open_subterminal',
    method: 'post',
    path: 'pi://crescent/open_subterminal',
    description: 'Open a docked local or SSH subterminal and route subsequent bash commands there.',
    source: 'built-in',
    risk: 'medium',
    requiresApproval: false,
    external: false,
    stateChanging: true
  },
  {
    name: 'create-skill',
    method: 'post',
    path: 'pi://crescent/create-skill',
    description:
      'Capture this session as a Skill draft. The operator confirms before SKILL.md is written.',
    source: 'built-in',
    risk: 'medium',
    requiresApproval: false,
    external: false,
    stateChanging: true
  },
  {
    name: 'create-sop',
    method: 'post',
    path: 'pi://crescent/create-sop',
    description:
      'Capture this session as a wiki SOP draft. The operator confirms before the wiki is written.',
    source: 'built-in',
    risk: 'medium',
    requiresApproval: false,
    external: false,
    stateChanging: true
  }
]
