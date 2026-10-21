/* global document:readonly, window:readonly, getComputedStyle:readonly */
const assert = require('node:assert/strict')

/** 与交互验收共用合成数据，覆盖主题、系统事件、保存失败与阅读器隔离。 */
module.exports = async function verifyThemes({ page, app, check, capture }) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
  )
  const settings = async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.waitForFunction(
      () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
    )
  }
  const theme = async (name, resolved) => {
    await page.getByRole('button', { name, exact: true }).click()
    await page.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      resolved
    )
    await page.waitForFunction(
      () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
    )
  }
  await settings()

  for (const [name, resolved] of [
    ['星轨深空', 'starry'],
    ['静夜石墨', 'graphite'],
    ['晨光纸白', 'paper']
  ]) {
    await check(`${name}：配色、预览、正文对比度与主要页面`, async () => {
      await theme(name, resolved)
      const ratios = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement)
        const rgb = (value) =>
          value.startsWith('#')
            ? value
                .slice(1)
                .match(/../g)
                .map((part) => parseInt(part, 16))
            : value.match(/[\d.]+/g).map(Number)
        const luminance = (channels) =>
          channels
            .slice(0, 3)
            .map((value) => {
              const s = value / 255
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
            })
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
        const base = rgb(style.getPropertyValue('--bg-deep').trim())
        const panel = rgb(style.getPropertyValue('--bg-panel').trim())
        const alpha = panel[3] ?? 1
        const background = luminance(
          panel.map((value, index) => value * alpha + (base[index] ?? 0) * (1 - alpha))
        )
        return [
          '--text-hi',
          '--text-mid',
          '--text-dim',
          '--gold',
          '--gold-dim',
          '--cyan',
          '--pink',
          '--success'
        ].map((token) => {
          const foreground = luminance(rgb(style.getPropertyValue(token).trim()))
          return {
            token,
            ratio:
              (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          }
        })
      })
      for (const result of ratios)
        assert.ok(result.ratio >= 4.5, `${name} ${result.token}: ${result.ratio}`)
      const previews = await page
        .locator('.theme-preview')
        .evaluateAll((items) => items.slice(0, 3).map((item) => getComputedStyle(item).background))
      assert.equal(new Set(previews).size, 3, '预览不应随当前主题变成同一种配色')
      assert.equal(await page.locator('.star').first().isVisible(), resolved === 'starry')
      await capture(`theme-${resolved}-settings`)
      for (const label of ['对话', '书架', '统计', '密码箱', '记事本', '工具']) {
        await page.getByRole('button', { name: label, exact: true }).click()
        assert.equal(
          await page
            .locator('.viewport')
            .evaluate((element) => element.scrollWidth > element.clientWidth),
          false,
          `${name} ${label} 溢出`
        )
        if (label === '对话') {
          const placeholder = await page
            .locator('.composer-input')
            .evaluate((element) => getComputedStyle(element, '::placeholder').color)
          const hint = await page
            .locator('.page-sub')
            .evaluate((element) => getComputedStyle(element).color)
          assert.equal(placeholder, hint, '输入提示也应使用当前主题的辅助文字色')
          await capture(`theme-${resolved}-chat`)
        }
        if (resolved === 'paper' && label === '工具') await capture('theme-paper-tools')
      }
      await settings()
    })
  }

  await check('主题按钮可用键盘选择，焦点清晰可见', async () => {
    const graphite = page.getByRole('button', { name: '静夜石墨', exact: true })
    await graphite.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'graphite')
    await page.waitForFunction(
      () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
    )
    assert.equal(
      await graphite.evaluate((element) => getComputedStyle(element).outlineStyle),
      'solid'
    )
    await page.keyboard.press('Tab')
    assert.equal(
      await page
        .getByRole('button', { name: '晨光纸白', exact: true })
        .evaluate((element) => element === document.activeElement),
      true
    )
  })

  await check('跟随系统实时切换，手选主题不被系统覆盖', async () => {
    await theme('晨光纸白', 'paper')
    await page.emulateMedia({ colorScheme: 'dark' })
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'paper')
    await theme('跟随系统', 'graphite')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper')
    assert.equal(
      (await page.evaluate(() => window.uiVerification.readConfig())).appearance.theme,
      'system'
    )
  })

  await check('背景动效开关与系统减少动态效果生效', async () => {
    await theme('星轨深空', 'starry')
    const motion = page.getByRole('switch', { name: '星空背景动效' })
    await motion.click()
    await page.waitForFunction(
      () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
    )
    assert.equal(await motion.getAttribute('aria-checked'), 'false')
    assert.equal(
      await page
        .locator('.star')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
      'none'
    )
    assert.equal(await page.locator('.shooting-star').first().isVisible(), false)
    await motion.click()
    await page.waitForFunction(
      () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
    )
    assert.equal(
      await page
        .locator('.star')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
      'twinkle'
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(
      await page
        .locator('.star')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
      'none'
    )
    assert.equal(await page.locator('.shooting-star').first().isVisible(), false)
    assert.equal(await motion.getAttribute('aria-checked'), 'true', '系统偏好不覆盖用户开关')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await motion.click()
    await page.waitForFunction(
      () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
    )
  })

  await check('保存失败回退外观、保留缓存与阅读配置', async () => {
    await theme('晨光纸白', 'paper')
    await page.evaluate(() => window.uiVerification.failNextConfigSave())
    await page.getByRole('button', { name: '静夜石墨', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '已恢复上次外观' }).waitFor()
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'paper')
    const config = await page.evaluate(() => window.uiVerification.readConfig())
    assert.deepEqual(config.appearance, { theme: 'paper', backgroundMotion: false })
    assert.equal(config.themeIndex, 3)
    assert.equal(config.fontSize, 23)
    const cache = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('toolbox-appearance-v1'))
    )
    assert.deepEqual(cache, config.appearance)
  })

  await check('缓存损坏时仍从主进程恢复主题和动效偏好', async () => {
    await page.evaluate(() => window.localStorage.setItem('toolbox-appearance-v1', '{broken'))
    await page.reload()
    await settings()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper')
    assert.equal(
      await page.getByRole('switch', { name: '星空背景动效' }).getAttribute('aria-checked'),
      'false'
    )
  })

  await check('浅色主题的密码详情、搜索弹层与菜单跟随配色', async () => {
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: '搜索内容或命令' }).fill('验收账号')
    await page.getByRole('option').first().waitFor()
    await capture('theme-paper-search')
    await page.keyboard.press('Enter')
    await page.getByRole('dialog', { name: '条目详情' }).waitFor()
    await capture('theme-paper-password')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '书架', exact: true }).click()
    await page.locator('.sort-menu-wrap > button').click()
    await page.locator('.sort-menu').waitFor()
    await capture('theme-paper-menu')
    await page.keyboard.press('Escape')
  })

  await check('阅读器纸张、文字与字号独立于应用主题', async () => {
    await settings()
    await theme('跟随系统', 'paper')
    await page.getByRole('button', { name: '书架', exact: true }).click()
    await page.locator('.book-card').filter({ hasText: '甲组小说' }).locator('.book-cover').click()
    await page.getByText('合成章节', { exact: true }).first().waitFor()
    const before = await page.locator('.reader-shell').evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      foreground: getComputedStyle(element.querySelector('.reader-content')).color,
      font: getComputedStyle(element.querySelector('.reader-content')).fontSize
    }))
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'graphite')
    const after = await page.locator('.reader-shell').evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      foreground: getComputedStyle(element.querySelector('.reader-content')).color,
      font: getComputedStyle(element.querySelector('.reader-content')).fontSize
    }))
    assert.deepEqual(after, before)
    assert.equal(before.font, '23px')
    await capture('theme-independent-reader')
    await page.getByRole('button', { name: '返回书架', exact: true }).click()
    await settings()
    await theme('晨光纸白', 'paper')
  })

  for (const [width, height] of [
    [1024, 680],
    [1920, 1080]
  ]) {
    await check(`${width}×${height} 主题设置无裁切`, async () => {
      await app.evaluate(
        ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
        [width, height]
      )
      const boxes = await page.locator('.appearance-choice').evaluateAll((items) =>
        items.map((item) => {
          const box = item.getBoundingClientRect()
          return { x: box.x, right: box.right, width: box.width }
        })
      )
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      for (const box of boxes)
        assert.ok(box.x >= 0 && box.right <= viewportWidth && box.width >= 180)
      assert.equal(
        await page
          .locator('.viewport')
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        false
      )
      await capture(`theme-paper-settings-${width}`)
    })
  }
}
