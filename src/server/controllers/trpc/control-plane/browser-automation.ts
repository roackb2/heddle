import { BrowserAutomationCapabilityService } from '@/core/browser/index.js';

export class ControlPlaneBrowserAutomationController {
  static async overview(workspaceRoot: string, stateRoot: string) {
    return await ControlPlaneBrowserAutomationController.service(workspaceRoot, stateRoot).overview();
  }

  static async setEnabled(workspaceRoot: string, stateRoot: string, enabled: boolean) {
    return await ControlPlaneBrowserAutomationController.service(workspaceRoot, stateRoot).setEnabled(enabled);
  }

  static async updateSettings(
    workspaceRoot: string,
    stateRoot: string,
    input: { profileId?: string; channel?: 'chromium' | 'chrome' | 'msedge'; headless?: boolean },
  ) {
    return await ControlPlaneBrowserAutomationController.service(workspaceRoot, stateRoot).updateSettings(input);
  }

  static async openProfileWindow(
    workspaceRoot: string,
    stateRoot: string,
    input: { url?: string },
  ) {
    return await ControlPlaneBrowserAutomationController.service(workspaceRoot, stateRoot).openProfileWindow(input);
  }

  static async closeProfileWindow(workspaceRoot: string, stateRoot: string) {
    return await ControlPlaneBrowserAutomationController.service(workspaceRoot, stateRoot).closeProfileWindow();
  }

  private static service(workspaceRoot: string, stateRoot: string): BrowserAutomationCapabilityService {
    return new BrowserAutomationCapabilityService({
      workspaceRoot,
      stateRoot,
    });
  }
}
