import { expect, test } from '@playwright/test';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../server/router';

const serverPort = process.env.HEDDLE_BROWSER_INTEGRATION_SERVER_PORT ?? '19876';
const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `http://127.0.0.1:${serverPort}/trpc`,
    }),
  ],
});

test('loads the web v2 shell sections', async ({ page }) => {
  const sessionEvents = page.waitForResponse((response) => (
    response.url().includes('/trpc/controlPlane.sessionEvents') && response.status() === 200
  ));
  await page.goto('/sessions');
  await sessionEvents;

  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Context inspector' })).toBeVisible();
  await expect(page.getByTestId('web-v2-surface-sessions')).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-title')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page');
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

test('navigates primary and settings routes without hash routing', async ({ page }) => {
  await page.goto('/sessions');

  await page.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page).not.toHaveURL(/#/);
  await expect(page.getByTestId('web-v2-surface-tasks')).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-title')).toHaveText('Tasks');
  await expect(page.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByTestId('web-v2-settings-general')).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-title')).toHaveText('General');

  await page.getByRole('link', { name: 'Memory Status' }).click();
  await expect(page).toHaveURL(/\/settings\/memory$/);
  await expect(page.getByTestId('web-v2-settings-memory')).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-title')).toHaveText('Memory Status');

  await page.getByRole('button', { name: 'Back to App' }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByTestId('web-v2-surface-sessions')).toBeVisible();
});

test('submits a prompt and renders the mocked session response', async ({ page }) => {
  const session = await trpc.controlPlane.sessionCreate.mutate({ name: 'Web v2 submit smoke' });

  await page.goto('/sessions');
  await page.getByRole('button', { name: /Web v2 submit smoke/ }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Run the web v2 submit smoke');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Run the web v2 submit smoke', { exact: true })).toBeVisible();
  await expect(page.getByText('Mocked browser integration agent response', { exact: true })).toBeVisible();
  await expect(page.getByTestId('web-v2-live-status')).toHaveText('Receiving assistant response...');
  await expect(page.getByText('Mocked browser integration agent response: Run the web v2 submit smoke', { exact: true })).toBeVisible();
  await expect(page.getByTestId('web-v2-workbench-title')).toHaveText(session.name);
});
