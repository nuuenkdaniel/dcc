import { test, expect } from './authenticated'

for (const width of [375, 768, 1024, 1920, 3672]) {
  test(`homepage fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('http://127.0.0.1:5173')
    await expect(page.getByLabel('Task title',{exact:true})).toBeVisible()
    const metrics = await page.evaluate(() => {
      const button = document.querySelector('.form-row button')!
      const content = document.querySelector('.content')!.getBoundingClientRect()
      const sidebar = document.querySelector('.sidebar')!.getBoundingClientRect()
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        buttonHeight: button.getBoundingClientRect().height,
        whiteSpace: getComputedStyle(button).whiteSpace,
        leftGap: content.left - sidebar.right,
        rightGap: innerWidth - content.right,
        calendarOverflow: document.querySelector('.calendar-actions')!.getBoundingClientRect().right > document.querySelector('.calendar-card')!.getBoundingClientRect().right,
      }
    })
    expect(metrics.overflow).toBe(false)
    expect(metrics.calendarOverflow).toBe(false)
    expect(metrics.whiteSpace).toBe('nowrap')
    if (width > 480) expect(Math.abs(metrics.leftGap - metrics.rightGap)).toBeLessThanOrEqual(10)
    await page.getByLabel('Task title', { exact: true }).fill('A'.repeat(180))
    await page.getByRole('button', { name: 'Add task', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/home-${width}.png`, fullPage: true })
  })
}

test('development toolbar switches page previews and keeps sample data isolated', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173')
  await expect(page.getByRole('toolbar', { name: 'Development tools' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Sample data' }).check()
  await expect(page.getByText('Review calendar integration')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('productivity-app.tasks.v1'))).toBeNull()
  await page.getByRole('button', { name: 'Inbox view' }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/view-inbox.png', fullPage: true })
  await page.getByRole('button', { name: 'Home view' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Review calendar integration')).toBeVisible()
})

test('sidebar collapses to a functional icon rail', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await page.goto('http://127.0.0.1:5173')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()

  const sidebar = page.locator('.sidebar')
  await expect(sidebar).toHaveClass(/collapsed/)
  await expect(sidebar).toHaveCSS('width', '72px')
  expect(await sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(72)
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()

  await page.getByRole('button', { name: 'Focus', exact: true }).click()
  await expect(page).toHaveURL(/\/pomodoro$/)
  await expect(page.getByRole('heading', { name: 'Focus session' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/sidebar-collapsed.png', fullPage: true })
})

test('pomodoro view runs a mini timer without overflowing', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('http://127.0.0.1:5173/pomodoro')
  await expect(page).toHaveURL(/\/pomodoro$/)
  await expect(page.getByRole('heading', { name: 'Focus session' })).toBeVisible()
  await page.getByRole('button', { name: 'Timer settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Timer setup' })).toBeVisible()
  await expect(page.getByLabel('Break timer (minutes)')).toHaveValue('5')
  const focusMinutes = page.getByLabel('Focus timer (minutes)')
  await focusMinutes.fill('')
  await expect(focusMinutes).toHaveValue('')
  await focusMinutes.fill('40')
  await expect(focusMinutes).toHaveValue('40')
  await focusMinutes.focus()
  const focusStyles = await focusMinutes.evaluate((input) => ({
    outline: getComputedStyle(input).outlineStyle,
    parentShadow: getComputedStyle(input.parentElement!).boxShadow,
  }))
  expect(focusStyles.outline).toBe('none')
  expect(focusStyles.parentShadow).not.toBe('none')
  await page.getByLabel('Mini timer name').fill('Review flashcards')
  await page.getByLabel('Mini timer minutes').fill('3')
  await page.getByRole('button', { name: 'Add mini timer' }).click()
  const remove = page.getByRole('button', { name: 'Remove Review flashcards' })
  await expect(remove).toHaveCSS('border-top-style', 'solid')
  expect(await remove.evaluate(el => el.getBoundingClientRect().height)).toBe(32)
  await expect(remove).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.settings-mini-list small').first()).toHaveCSS('font-size', '14px')
  await expect(page.locator('.settings-mini-list > div > span').first()).toHaveCSS('font-size', '14px')
  const centers = await page.locator('.settings-mini-list > div').first().evaluate(row => Array.from(row.querySelectorAll('svg, :scope > span, small, :scope > button')).map(el => { const rect = el.getBoundingClientRect(); return rect.y + rect.height / 2 }))
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: 'test-results/view-pomodoro-settings-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('session-time')).toHaveText('03:00')
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByText('Review flashcards', { exact: true }).last()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause session' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/view-pomodoro-mobile.png', fullPage: true })

  await page.setViewportSize({ width: 1920, height: 1000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/view-pomodoro-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Timer settings' }).click()
  const dialogMetrics = await page.getByRole('dialog', { name: 'Timer setup' }).evaluate((dialog) => {
    const stepButton = dialog.querySelector('.stepper-control button')!.getBoundingClientRect()
    return {
      width: dialog.getBoundingClientRect().width,
      labelSize: Number.parseFloat(getComputedStyle(dialog.querySelector('label')!).fontSize),
      stepButtonWidth: stepButton.width,
      stepButtonHeight: stepButton.height,
    }
  })
  expect(dialogMetrics.width).toBeGreaterThanOrEqual(600)
  expect(dialogMetrics.labelSize).toBeGreaterThanOrEqual(13)
  expect(dialogMetrics.stepButtonWidth).toBeGreaterThanOrEqual(44)
  expect(dialogMetrics.stepButtonHeight).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: 'test-results/view-pomodoro-settings-desktop.png', fullPage: true })
})
