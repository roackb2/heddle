import { expect, test } from '@playwright/test';

test('loads the web v2 shell sections', async ({ page }) => {
  await page.goto('/sessions');

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
