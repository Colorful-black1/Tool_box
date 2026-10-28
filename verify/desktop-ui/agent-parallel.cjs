/* global window:readonly, document:readonly */
const assert = require('node:assert/strict')

/** 合成桥接的多项目任务，不连接外部 Agent 或发送模型请求。 */
module.exports = async function verifyParallelAgents({ page, app, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const draft = () => page.getByRole('textbox', { name: '编程任务草稿', exact: true })
  const project = async (directory) => {
    await page.evaluate((value) => window.uiVerification.agentDirectory(value), directory)
    const choose = button('切换项目')
    await ((await choose.count()) ? choose : button('选择项目')).click()
  }
  await button('编程 Agent').click()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
  )
  await check('两个 Agent 分别保存项目和未发送草稿', async () => {
    await project('E:\\项目A')
    await draft().fill('项目 A 待发送')
    await button('Codex').click()
    await project('E:\\项目B')
    await draft().fill('项目 B 待发送')
    await button('OpenCode').click()
    assert.equal(await draft().inputValue(), '项目 A 待发送')
    await page.locator('.opencode-identity p').filter({ hasText: 'E:\\项目A' }).waitFor()
    await button('Codex').click()
    assert.equal(await draft().inputValue(), '项目 B 待发送')
    await page.locator('.opencode-identity p').filter({ hasText: 'E:\\项目B' }).waitFor()
  })
  await check('A 运行期间 B 可发送；两个回复各回原会话', async () => {
    await button('OpenCode').click()
    await draft().press('Enter')
    await button('停止任务').waitFor()
    await button('Codex').click()
    await draft().press('Enter')
    await page.getByRole('heading', { name: 'Codex 新会话', exact: true }).waitFor()
    await page.evaluate(() => {
      window.uiVerification.agentDelta('A 项目回复', 'opencode')
      window.uiVerification.agentDelta('B 项目回复', 'codex')
    })
    await page.getByText('B 项目回复', { exact: true }).waitFor()
    assert.equal(await page.getByText('A 项目回复', { exact: true }).count(), 0)
    const calls = await page.evaluate(() => window.uiVerification.agentCalls())
    assert.deepEqual(
      calls.filter((item) => item.action === 'send').map((item) => item.id),
      ['opencode', 'codex']
    )
    await button('OpenCode').click()
    await page.getByText('A 项目回复', { exact: true }).waitFor()
  })
  for (const [theme, label] of [
    ['starry', '星轨深空'],
    ['graphite', '静夜石墨'],
    ['paper', '晨光纸白']
  ]) {
    await check(`后台任务 ${theme} 主题布局`, async () => {
      await button('设置').click()
      await page.waitForFunction(
        () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
      )
      await button(label).click()
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
      await button('编程 Agent').click()
      const background = page.getByLabel('后台 Agent 任务', { exact: true })
      await background.getByText(/Codex/).waitFor()
      const box = await background.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= 1281 && box.y + box.height < 820)
      await capture(`agent-parallel-${theme}-1280`)
    })
  }
  await check('从 A 停止后台 B，仅 B 结算，A 继续运行', async () => {
    const background = page.getByLabel('后台 Agent 任务', { exact: true })
    await background.getByRole('button', { name: '停止任务', exact: true }).click()
    await background.waitFor({ state: 'hidden' })
    await button('停止任务').waitFor()
    const calls = await page.evaluate(() => window.uiVerification.agentCalls())
    assert.equal(calls.filter((item) => item.action === 'stop').at(-1).id, 'codex')
    await page.evaluate(() => window.uiVerification.agentFinish('opencode'))
    await button('发送给 OpenCode').waitFor()
    await button('Codex').click()
    await page.getByText('B 项目回复', { exact: true }).waitFor()
    await button('发送给 Codex').waitFor()
  })
}
