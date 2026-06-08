import { McpService } from '@/core/mcp/index.js';

export class ControlPlaneMcpController {
  static list(workspaceRoot: string, stateRoot: string) {
    return ControlPlaneMcpController.service(workspaceRoot, stateRoot).listOverview();
  }

  static config(workspaceRoot: string, stateRoot: string) {
    return ControlPlaneMcpController.service(workspaceRoot, stateRoot).readConfigDocument();
  }

  static saveConfig(workspaceRoot: string, stateRoot: string, content: string) {
    return ControlPlaneMcpController.service(workspaceRoot, stateRoot).saveConfigDocument(content);
  }

  static enable(workspaceRoot: string, stateRoot: string, serverId: string) {
    return ControlPlaneMcpController.service(workspaceRoot, stateRoot).activateServer(serverId);
  }

  static disable(workspaceRoot: string, stateRoot: string, serverId: string) {
    return ControlPlaneMcpController.service(workspaceRoot, stateRoot).disableServer(serverId);
  }

  static async refresh(workspaceRoot: string, stateRoot: string, serverId: string) {
    return await ControlPlaneMcpController.service(workspaceRoot, stateRoot).refreshServer(serverId);
  }

  private static service(workspaceRoot: string, stateRoot: string): McpService {
    return new McpService({ workspaceRoot, stateRoot });
  }
}
