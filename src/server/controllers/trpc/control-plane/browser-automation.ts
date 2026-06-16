import { BrowserAutomationCapabilityService } from '@/core/browser/index.js';
import type {
  BrowserAutomationNativeChromeLaunchInput,
  BrowserAutomationSettingsUpdateInput,
} from '@/core/browser/index.js';

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
    input: BrowserAutomationSettingsUpdateInput,
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

  static async launchNativeChrome(
    workspaceRoot: string,
    stateRoot: string,
    input: BrowserAutomationNativeChromeLaunchInput,
  ) {
    return await ControlPlaneBrowserAutomationController.service(workspaceRoot, stateRoot).launchNativeChrome(input);
  }

  static async nativeChromeStatus(workspaceRoot: string, stateRoot: string) {
    return await ControlPlaneBrowserAutomationController.service(workspaceRoot, stateRoot).nativeChromeStatus();
  }

  private static service(workspaceRoot: string, stateRoot: string): BrowserAutomationCapabilityService {
    return new BrowserAutomationCapabilityService({
      workspaceRoot,
      stateRoot,
    });
  }
}
