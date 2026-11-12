/* global window, document */
const assert = require('node:assert/strict')

/** 开源热榜：入口、榜单字段、周期切换与打开动作。 */
module.exports = async function verifyTrending({ page, check, capture }) {
  await page.getByRole('button', { name: '开源热榜', exact: true }).click()

  await check('开源热榜显示字段、来源与操作', async () => {
    await page.locator('.trending-page').waitFor()
    const list = page.locator('.trending-list')
    await list.waitFor()
    const text = await list.innerText()
    assert.match(text, /meta \/ astryx/)
    assert.match(text, /\+2,842 今日/)
    assert.match(text, /2\.4 万/)
    assert.match(text, /TypeScript/)
    assert.match(await page.locator('.trending-source').innerText(), /GitHub Trending/)
    await capture('trending-page')

    await page.getByRole('button', { name: '在浏览器打开 meta/astryx' }).click()
    const opens = await page.evaluate(() => window.uiVerification.trendingOpens())
    assert.deepEqual(opens, ['meta/astryx'])
  })

  await check('切换本周后列表与新增文案同步变化', async () => {
    await page.getByRole('tab', { name: '本周' }).click()
    await page.getByText('acme / weekly').waitFor()
    const text = await page.locator('.trending-list').innerText()
    assert.match(text, /\+1,200 本周/)
    assert.doesNotMatch(text, /meta \/ astryx/)
    const calls = await page.evaluate(() => window.uiVerification.trendingCalls())
    assert.equal(calls.at(-1).period, 'weekly')
  })

  await check('窄窗下工具栏和操作不产生横向溢出', async () => {
    const previous = page.viewportSize() ?? { width: 1280, height: 820 }
    await page.setViewportSize({ width: 1024, height: 680 })
    await page.locator('.trending-page').waitFor()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    assert.equal(overflow, false)
    await capture('trending-page-1024')
    await page.setViewportSize(previous)
  })
}
