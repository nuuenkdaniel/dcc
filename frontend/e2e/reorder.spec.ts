import { test, expect } from './authenticated'

test('drag and keyboard reorder determine focus order', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/pomodoro')
  await page.getByRole('button', { name: 'Timer settings' }).click()
  for (const name of ['Read', 'Practice', 'Review']) {
    await page.getByLabel('Mini timer name', { exact: true }).fill(name)
    await page.getByRole('button', { name: 'Add mini timer' }).click()
  }
  const handle = page.getByRole('button', { name: 'Reorder Review' })
  const from = await handle.boundingBox()
  const to = await page.getByRole('button', { name: 'Reorder Read' }).boundingBox()
  await page.mouse.move(from!.x + 12, from!.y + 12)
  await page.mouse.down()
  await page.mouse.move(to!.x + 12, to!.y + 12, { steps: 10 })
  await expect(page.getByTestId('timer-drag-preview')).toBeVisible()
  await expect(page.locator('.timer-drop-before')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/timer-drag-preview.png', fullPage: true })
  await page.mouse.up()
  await expect(page.getByTestId('timer-drag-preview')).toHaveCount(0)
  await expect(page.locator('.settings-mini-list > div > span')).toHaveText(['Review', 'Read', 'Practice'])
  await handle.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.settings-mini-list > div > span')).toHaveText(['Read', 'Review', 'Practice'])
  await page.keyboard.press('ArrowUp')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.locator('.focus-status')).toHaveText('Review')
})
