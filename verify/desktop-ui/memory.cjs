/* global window:readonly, document:readonly, getComputedStyle:readonly */
const assert = require('node:assert/strict')
const { withDialog } = require('./dialog.cjs')
const openSettings = require('./settings-nav.cjs')

/** 设置页「AI 记忆」：显式记忆的新增、置顶、归档、恢复与删除。 */
module.exports = async function verifyMemory({ page, check, capture }) {
  await openSettings(page, 'AI 记忆')
  const card = page.locator('section[aria-label="AI 记忆"]')
  await card.scrollIntoViewIfNeeded()
  await card.locator('h2.sec-title').filter({ hasText: 'AI 记忆' }).waitFor({ state: 'attached' })

  await check('AI 记忆卡片展示已有记忆、候选与置顶统计', async () => {
    await page.getByText('共 3 条 · 置顶 1 条 · 待确认 1 条', { exact: true }).waitFor()
    await page.getByText('不要自动提交', { exact: true }).waitFor()
    await page.getByText('回答先给结论', { exact: true }).waitFor()
    await page.getByText('每周整理待办', { exact: true }).waitFor()
    await capture('settings-memory-list')
  })

  await check('候选展示来源，批准后转为生效', async () => {
    const row = page.locator('.memory-item').filter({ hasText: '每周整理待办' })
    await row.getByText('待确认', { exact: true }).waitFor()
    await row.getByText('来源：以后每周五都帮我整理一下待办', { exact: true }).waitFor()
    await row.getByRole('button', { name: '批准', exact: true }).click()
    await row.getByText('生效', { exact: true }).waitFor()
    await page.getByText('共 3 条 · 置顶 1 条', { exact: true }).waitFor()
  })

  await check('新建记忆后立即出现在列表', async () => {
    await page.getByRole('button', { name: '新建记忆', exact: true }).click()
    await page.getByLabel('标题 · TITLE', { exact: true }).fill('发布前先跑检查')
    await page
      .getByLabel('内容 · CONTENT', { exact: true })
      .fill('发布前先执行 typecheck、lint 和构建，再提交。')
    await page.getByLabel('标签 · TAGS', { exact: true }).fill('发布流程、协作')
    await page.getByRole('button', { name: '保存记忆', exact: true }).click()
    await page.getByText('记忆已保存', { exact: true }).waitFor()
    await page.getByText('发布前先跑检查', { exact: true }).waitFor()

    const items = await page.evaluate(() => window.uiVerification.memoryItems())
    assert.equal(items[0].title, '发布前先跑检查')
    assert.deepEqual(items[0].tags, ['发布流程', '协作'])
    assert.equal(items[0].status, 'active')
  })

  await check('置顶与取消置顶同步到卡片和统计', async () => {
    const row = page.locator('.memory-item').filter({ hasText: '发布前先跑检查' })
    await row.getByRole('button', { name: '置顶', exact: true }).click()
    await row.getByRole('button', { name: '取消置顶', exact: true }).waitFor()
    await page.getByText('共 4 条 · 置顶 2 条', { exact: true }).waitFor()

    await row.getByRole('button', { name: '取消置顶', exact: true }).click()
    await row.getByRole('button', { name: '置顶', exact: true }).waitFor()
    await page.getByText('共 4 条 · 置顶 1 条', { exact: true }).waitFor()
  })

  await check('归档后不再计入置顶，可恢复为生效', async () => {
    const row = page.locator('.memory-item').filter({ hasText: '不要自动提交' })
    await row.getByRole('button', { name: '归档', exact: true }).click()
    await row.getByText('已归档', { exact: true }).waitFor()
    await page.getByText('共 4 条 · 置顶 0 条', { exact: true }).waitFor()

    await row.getByRole('button', { name: '恢复', exact: true }).click()
    await row.getByText('生效', { exact: true }).waitFor()
    await page.getByText('共 4 条 · 置顶 1 条', { exact: true }).waitFor()
  })

  await check('删除需要二次确认，确认后从列表移除', async () => {
    const row = page.locator('.memory-item').filter({ hasText: '发布前先跑检查' })
    await withDialog(page, true, () =>
      row.getByRole('button', { name: '删除', exact: true }).click()
    )
    await row.waitFor({ state: 'detached' })
    await page.getByText('记忆已删除', { exact: true }).waitFor()

    const titles = await page.evaluate(() =>
      window.uiVerification.memoryItems().map((item) => item.title)
    )
    assert.equal(titles.includes('发布前先跑检查'), false)
  })

  await check('自动学习可独立开关', async () => {
    const auto = page.getByRole('switch', { name: '自动提取候选记忆' })
    assert.equal(await auto.getAttribute('aria-checked'), 'true')
    await auto.click()
    await page.getByRole('switch', { name: '自动提取候选记忆', checked: false }).waitFor()
    await auto.click()
    await page.getByRole('switch', { name: '自动提取候选记忆', checked: true }).waitFor()
  })

  await check('导出与导入入口可用', async () => {
    await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
    await page.getByText('记忆已导出：fixture-memory.json', { exact: true }).waitFor()
    await withDialog(page, true, () =>
      page.getByRole('button', { name: '导入 JSON', exact: true }).click()
    )
    await page.getByText('导入完成：新增 0 条，更新 0 条，跳过 0 条', { exact: true }).waitFor()
  })

  await check('关闭总开关给出明确提示，已有记忆仍可见', async () => {
    const toggle = page.getByRole('switch', { name: '启用长期记忆' })
    await toggle.click()
    await page
      .getByText('长期记忆已关闭：不会注入记忆，也不会向 AI 暴露记忆工具。', { exact: false })
      .waitFor()
    assert.equal(await toggle.getAttribute('aria-checked'), 'false')
    await page.getByText('回答先给结论', { exact: true }).waitFor()
    await capture('settings-memory-disabled')
    await toggle.click()
    await page
      .getByText('长期记忆已关闭：不会注入记忆，也不会向 AI 暴露记忆工具。', { exact: false })
      .waitFor({ state: 'detached' })
    assert.equal(await toggle.getAttribute('aria-checked'), 'true')
  })

  await check('纸白主题下记忆编辑器跟随主题，不再出现黑色块', async () => {
    await openSettings(page, '外观与主题')
    await page.getByRole('button', { name: '晨光纸白', exact: true }).click()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper')
    await openSettings(page, 'AI 记忆')
    await page.getByRole('button', { name: '新建记忆', exact: true }).click()

    const editor = page.locator('.memory-editor')
    await editor.waitFor()
    const background = await editor.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
    const channels = background.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? []
    assert.equal(channels.length, 3, `无法解析编辑器背景: ${background}`)
    assert.ok(
      channels.reduce((sum, value) => sum + value, 0) / 3 > 180,
      `纸白主题编辑器背景过暗: ${background}`
    )
    await editor.scrollIntoViewIfNeeded()
    await capture('settings-memory-paper-editor')
    await editor.getByRole('button', { name: '取消', exact: true }).first().click()
  })
}
