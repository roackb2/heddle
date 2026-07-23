import { describe, expect, it } from 'vitest';
import { AutonomyPolicyService, type AutopilotProfile } from '@/core/approvals/index.js';
import type { ToolApprovalPolicyContext } from '@/core/approvals/types.js';

const profile: AutopilotProfile = {
  mode: 'autopilot',
  roots: [
    {
      path: '.',
      access: 'autopilot',
      allow: ['read', 'write', 'execute', 'simple-delete', 'many-file-edit', 'verification', 'formatting', 'git-stage'],
    },
    {
      path: '../sibling-repo',
      access: 'autopilot',
      allow: ['read', 'write', 'execute', 'many-file-edit'],
    },
    {
      path: '../manual',
      access: 'manual-only',
    },
    {
      path: '../denied',
      access: 'deny',
    },
  ],
  environments: {
    allow: ['local', 'dev'],
    requireApproval: ['staging', 'production', 'unknown'],
  },
};

function context(overrides: Partial<ToolApprovalPolicyContext> = {}): ToolApprovalPolicyContext {
  return {
    call: {
      id: 'call-1',
      tool: 'run_shell_mutate',
      input: {
        command: 'node scripts/update-sibling.js',
        policy: {
          operations: ['read', 'write', 'execute'],
          intent: 'update generated imports in sibling repo',
          targetRoots: ['../sibling-repo'],
          expectedEffects: ['rewrite generated import paths'],
          maxDestructiveScope: 'many-files',
          environment: 'local',
          confidence: 'high',
        },
      },
    },
    tool: {
      name: 'run_shell_mutate',
      description: 'mutates workspace',
      requiresApproval: true,
      parameters: {},
      execute: async () => ({ ok: true }),
    },
    workspaceRoot: '/workspace/current',
    ...overrides,
  };
}

