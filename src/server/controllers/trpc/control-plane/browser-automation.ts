import { BrowserAutomationCapabilityService } from '@/core/browser/index.js';

export class ControlPlaneBrowserAutomationController {
  static async overview(workspaceRoot: string, stateRoot: string) {
    return await ControlPlaneBrowserAutomationController.service(workspaceRoot, stateRoot).overview();
  }

  static async setEnabled(workspaceRoot: string, stateRoot: string, enabled: boolean) {
    return await ControlPlaneBrowserAutomationController.service(workspaceRoot, stateRoot).setEnabled(enabled);
  }

  private static service(workspaceRoot: string, stateRoot: string): BrowserAutomationCapabilityService {
    return new BrowserAutomationCapabilityService({
      workspaceRoot,
      stateRoot,
    });
  }
}
