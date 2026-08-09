export { McpArtifactPathService } from './artifact-path-service.js';
export { McpAutoResultArtifactService } from './auto-result-artifact-service.js';
export { McpHostExtensionPreparationService } from './preparation-service.js';
export { McpResultArtifactService } from './result-artifact-service.js';
export { McpHostExtensionService } from './service.js';
export { McpStructuredContentMirrorService } from './structured-content-mirror-service.js';
export { McpHostToolDefinitionService } from './tool-definition-service.js';
export { McpHostValueService } from './value-service.js';
export type {
  DefineMcpHostExtensionOptions,
  McpHostAutoResultArtifactHint,
  McpHostAutoResultArtifactsOptions,
  McpHostResultArtifactOutput,
  McpHostResultArtifactReference,
  McpHostResultArtifactRule,
  McpHostResultArtifactsOptions,
  McpHostToolOverride,
  McpRequestScopedHttpServer,
  PrepareMcpHostExtensionCatalogOptions,
  PrepareMcpHostExtensionCatalogResult,
  PrepareMcpHostExtensionOptions,
  PrepareMcpHostExtensionResult,
  PrepareRequestScopedMcpHostExtensionOptions,
  PrepareRequestScopedMcpHostExtensionResult,
} from './types.js';
export type {
  McpRequestHeadersProvider,
  McpRequestHeadersProviderInput,
} from '@/core/mcp/index.js';

import { McpHostExtensionPreparationService } from './preparation-service.js';
import { McpHostExtensionService } from './service.js';
import type {
  PrepareMcpHostExtensionCatalogOptions,
  PrepareMcpHostExtensionCatalogResult,
  PrepareMcpHostExtensionInput,
  PrepareMcpHostExtensionOptions,
  PrepareMcpHostExtensionResult,
  PrepareRequestScopedMcpHostExtensionOptions,
  PrepareRequestScopedMcpHostExtensionResult,
} from './types.js';

export const defineMcpHostExtension = McpHostExtensionService.define;
export const prepareMcpHostExtensionCatalog = (
  options: PrepareMcpHostExtensionCatalogOptions,
): Promise<PrepareMcpHostExtensionCatalogResult> => (
  McpHostExtensionPreparationService.prepareCatalog(options)
);
export function prepareMcpHostExtension(
  options: PrepareRequestScopedMcpHostExtensionOptions,
): Promise<PrepareRequestScopedMcpHostExtensionResult>;
export function prepareMcpHostExtension(
  options: PrepareMcpHostExtensionOptions,
): Promise<PrepareMcpHostExtensionResult>;
export function prepareMcpHostExtension(
  options: PrepareMcpHostExtensionInput,
): Promise<PrepareMcpHostExtensionResult | PrepareRequestScopedMcpHostExtensionResult> {
  return McpHostExtensionPreparationService.prepare(options);
}
