import { expect, test, type Locator } from '@playwright/test';
import { createTRPCProxyClient, httpLink } from '@trpc/client';
import type { AppRouter } from '../../../server/router';

const serverPort = process.env.HEDDLE_BROWSER_INTEGRATION_SERVER_PORT ?? '19876';
const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpLink({
      url: `http://127.0.0.1:${serverPort}/trpc`,
    }),
  ],
});

test('loads the web v2 shell sections', async ({ page }) => {
  const eventStreams = new Set<string>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    const eventPath = url.pathname.match(/\/trpc\/(controlPlane\.[^,?/]*Events)/)?.[1];
    if (eventPath) {
      eventStreams.add(eventPath);
    }
  });
  const sessionEvents = page.waitForResponse((response) => (
    response.url().includes('/trpc/controlPlane.sessionEvents') && response.status() === 200
  ));
  await page.goto('/sessions');
  await sessionEvents;
  await page.waitForTimeout(250);

  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Context inspector' })).toBeVisible();
  await expect(page.getByTestId('web-v2-surface-sessions')).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-title')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page');
  expect([...eventStreams].sort()).toEqual(['controlPlane.sessionEvents']);
});

test('collapses and expands the sidebar', async ({ page }) => {
  await page.goto('/sessions');

  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' });
  await expect(sidebar).toBeVisible();

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar).toHaveCSS('width', '0px');

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar).not.toHaveCSS('width', '0px');
});

test('opens side panels as mobile overlays', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sessions');
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  const sidebarDialog = page.getByRole('dialog', { name: 'Primary navigation' });
  await expect(sidebarDialog).toBeVisible();
  await expect(sidebarDialog).toHaveCSS('position', 'fixed');
  await expect(page.getByTestId('web-v2-surface-sessions')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sidebarDialog).not.toBeVisible();

  await page.getByRole('button', { name: 'Expand context inspector' }).click();
  const inspectorDialog = page.getByRole('dialog', { name: 'Context inspector' });
  await expect(inspectorDialog).toBeVisible();
  await expect(inspectorDialog).toHaveCSS('position', 'fixed');
  await expect(page.getByTestId('web-v2-surface-sessions')).toBeVisible();
});

test('navigates primary and settings routes without hash routing', async ({ page }) => {
  await page.goto('/sessions');

  await page.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks(\/browser-heartbeat)?$/);
  await expect(page).not.toHaveURL(/#/);
  await expect(page.getByTestId('web-v2-surface-tasks')).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-title')).toContainText(/Tasks|Browser heartbeat/);
  await expect(page.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByTestId('web-v2-settings-general')).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-title')).toHaveText('General');
  await expect(page.getByLabel('Language')).toBeVisible();

  await page.getByRole('link', { name: 'Memory Status' }).click();
  await expect(page).toHaveURL(/\/settings\/memory$/);
  await expect(page.getByTestId('web-v2-settings-memory')).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-title')).toHaveText('Memory Status');
  const memorySettings = page.getByTestId('web-v2-workbench-body');
  await expect(memorySettings.getByText('Workspace memory')).toBeVisible();
  await expect(memorySettings.getByText('Healthy')).toBeVisible();
  await expect(memorySettings.getByText('10', { exact: true })).toBeVisible();
  await expect(memorySettings.getByText('1', { exact: true })).toBeVisible();
  await expect(memorySettings.getByText('memory-run-browser')).toBeVisible();
  await expect(memorySettings.getByText('Browser memory maintenance completed.')).toBeVisible();

  await page.getByRole('button', { name: 'Back to App' }).click();
  await expect(page).toHaveURL(/\/sessions(\/[^/]+)?$/);
  await expect(page.getByTestId('web-v2-surface-sessions')).toBeVisible();
});

