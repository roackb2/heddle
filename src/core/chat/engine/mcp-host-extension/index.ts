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
  PrepareMcpHostExtensionCatalogOptions,
  PrepareMcpHostExtensionCatalogResult,
  PrepareMcpHostExtensionOptions,
  PrepareMcpHostExtensionResult,
} from './types.js';

import { McpHostExtensionPreparationService } from './preparation-service.js';
import { McpHostExtensionService } from './service.js';
import type {
  PrepareMcpHostExtensionCatalogOptions,
  PrepareMcpHostExtensionCatalogResult,
  PrepareMcpHostExtensionOptions,
  PrepareMcpHostExtensionResult,
} from './types.js';

export const defineMcpHostExtension = McpHostExtensionService.define;
export const prepareMcpHostExtensionCatalog = (
  options: PrepareMcpHostExtensionCatalogOptions,
): Promise<PrepareMcpHostExtensionCatalogResult> => (
  McpHostExtensionPreparationService.prepareCatalog(options)
);
export const prepareMcpHostExtension = (
  options: PrepareMcpHostExtensionOptions,
): Promise<PrepareMcpHostExtensionResult> => (
  McpHostExtensionPreparationService.prepare(options)
);
