import { z } from 'zod';

export const AgentCoreRegionSchema = z.string().trim().min(1).max(64).regex(
  /^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/,
  'must be an AWS region identifier',
);

export const AgentCoreRuntimeArnSchema = z.string().trim().min(20).max(2_048)
  .regex(
    /^arn:[a-z0-9-]+:bedrock-agentcore:[a-z0-9-]+:\d{12}:runtime\/[A-Za-z0-9_-]+$/,
    'must be an AgentCore Runtime ARN',
  );

export const AgentCoreQualifierSchema = z.string().trim().min(1).max(64)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    'must be an AgentCore endpoint qualifier',
  );

export const AgentCoreExecutionTargetSchema = z.object({
  region: AgentCoreRegionSchema,
  runtimeArn: AgentCoreRuntimeArnSchema,
  qualifier: AgentCoreQualifierSchema.optional(),
}).strict();

export type AgentCoreExecutionTarget = z.infer<
  typeof AgentCoreExecutionTargetSchema
>;
