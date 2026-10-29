/* global window:readonly, document:readonly */
const assert = require('node:assert/strict')
const { withDialog } = require('./dialog.cjs')

/** 项目选择与交接的合成验收，不启动任何原生 Agent 或模型。 */
module.exports = async function verifyAgentProjects({ page, app, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const draft = () => page.getByRole('textbox', { name: '编程任务草稿', exact: true })
  const calls = () => page.evaluate(() => window.uiVerification.agentCalls())
  const work = () => page.locator('.opencode-identity p')
  const notice = () => page.getByLabel('跨项目转用提示', { exact: true })
  const sourceDirectory = 'E:\\Codeing\\ai-workspace\\跨项目交接验收\\项目A'
  const previousDirectory = `E:\\Codeing\\ai-workspace\\${'unbroken-long-folder-'.repeat(8)}项目B`
  const project = async (directory) => {
    await page.evaluate((value) => window.uiVerification.agentDirectory(value), directory)
    const change = button('切换项目')
    await ((await change.count()) ? change : button('选择项目')).click()
    await work().filter({ hasText: directory }).waitFor()
  }
  await button('编程 Agent').click()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
  )
  await project(sourceDirectory)
  await draft().fill('为项目 A 准备交接')
  await draft().press('Enter')
  await button('停止任务').waitFor()
  await page.evaluate(() => {
    window.uiVerification.agentDelta('交接内容：已完成项目 A 的结构检查。', 'opencode')
    window.uiVerification.agentFinish('opencode')
  })
  await button('用于 Codex').waitFor()
  await button('Codex').click()
  await project(previousDirectory)
  await button('连接设置').click()
  await button('连接 Codex').click()
  await page.getByRole('status').filter({ hasText: '已连接' }).waitFor()
  await button('连接设置').click()
  await draft().fill('项目 B 原草稿')
  await button('OpenCode').click()
  await check('跨项目取消不切标签、不改目标草稿、不替换连接', async () => {
    const before = (await calls()).filter((item) => item.action === 'connect').length
    await withDialog(page, false, () => button('用于 Codex').click())
    assert.equal(await button('OpenCode').getAttribute('aria-pressed'), 'true')
    await button('Codex').click()
    assert.equal(await draft().inputValue(), '项目 B 原草稿')
    await work().filter({ hasText: previousDirectory }).waitFor()
    assert.equal((await calls()).filter((item) => item.action === 'connect').length, before)
    await button('OpenCode').click()
  })
  await check('跨项目确认仅填草稿，提示来源与原项目且连接尚未断开', async () => {
    const before = (await calls()).filter((item) => item.action === 'connect').length
    await withDialog(page, true, () => button('用于 Codex').click())
    await notice().waitFor()
    const text = await notice().innerText()
    assert.ok(text.includes('OpenCode') && text.includes('项目A') && text.includes('项目B'))
    assert.ok(text.includes('将在发送时断开'))
    assert.ok((await draft().inputValue()).includes('交接内容'))
    assert.equal((await calls()).filter((item) => item.action === 'connect').length, before)
  })
  for (const [theme, label] of [
    ['starry', '星轨深空'],
    ['graphite', '静夜石墨'],
    ['paper', '晨光纸白']
  ]) {
    await check(`项目转用提示 ${theme} 主题布局`, async () => {
      await button('设置').click()
      await page.waitForFunction(
        () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
      )
      await button(label).click()
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
      await button('编程 Agent').click()
      await notice().waitFor()
      const bounds = await notice().boundingBox()
      assert.ok(
        bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1281 && bounds.y + bounds.height < 820
      )
      assert.equal(
        await notice().evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
        true
      )
      await capture(`agent-projects-${theme}-1280`)
    })
  }
  await check('返回原项目恢复原草稿，不连接、不恢复会话、不发送', async () => {
    const before = (await calls()).filter((item) =>
      ['connect', 'create', 'resume', 'send'].includes(item.action)
    ).length
    await button('返回原项目').click()
    await notice().waitFor({ state: 'hidden' })
    await work().filter({ hasText: previousDirectory }).waitFor()
    assert.equal(await draft().inputValue(), '项目 B 原草稿')
    assert.equal(
      (await calls()).filter((item) =>
        ['connect', 'create', 'resume', 'send'].includes(item.action)
      ).length,
      before
    )
  })
  await check('明确发送才切连接，停止后仍可返回原项目', async () => {
    await button('OpenCode').click()
    // 上次转用草稿仍按项目 A 保存；再次转用同内容不需要额外覆盖确认。
    await withDialog(page, true, () => button('用于 Codex').click())
    await draft().press('Enter')
    await button('停止任务').waitFor()
    await notice().filter({ hasText: '已断开' }).waitFor()
    assert.equal(await button('返回原项目').isDisabled(), true)
    await button('停止任务').click()
    await button('返回原项目').click()
    await work().filter({ hasText: previousDirectory }).waitFor()
    assert.equal(await draft().inputValue(), '项目 B 原草稿')
  })
}