describe('AutonomyPolicyService', () => {
  it('allows unknown shell when the declared envelope fits configured autopilot roots', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context(),
      profile,
    });

    expect(evaluation.decision).toEqual(expect.objectContaining({
      type: 'allow',
      reason: 'allowed by autopilot profile and declared policy envelope',
    }));
    expect(evaluation.envelope?.operations).toEqual(['read', 'write', 'execute']);
    expect(evaluation.facts.claimedWriteRoots).toEqual(['/workspace/sibling-repo']);
  });

  it('requests approval when an approval-gated tool is missing an envelope', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-1',
          tool: 'run_shell_mutate',
          input: { command: 'node scripts/update-sibling.js' },
        },
      }),
      profile,
    });

    expect(evaluation.decision).toEqual(expect.objectContaining({
      type: 'request',
      reason: 'tool call needs a declared policy envelope',
    }));
  });

  it('requests approval for no-envelope reads outside configured Auto roots', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-read',
          tool: 'read_file',
          input: { path: '../manual/file.txt' },
        },
        tool: {
          name: 'read_file',
          description: 'reads files',
          requiresApproval: false,
          parameters: {},
          execute: async () => ({ ok: true }),
        },
      }),
      profile,
    });

    expect(evaluation.decision).toEqual(expect.objectContaining({
      type: 'request',
      reason: expect.stringContaining('root requires manual approval'),
    }));
  });

  it('allows no-envelope reads in configured sibling Auto roots', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-read',
          tool: 'read_file',
          input: { path: '../sibling-repo/README.md' },
        },
        tool: {
          name: 'read_file',
          description: 'reads files',
          requiresApproval: false,
          parameters: {},
          execute: async () => ({ ok: true }),
        },
      }),
      profile,
    });

    expect(evaluation.decision).toEqual(expect.objectContaining({
      type: 'allow',
      reason: 'allowed by autopilot profile without a required policy envelope',
    }));
  });

  it('denies hard-denied roots even when the envelope claims low risk', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-edit',
          tool: 'edit_file',
          input: {
            path: '../denied/secrets.txt',
            content: 'secret',
            createIfMissing: true,
            policy: {
              operations: ['read'],
              intent: 'inspect current workspace',
              targetRoots: ['.'],
              expectedEffects: ['read only'],
              environment: 'local',
              confidence: 'high',
            },
          },
        },
        tool: {
          name: 'edit_file',
          description: 'edits files',
          requiresApproval: true,
          parameters: {},
          execute: async () => ({ ok: true }),
        },
      }),
      profile,
    });

    expect(evaluation.decision.type).toBe('deny');
    expect(evaluation.facts.hardDenyReasons).toContain('root is hard-denied by autopilot policy: /workspace/denied/secrets.txt');
  });

  it('requests approval for manual-only roots and production environments', () => {
    const manual = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-edit',
          tool: 'edit_file',
          input: {
            path: '../manual/file.txt',
            content: 'ok',
            createIfMissing: true,
            policy: {
              operations: ['write'],
              intent: 'write manual root',
              targetRoots: ['../manual'],
              expectedEffects: ['write file'],
              environment: 'local',
              confidence: 'high',
            },
          },
        },
        tool: {
          name: 'edit_file',
          description: 'edits files',
          requiresApproval: true,
          parameters: {},
          execute: async () => ({ ok: true }),
        },
      }),
      profile,
    });
    expect(manual.decision).toEqual(expect.objectContaining({
      type: 'request',
      reason: expect.stringContaining('root requires manual approval'),
    }));

    const production = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-shell',
          tool: 'run_shell_mutate',
          input: {
            command: 'node scripts/update-sibling.js',
            policy: {
              operations: ['execute'],
              intent: 'run production-like command',
              targetRoots: ['.'],
              expectedEffects: ['execute script'],
              environment: 'production',
              confidence: 'high',
            },
          },
        },
      }),
      profile,
    });
    expect(production.decision).toEqual(expect.objectContaining({
      type: 'request',
      reason: 'environment is not allowed for unattended execution',
    }));
  });

  it('uses host-owned MCP transport and environment while retaining the model proposal', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-mcp-read',
          tool: 'search_slides',
          input: {
            query: 'roadmap',
            policy: {
              operations: ['read', 'network'],
              intent: 'read slides through Streamable HTTP',
              targetRoots: [],
              expectedEffects: ['return matching slides'],
              maxDestructiveScope: 'none',
              environment: 'production',
              confidence: 'high',
            },
          },
        },
        tool: {
          name: 'search_slides',
          description: 'search slides',
          requiresApproval: true,
          parameters: {},
          hostPolicy: {
            authority: {
              kind: 'mcp',
              serverId: 'slides',
              toolName: 'search-slides',
              tenantId: 'tenant-1',
            },
            transport: {
              kind: 'http',
              network: true,
            },
            environment: 'local',
            operations: ['read'],
          },
          execute: async () => ({ ok: true }),
        },
      }),
      profile,
    });

    expect(evaluation.decision).toEqual(expect.objectContaining({
      type: 'allow',
      reason: 'allowed by autopilot profile and declared policy envelope',
    }));
    expect(evaluation.envelope).toEqual(expect.objectContaining({
      operations: ['read'],
      environment: 'local',
    }));
    expect(evaluation.policy).toEqual(expect.objectContaining({
      modelProposed: expect.objectContaining({
        operations: ['read', 'network'],
        environment: 'production',
      }),
      hostOwned: expect.objectContaining({
        authority: {
          kind: 'mcp',
          serverId: 'slides',
          toolName: 'search-slides',
          tenantId: 'tenant-1',
        },
        transport: {
          kind: 'http',
          network: true,
        },
        environment: 'local',
        operations: ['read'],
      }),
      ownership: {
        hostOwned: ['authority', 'transport', 'environment', 'operations'],
        modelProposed: expect.arrayContaining(['operations', 'environment', 'intent']),
      },
    }));
    expect(evaluation.facts.claimMismatches).toEqual([
      expect.stringContaining('host targets "local"'),
      expect.stringContaining('host-owned transport provenance'),
      expect.stringContaining('host classifies this tool as [read]'),
    ]);
  });

  it('applies host-owned development and production environments', () => {
    const evaluateEnvironment = (environment: 'dev' | 'production') =>
      AutonomyPolicyService.evaluate({
        context: context({
          call: {
            id: `call-mcp-${environment}`,
            tool: 'search_slides',
            input: {
              query: 'roadmap',
              policy: {
                operations: ['read'],
                intent: 'read slides',
                targetRoots: [],
                expectedEffects: ['return matching slides'],
                environment: 'local',
                confidence: 'high',
              },
            },
          },
          tool: {
            name: 'search_slides',
            description: 'search slides',
            requiresApproval: true,
            parameters: {},
            hostPolicy: {
              authority: {
                kind: 'mcp',
                serverId: 'slides',
                toolName: 'search-slides',
              },
              transport: {
                kind: 'http',
                network: true,
              },
              environment,
              operations: ['read'],
            },
            execute: async () => ({ ok: true }),
          },
        }),
        profile,
      });

    expect(evaluateEnvironment('dev').decision.type).toBe('allow');
    expect(evaluateEnvironment('production').decision).toEqual(expect.objectContaining({
      type: 'request',
      reason: 'environment is not allowed for unattended execution',
    }));
  });

  it('does not let a model downgrade a host-classified remote mutation to a read', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-mcp-write',
          tool: 'update_slide',
          input: {
            title: 'Updated',
            policy: {
              operations: ['read'],
              intent: 'read a slide',
              targetRoots: [],
              expectedEffects: ['read slide'],
              environment: 'local',
              confidence: 'high',
            },
          },
        },
        tool: {
          name: 'update_slide',
          description: 'updates a remote slide',
          requiresApproval: true,
          parameters: {},
          hostPolicy: {
            authority: {
              kind: 'mcp',
              serverId: 'slides',
              toolName: 'update-slide',
            },
            transport: {
              kind: 'http',
              network: true,
            },
            environment: 'production',
            operations: ['write'],
          },
          execute: async () => ({ ok: true }),
        },
      }),
      profile,
    });

    expect(evaluation.facts.operations).toEqual(['write']);
    expect(evaluation.envelope).toEqual(expect.objectContaining({
      operations: ['write'],
      environment: 'production',
    }));
    expect(evaluation.decision).toEqual(expect.objectContaining({
      type: 'request',
      reason: expect.stringContaining('remote mutating authority requires explicit approval'),
    }));
  });

  it('does not auto-allow a mutating shell call whose envelope declares no roots', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-shell',
          tool: 'run_shell_mutate',
          input: {
            command: 'node scripts/build.js',
            policy: {
              operations: ['execute'],
              intent: 'run a build command',
              targetRoots: [],
              expectedEffects: ['run build'],
              environment: 'local',
              confidence: 'high',
            },
          },
        },
      }),
      profile,
    });

    expect(evaluation.decision.type).toBe('deny');
    expect(evaluation.facts.hardDenyReasons.join('; ')).toContain('must declare at least one target or write root');
  });

  it('denies deterministic catastrophic shell commands regardless of envelope', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-rm',
          tool: 'run_shell_mutate',
          input: {
            command: 'rm -rf ~',
            policy: {
              operations: ['delete'],
              intent: 'cleanup temporary files',
              targetRoots: ['.'],
              expectedEffects: ['cleanup'],
              maxDestructiveScope: 'single-file',
              environment: 'local',
              confidence: 'high',
            },
          },
        },
      }),
      profile,
    });

    expect(evaluation.decision.type).toBe('deny');
    expect(evaluation.facts.hardDenyReasons).toContain('root/home recursive deletion is blocked');
  });
});
