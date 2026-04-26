import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const secondaryWorkspace = resolve(repoRoot, '.e2e/workspaces/secondary');

test('loads overview with fixture workspace state', async ({ page }) => {
  await page.goto('/overview');

  await expect(page.getByTestId('nav-overview')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('overview-active-workspace')).toContainText('primary');
  await expect(page.getByTestId('overview-memory-health')).toBeVisible();
});

test('preserves route selection across refresh', async ({ page }) => {
  await page.goto('/workspaces');

  await expect(page.getByTestId('nav-workspaces')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('workspace-list')).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByTestId('nav-workspaces')).toHaveAttribute('aria-current', 'page');
});

test('shows current git diff in the review surface', async ({ page }) => {
  await page.goto('/sessions');

  await expect(page.getByTestId('review-current-workspace')).toBeVisible();
  await expect(page.getByTestId('review-current-file-list')).toContainText('README.md');
  await expect(page.getByTestId('review-current-file-list')).toContainText('+2 / -0');
});

test('registers and switches to another workspace from the browser', async ({ page }) => {
  await page.goto('/workspaces');

  await page.getByTestId('workspace-create-name').fill('secondary');
  await page.getByTestId('workspace-create-path').fill(secondaryWorkspace);
  await page.getByTestId('workspace-create-submit').click();

  await expect(page.getByTestId('workspace-list')).toContainText('secondary');
  await expect(page.getByTestId('workspace-list')).toContainText(secondaryWorkspace);
  await expect(page.getByTestId('workspace-switcher')).toHaveValue(/workspace-/);

  await page.goto('/overview');

  await expect(page.getByTestId('overview-active-workspace')).toContainText('secondary');
});

test('mobile navigation exposes the primary sections', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/overview');

  await expect(page.getByTestId('mobile-nav-overview')).toHaveAttribute('aria-current', 'page');

  await page.getByTestId('mobile-nav-workspaces').click();
  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByTestId('workspace-list')).toBeVisible();

  await page.getByTestId('mobile-nav-sessions').click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByTestId('new-session-button')).toBeVisible();
});
