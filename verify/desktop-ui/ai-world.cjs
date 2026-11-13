/* global window:readonly, document:readonly */
const assert = require('node:assert/strict')

module.exports = async function verifyAiWorld({ page, app, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const table = () => page.getByRole('table', { name: 'AI 模型列表' })

  await check('AI 情报分类包含开源热榜与 AI 模型世界', async () => {
    const group = button('AI 情报')
    if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
    const aiWorld = button('AI 模型世界')
    const trending = button('开源热榜')
    await aiWorld.waitFor()
    await trending.waitFor()
    assert.equal(await aiWorld.isVisible(), true)
    assert.equal(await trending.isVisible(), true)
  })

  await check('AI 模型世界显示今日格局、模型列表与详情抽屉', async () => {
    await button('AI 模型世界').click()
    await page.getByRole('heading', { name: '模型格局', level: 2 }).waitFor()
    assert.equal(await page.locator('.ai-world-champion').count(), 8)
    await page.getByText('Claude Fable 5.2', { exact: true }).first().waitFor()
    await page.getByText('GPT-6 Astra', { exact: true }).first().waitFor()
    await table().waitFor()
    await table().getByText('DeepSeek V4 Flash', { exact: true }).waitFor()
    await page.locator('.viewport').evaluate((node) => {
      node.scrollTop = 0
    })
    await capture('ai-world-page')

    await table().getByRole('button', { name: 'DeepSeek V4 Flash', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'DeepSeek V4 Flash' })
    await dialog.waitFor()
    await dialog.getByText('编程', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: '来源', exact: true }).first().click()
    assert.ok((await page.evaluate(() => window.uiVerification.aiWorldOpenCount())) >= 1)
    await capture('ai-world-detail')
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  })

  await check('能力-价格前沿显示 ECI × 价格点、前沿线与详情入口', async () => {
    await page.getByRole('button', { name: '能力-价格前沿', exact: true }).click()
    await page.getByRole('img', { name: 'AI 模型能力-价格前沿图' }).waitFor()
    assert.ok((await page.locator('.ai-world-frontier-dot').count()) > 0)
    assert.ok((await page.locator('.ai-world-frontier-dot.is-frontier').count()) > 0)
    await page.locator('.ai-world-frontier-card').scrollIntoViewIfNeeded()
    const allDots = await page.locator('.ai-world-frontier-dot').count()
    await page.getByRole('button', { name: '国内', exact: true }).click()
    await page.waitForFunction((expectedAll) => {
      const dots = document.querySelectorAll('.ai-world-frontier-dot')
      return dots.length > 0 && dots.length < expectedAll
    }, allDots)
    assert.ok((await page.locator('.ai-world-frontier-dot').count()) < allDots)
    assert.equal(
      await page.getByRole('button', { name: '国内', exact: true }).getAttribute('aria-pressed'),
      'true'
    )
    await capture('ai-world-frontier-east')
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await page.locator('.ai-world-frontier-dot.is-frontier').first().hover()
    const tooltip = page.locator('.ai-world-frontier-tooltip')
    await tooltip.waitFor()
    assert.match(await tooltip.innerText(), /ECI/)
    await capture('ai-world-frontier-hover')
    await page.mouse.move(0, 0)
    await capture('ai-world-frontier')

    await page.locator('.ai-world-frontier-model').first().click()
    const dialog = page.getByRole('dialog').first()
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()

    await page.getByRole('button', { name: '列表', exact: true }).click()
    await table().waitFor()
  })

  await check('筛选、搜索与空状态不会把未参赛当成 0', async () => {
    const search = page.getByRole('textbox', { name: '搜索 AI 模型' })
    await search.fill('Claude')
    await table().getByText('Claude Fable 5.2', { exact: true }).waitFor()
    await page.waitForFunction(() => {
      const table = document.querySelector('table[aria-label="AI 模型列表"]')
      return table && !table.textContent?.includes('Qwen3.8 Max')
    })
    assert.equal(await table().getByText('Qwen3.8 Max', { exact: true }).count(), 0)

    await search.fill('')
    await search.fill('GPT Image 2')
    await table().getByText('未参赛', { exact: true }).first().waitFor()
    await search.fill('')

    await page.getByRole('button', { name: '地区筛选' }).click()
    await page.getByRole('option', { name: '国内', exact: true }).click()
    await table().getByText('DeepSeek V4 Flash', { exact: true }).waitFor()
    await table().getByText('Qwen3.8 Max', { exact: true }).waitFor()
    await page.waitForFunction(() => {
      const table = document.querySelector('table[aria-label="AI 模型列表"]')
      return table && !table.textContent?.includes('Claude Fable 5.2')
    })
    assert.equal(await table().getByText('Claude Fable 5.2', { exact: true }).count(), 0)

    await page.getByRole('button', { name: '地区筛选' }).click()
    await page.getByRole('option', { name: '全部地区', exact: true }).click()
    await search.fill('没有任何这个模型')
    await page.getByText('没有匹配的模型', { exact: false }).waitFor()
    await search.fill('')
  })

  await check('刷新失败保留旧数据并提示，数据来源弹层可打开白名单链接', async () => {
    await page.evaluate(() => window.uiVerification.failNextAiWorld())
    await button('刷新').click()
    await page.getByRole('alert').filter({ hasText: 'AI 模型数据更新失败' }).waitFor()
    await page.getByText('Claude Fable 5.2', { exact: true }).first().waitFor()

    await button('数据来源').click()
    const sources = page.getByRole('dialog', { name: '数据来源与许可' })
    await sources.waitFor()
    const before = await page.evaluate(() => window.uiVerification.aiWorldOpenCount())
    await sources.getByRole('button', { name: '打开', exact: true }).first().click()
    assert.equal(await page.evaluate(() => window.uiVerification.aiWorldOpenCount()), before + 1)
    await capture('ai-world-sources')
    await sources.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('alert').getByRole('button', { name: '关闭', exact: true }).click()
  })

  await check('窄窗口下模型列表和详情不撑宽页面', async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 680)
    )
    await button('AI 模型世界').click()
    await page.getByRole('heading', { name: '模型格局', level: 2 }).waitFor()
    await page.locator('.viewport').evaluate((node) => {
      node.scrollTop = 0
    })
    assert.equal(
      await page.locator('.viewport').evaluate((node) => node.scrollWidth > node.clientWidth),
      false
    )
    await capture('ai-world-page-1024')
    await table().getByRole('button', { name: 'Claude Fable 5.2', exact: true }).click()
    await page.getByRole('dialog', { name: 'Claude Fable 5.2' }).waitFor()
    assert.equal(
      await page.locator('.viewport').evaluate((node) => node.scrollWidth > node.clientWidth),
      false
    )
    await capture('ai-world-detail-1024')
    await page
      .getByRole('dialog', { name: 'Claude Fable 5.2' })
      .getByRole('button', { name: '关闭', exact: true })
      .click()

    await page.getByRole('button', { name: '能力-价格前沿', exact: true }).click()
    await page.getByRole('img', { name: 'AI 模型能力-价格前沿图' }).waitFor()
    assert.equal(
      await page.locator('.viewport').evaluate((node) => node.scrollWidth > node.clientWidth),
      false
    )
    await page.locator('.ai-world-frontier-card').scrollIntoViewIfNeeded()
    await capture('ai-world-frontier-1024')
    await page.getByRole('button', { name: '列表', exact: true }).click()
    await table().waitFor()

    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
    )
  })
}
