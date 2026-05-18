import { expect, test } from '@playwright/test';

test('loads the web v2 shell sections', async ({ page }) => {
  await page.goto('/sessions');

  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Context inspector' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page');
});

test('navigates primary and settings routes without hash routing', async ({ page }) => {
  await page.goto('/sessions');

  await page.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page).not.toHaveURL(/#/);
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();

  await page.getByRole('link', { name: 'Memory Status' }).click();
  await expect(page).toHaveURL(/\/settings\/memory$/);
  await expect(page.getByRole('heading', { name: 'Memory Status' })).toBeVisible();

  await page.getByRole('button', { name: 'Back to App' }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
});
