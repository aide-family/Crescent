/**
 * Lazy loader for @modelcontextprotocol/sdk.
 *
 * The SDK is ESM-first. Electron main is CJS, so static imports can become
 * `require()` and fail. Dynamic `import()` uses the ESM export map.
 */
export type McpSdkModule = {
  Client: typeof import('@modelcontextprotocol/sdk/client/index.js').Client
  StreamableHTTPClientTransport: typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport
  SSEClientTransport: typeof import('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransport
  StdioClientTransport: typeof import('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport
  getDefaultEnvironment: typeof import('@modelcontextprotocol/sdk/client/stdio.js').getDefaultEnvironment
}

let mcpSdkPromise: Promise<McpSdkModule> | undefined

export function loadMcpSdk(): Promise<McpSdkModule> {
  if (!mcpSdkPromise) {
    mcpSdkPromise = loadMcpSdkUnguarded().catch((error) => {
      mcpSdkPromise = undefined
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to load MCP SDK. Ensure @modelcontextprotocol/sdk is installed and unpackaged. ${detail}`
      )
    })
  }
  return mcpSdkPromise
}

async function loadMcpSdkUnguarded(): Promise<McpSdkModule> {
  const [clientMod, httpMod, sseMod, stdioMod] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/client/sse.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js')
  ])
  return {
    Client: clientMod.Client,
    StreamableHTTPClientTransport: httpMod.StreamableHTTPClientTransport,
    SSEClientTransport: sseMod.SSEClientTransport,
    StdioClientTransport: stdioMod.StdioClientTransport,
    getDefaultEnvironment: stdioMod.getDefaultEnvironment
  }
}
