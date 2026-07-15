import { describe, expect, it } from 'vitest'

import {
  filterAutomationControlOutputWithState,
  formatReadableCommandInput,
  type TerminalAutomationFilterState
} from './ipc'

function createFilterState(): TerminalAutomationFilterState {
  return {
    startMarker: '__CRESCENT_CMD_START_test__',
    endMarker: '__CRESCENT_CMD_END_test__',
    phase: 'before-start',
    pending: ''
  }
}

describe('terminal ipc automation display helpers', () => {
  it('formats a compound command as one readable terminal input', () => {
    expect(
      formatReadableCommandInput("printf 'a' && printf 'b'\nfor x in a b; do echo $x; done")
    ).toBe("printf 'a' && printf 'b'\r\nfor x in a b; do echo $x; done\r\n")
  })

  it('streams command output without shell prompt prefixes from automation echo', () => {
    const state = createFilterState()

    expect(
      filterAutomationControlOutputWithState(
        'root@host:~# __crescent_script=$(mktemp "/tmp/crescent.XXXXXX")\r\n',
        state
      )
    ).toBe('')
    expect(
      filterAutomationControlOutputWithState(
        '__CRESCENT_CMD_START_test__\r\nroot@host:~# ### CONTEXT\r\nvalue\r\n__CRESCENT_CMD_END_test__:0\r\n',
        state
      )
    ).toBe('### CONTEXT\r\nvalue\r\n')
  })

  it('preserves the real shell prompt after the end marker', () => {
    const state = createFilterState()

    const output = filterAutomationControlOutputWithState(
      [
        '__CRESCENT_CMD_START_test__\r\n',
        'result line\r\n',
        '__CRESCENT_CMD_END_test__:0\r\n',
        'root@arch-devops-k8smaster01[ K8S-RONLY ]:~# '
      ].join(''),
      state
    )

    expect(output).toBe('result line\r\nroot@arch-devops-k8smaster01[ K8S-RONLY ]:~# ')
  })
})
