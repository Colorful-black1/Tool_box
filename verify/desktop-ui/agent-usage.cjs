/* global window:readonly, document:readonly, innerWidth:readonly, innerHeight:readonly, localStorage:readonly */
const assert = require('node:assert/strict')

module.exports = async function verifyAgentUsage({ page, app, check, capture }) {
  const open = () => page.getByRole('button', { name: 'Token 统计', exact: true }).click()
  const idle = () =>
    page.waitForFunction(
      () => document.querySelector('.agent-usage-ledger')?.getAttribute('aria-busy') === 'false'
    )
  const select = async (name, value) => {
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('option', { name: value, exact: true }).click()
    await idle()
  }
  await page.evaluate(() => localStorage.removeItem('toolbox.agent-usage.prefs.v1'))
  await open()
  await page.locator('.agent-usage-ledger tbody tr').first().waitFor()
  await check('独立用量入口无需 Agent 连接，显示分类、花费与未知字段', async () => {
    assert.equal(await page.locator('.agent-usage-metric').count(), 7)
    assert.equal(
      await page.locator('.agent-usage-metric').filter({ hasText: '缓存写入' }).innerText(),
      '缓存写入\n未知'
    )
    assert.equal(
      await page.locator('.agent-usage-metric').filter({ hasText: '原生上报花费' }).innerText(),
      '原生上报花费\n0.16 USD\n仅 OpenCode 原生上报，不做价格估算'
    )
    assert.equal(await page.getByRole('button', { name: '开始对话 · OpenCode' }).count(), 0)
    assert.equal(await page.getByText(/未计入当前日期范围/).isVisible(), true)
    assert.equal(await page.locator('.agent-usage-ledger tbody tr').count(), 50)
    assert.equal(await page.getByText(/费用估算|价格配置/).count(), 0)
    assert.equal(await page.locator('.agent-usage-chart-column').count(), 3)
    assert.equal(await page.locator('.agent-usage-rank-row').count(), 2)
  })
  await check('趋势范围、排行筛选与明细排序可操作', async () => {
    const range = page.getByRole('button', { name: '7 天', exact: true })
    await range.click()
    assert.equal(await range.getAttribute('aria-pressed'), 'true')
    const total = page.getByRole('button', { name: '总 Token', exact: true })
    await total.click()
    assert.equal(
      await page.locator('.agent-usage-ledger th', { hasText: '总 Token' }).getAttribute('aria-sort'),
      'descending'
    )
    await idle()
    await total.click()
    await idle()
    assert.equal(
      await page.locator('.agent-usage-ledger th', { hasText: '总 Token' }).getAttribute('aria-sort'),
      'ascending'
    )
  })
  await check('会话详情抽屉可用键盘关闭', async () => {
    await page.locator('.agent-usage-row-open').first().click()
    const sheet = page.getByRole('dialog', { name: '会话用量详情' })
    await sheet.waitFor()
    assert.ok((await sheet.innerText()).includes('未缓存输入'))
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'hidden' })
  })
  await check('分页、Agent 和模型筛选可操作且无旧结果覆盖', async () => {
    await page.getByRole('button', { name: '下一页' }).click()
    await page.waitForFunction(
      () => document.querySelectorAll('.agent-usage-ledger tbody tr').length === 14
    )
    await select('统计 Agent', 'ZCode')
    await page.waitForFunction(
      () => document.querySelectorAll('.agent-usage-ledger tbody tr').length === 8
    )
    assert.ok((await page.locator('.agent-usage-ledger tbody').innerText()).includes('ZCode'))
    await select('统计模型', 'empty-model')
    await page.getByText('当前范围没有可用记录。', { exact: false }).waitFor()
    await select('统计模型', '全部模型')
    await page.locator('.agent-usage-ledger tbody tr').first().waitFor()
  })
  await check('来源路径选择与恢复自动，未发现的来源收进折叠区', async () => {
    await page.getByRole('button', { name: '数据来源', exact: true }).click()
    assert.equal(await page.locator('.agent-usage-source:visible').count(), 8)
    await page.locator('.agent-usage-hidden-sources summary').click()
    assert.equal(await page.locator('.agent-usage-source:visible').count(), 14)
    const source = page.locator('.agent-usage-source').filter({ hasText: 'Kimi Code' })
    const calls = await page.evaluate(() => window.uiVerification.usageCalls().length)
    await source.getByRole('button', { name: '重扫', exact: true }).click()
    await page.waitForFunction((count) => window.uiVerification.usageCalls().length > count, calls)
    await page.waitForFunction(() => !document.body.innerText.includes('扫描中…'))
    assert.equal(
      await page.evaluate(() =>
        window.uiVerification
          .usageCalls()
          .some((call) => call.client === 'kimi' && call.refresh === true)
      ),
      true
    )
    await source.getByRole('button', { name: '选择路径' }).click()
    await source.getByRole('button', { name: '恢复自动' }).waitFor()
    await source.getByRole('button', { name: '恢复自动' }).click()
    await source.getByRole('button', { name: '恢复自动' }).waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '数据来源', exact: true }).click()
  })
  await check('刷新失败保留旧记录并可恢复，重复点击不并发请求', async () => {
    await page.evaluate(() => {
      window.uiVerification.usageFailNext()
      window.uiVerification.usageDelay(200)
    })
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '刷新', exact: true }).isDisabled(), true)
    await page.getByRole('alert').filter({ hasText: '读取失败' }).waitFor()
    assert.equal(await page.locator('.agent-usage-ledger tbody tr').count(), 8)
    await page.evaluate(() => window.uiVerification.usageDelay(0))
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await page.getByRole('alert').waitFor({ state: 'hidden' })
  })
  await check('趋势图与明细表在页面内完整渲染', async () => {
    await page.locator('.agent-usage-trend').scrollIntoViewIfNeeded()
    await capture('agent-usage-chart')
    await page.locator('.agent-usage-ledger').scrollIntoViewIfNeeded()
    await capture('agent-usage-ledger')
    const wrap = await page
      .locator('.agent-usage-table-wrap')
      .evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }))
    assert.ok(wrap.scroll >= wrap.client, '明细表应内部滚动而不是撑破页面')
    await page.evaluate(() => {
      document.querySelector('.agent-usage-page')?.scrollTo(0, 0)
      document.querySelector('.viewport')?.scrollTo(0, 0)
    })
  })
  for (const [theme, label] of [
    ['starry', '星轨深空'],
    ['graphite', '静夜石墨'],
    ['paper', '晨光纸白']
  ]) {
    await check(`${label}：双尺寸布局、日期与菜单边界`, async () => {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('button', { name: label, exact: true }).click()
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
      await open()
      await page.locator('.agent-usage-ledger tbody tr').first().waitFor()
      await select('统计时间', '自定义日期')
      assert.equal(await page.locator('.date-picker input').count(), 2)
      for (const [width, height] of [
        [1280, 820],
        [1024, 680]
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
          [width, height]
        )
        await page.getByRole('button', { name: '统计 Agent', exact: true }).click()
        const bounds = await page.getByRole('listbox', { name: '统计 Agent' }).boundingBox()
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
        await page.keyboard.press('Escape')
        const result = await page
          .locator('.viewport')
          .evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }))
        assert.ok(result.scroll <= result.width, '页面横向溢出')
        const button = await page
          .getByRole('button', { name: '刷新', exact: true })
          .evaluate((element) => {
            const r = element.getBoundingClientRect()
            return (
              r.x >= 0 &&
              r.y >= 0 &&
              r.right <= innerWidth &&
              r.bottom <= innerHeight &&
              element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
            )
          })
        assert.equal(button, true)
        await capture(`agent-usage-${theme}-${width}`)
      }
    })
  }
}