test('shows task run workbench and run details', async ({ page }) => {
  const state = await trpc.controlPlane.state.query();
  await trpc.controlPlane.workspaceSetActive.mutate({ workspaceId: state.activeWorkspaceId });
  await page.goto('/tasks');
  const taskList = page.getByRole('region', { name: 'Tasks' });

  await expect(page).toHaveURL(/\/tasks\/browser-heartbeat$/);
  await expect(taskList.getByRole('button', { name: /Browser heartbeat/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('web-v2-surface-tasks')).toBeVisible();
  await expect(page.getByText('Check browser integration heartbeat state.').first()).toBeVisible();
  await expect(page.getByText('Browser heartbeat completed.').first()).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Task run details' })).toBeVisible();
  await expect(page.getByText('Run details')).toBeVisible();

  await page.getByRole('button', { name: 'Edit task' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Edit task' })).not.toBeVisible();

  const deleteSmoke = await trpc.controlPlane.heartbeatTaskCreate.mutate({
    id: `delete-smoke-${Date.now()}`,
    name: 'Delete smoke task',
    task: 'Task used to verify the delete confirmation dialog.',
    intervalMs: 60_000,
    defer: true,
  });
  await page.goto(`/tasks/${deleteSmoke.task.taskId}`);
  await page.getByRole('button', { name: 'Delete task' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete task' })).toBeVisible();
  await expect(page.getByText('Delete this task, its checkpoint, and recorded runs. This cannot be undone.')).toBeVisible();

  const toggleSmoke = await trpc.controlPlane.heartbeatTaskCreate.mutate({
    id: `toggle-smoke-${Date.now()}`,
    name: 'Toggle smoke task',
    task: 'Task used to verify enable and continuation controls.',
    intervalMs: 60_000,
    defer: true,
  });
  await page.goto(`/tasks/${toggleSmoke.task.taskId}`);
  await expect(page.getByText('Operator controlled')).toBeVisible();
  await page.getByRole('switch', { name: 'Disable task' }).click();
  await expect(page.getByText('paused').first()).toBeVisible();
  await page.getByRole('switch', { name: 'Enable task' }).click();
  await expect(page.getByText('enabled').first()).toBeVisible();
});

test('submits a prompt and renders the mocked session response', async ({ page }) => {
  const sessionName = `Web v2 submit smoke ${Date.now()}`;
  const session = await trpc.controlPlane.sessionCreate.mutate({ name: sessionName });

  await page.goto('/sessions');
  const sessionList = page.getByRole('region', { name: 'Recent sessions' });
  const sessionListItem = sessionList.getByRole('button', { name: new RegExp(sessionName) });
  await sessionListItem.click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}$`));
  await expect(sessionListItem).toHaveAttribute('aria-current', 'true');
  await expect(sessionListItem).toHaveClass(/bg-sidebar-accent/);
  await page.getByRole('textbox', { name: 'Message' }).fill('Run the web v2 submit smoke');
  const sendButton = page.getByRole('button', { name: 'Send' });
  await expectComposerActionButtonCircle(sendButton);
  await sendButton.click();

  const stopButton = page.getByRole('button', { name: 'Stop' });
  await expect(stopButton).toBeVisible();
  await expectComposerActionButtonCircle(stopButton);
  await expect(page.getByText('Run the web v2 submit smoke', { exact: true })).toBeVisible();
  await expect(page.getByText('Mocked browser integration agent response', { exact: true })).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-body').getByText(
    'Mocked browser integration agent response: Run the web v2 submit smoke',
    { exact: true },
  )).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-title')).toHaveText(session.name);
});

async function expectComposerActionButtonCircle(locator: Locator) {
  await expect(locator).toHaveCSS('height', '32px');
  await expect(locator).toHaveCSS('width', '32px');
  const shape = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      className: element.className,
      height: rect.height,
      radius: Number.parseFloat(style.borderTopLeftRadius),
      width: rect.width,
    };
  });

  expect(shape.className).toContain('rounded-full');
  expect(shape.className).not.toContain('rounded-md');
  expect(shape.radius).toBeGreaterThanOrEqual(Math.min(shape.width, shape.height) / 2);
}

test('updates session model and reasoning settings from the composer controls', async ({ page }) => {
  const sessionName = `Web v2 settings smoke ${Date.now()}`;
  const session = await trpc.controlPlane.sessionCreate.mutate({
    name: sessionName,
    model: 'gpt-5.4',
  });

  await page.goto('/sessions');
  await page.getByRole('region', { name: 'Recent sessions' }).getByRole('button', { name: new RegExp(sessionName) }).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}$`));

  await page.getByRole('button', { name: /Execution settings/ }).click();
  await page.getByRole('menuitemradio', { name: /^gpt-5\.5$/ }).click();
  await expect.poll(async () => (
    (await trpc.controlPlane.session.query({ id: session.id }))?.model
  )).toBe('gpt-5.5');

  await page.getByRole('menuitemradio', { name: 'High', exact: true }).click();
  await expect.poll(async () => (
    (await trpc.controlPlane.session.query({ id: session.id }))?.reasoningEffort
  )).toBe('high');

  await page.getByRole('menuitemradio', { name: 'Medium', exact: true }).click();
  await expect.poll(async () => (
    (await trpc.controlPlane.session.query({ id: session.id }))?.reasoningEffort
  )).toBe('medium');
});
