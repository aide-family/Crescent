/** Typed preload clients; the main process remains responsible for policy and persistence. */
export const appClient = window.api.app
export const agentClient = window.api.agent
export const terminalClient = window.api.terminal
export const storageClient = window.api.storage
export const connectionsClient = window.api.connections
export const whaleMonitorClient = window.api.whaleMonitor
export const updateClient = window.api.update
