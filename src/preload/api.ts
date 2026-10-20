import { knowledgeApi } from './modules/knowledge'
import { documentsApi } from './modules/documents'
import { commandsApi } from './modules/commands'
import { appApi } from './modules/app'
import { terminalApi } from './modules/terminal'
import { agentApi } from './modules/agent'
import { connectionsApi } from './modules/connections'
import { storageApi } from './modules/storage'
import { updateApi } from './modules/update'
import { whaleMonitorApi } from './modules/whaleMonitor'

export const api = {
  knowledge: knowledgeApi,
  documents: documentsApi,
  commands: commandsApi,
  app: appApi,
  terminal: terminalApi,
  agent: agentApi,
  connections: connectionsApi,
  storage: storageApi,
  update: updateApi,
  whaleMonitor: whaleMonitorApi
}
