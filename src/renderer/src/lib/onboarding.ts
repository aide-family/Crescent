import type { AgentOpenApiProfile } from '../../../shared/agent-types'
import { createEmptyOpenApiProfile } from '../../../shared/openapi-profiles'

export const ONBOARDING_STORAGE_KEY = 'crescent.onboarding.dismissed'

export function shouldShowOnboarding(
  storage: Pick<Storage, 'getItem'> = window.localStorage
): boolean {
  return storage.getItem(ONBOARDING_STORAGE_KEY) !== '1'
}

export function dismissOnboarding(storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  storage.setItem(ONBOARDING_STORAGE_KEY, '1')
}

/** Minimal inline OpenAPI document for first-run exploration. */
export const EXAMPLE_OPENAPI_DOCUMENT = `{
  "openapi": "3.0.3",
  "info": {
    "title": "Crescent Example API",
    "version": "1.0.0"
  },
  "paths": {
    "/health": {
      "get": {
        "operationId": "getHealth",
        "summary": "Health check",
        "responses": {
          "200": {
            "description": "Service is healthy"
          }
        }
      }
    },
    "/status": {
      "get": {
        "operationId": "getStatus",
        "summary": "Read service status",
        "responses": {
          "200": {
            "description": "Current status payload"
          }
        }
      }
    }
  }
}`

export function createExampleOpenApiProfile(
  id = `example-openapi-${Date.now()}`
): AgentOpenApiProfile {
  return {
    ...createEmptyOpenApiProfile(id),
    name: 'Example API',
    baseUrl: 'https://httpbin.org',
    document: EXAMPLE_OPENAPI_DOCUMENT
  }
}
