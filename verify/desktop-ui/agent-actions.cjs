/* global window:readonly, document:readonly, innerWidth:readonly, innerHeight:readonly */
const assert = require('node:assert/strict')
const { withDialog } = require('./dialog.cjs')

/** 合成桥接验收输入、候选、发送引用和降级，不连接真实 Agent。 */
module.exports = async function verifyAgentActions({ page, app, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const draft = () => page.getByRole('textbox', { name: '编程任务草稿', exact: true })
  const calls = () => page.evaluate(() => window.uiVerification.agentCalls())
  await button('编程 Agent').click()
  await button('选择项目').click()
  await check('文件候选 Enter 仅插入引用，Esc 先关菜单；引用随首次发送提交', async () => {
    await draft().fill('查看 @src')
    await page.getByRole('option', { name: /src\/中文 file.ts/ }).waitFor()
    await draft().press('Enter')
    assert.equal((await calls()).filter((item) => item.action === 'send').length, 0)
    assert.ok((await draft().inputValue()).includes('src/中文 file.ts'))
    await button('/ 命令').click()
    await page.getByRole('listbox', { name: '快捷命令' }).waitFor()
    await page.getByRole('combobox', { name: '快捷命令搜索' }).press('Escape')
    assert.equal(await page.getByRole('listbox', { name: '快捷命令' }).count(), 0)
    assert.equal(await page.locator('.opencode-page').isVisible(), true)
    await draft().press('Shift+Enter')
    assert.ok((await draft().inputValue()).includes('\n'))
    await draft().press('Enter')
    await button('停止任务').waitFor()
    assert.equal((await calls()).at(-1).references[0].id, 'fixture-file')
    await page.evaluate(() => window.uiVerification.agentFinish())
    await button('发送给 OpenCode').waitFor()
  })
  await check('斜杠命令候选和面板可搜索，选择不自动执行；弹层不溢出', async () => {
    await draft().fill('/comp')
    await page.getByRole('option', { name: /compact/ }).waitFor()
    const box = await page.locator('.agent-actions-popover').boundingBox()
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert.ok(
      box &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= size.width + 1 &&
        box.y + box.height <= size.height + 1
    )
    const before = (await calls()).filter((item) => item.action === 'send').length
    await draft().press('Enter')
    assert.equal((await calls()).filter((item) => item.action === 'send').length, before)
    assert.ok((await draft().inputValue()).startsWith('/compact'))
    await draft().press('Enter')
    await button('停止任务').waitFor()
    await page.evaluate(() => window.uiVerification.agentFinish())
    await button('发送给 OpenCode').waitFor()
  })
  await check('Codex Skill 选中后带引用发送；MCP 只准备使用意图', async () => {
    await button('Codex').click()
    await draft().fill('/skills')
    await draft().press('Enter')
    await page.getByRole('option', { name: /fixture-verify/ }).click()
    assert.ok((await draft().inputValue()).includes('$fixture-verify'))
    await button('开始对话 · Codex').click()
    await button('停止任务').waitFor()
    assert.equal((await calls()).at(-1).references[0].kind, 'skill')
    await page.evaluate(() => window.uiVerification.agentFinish())
    await button('发送给 Codex').waitFor()
    await draft().fill('/mcp')
    await draft().press('Enter')
    await page.getByRole('option', { name: /fixture-mcp.*search_docs/ }).click()
    assert.ok((await draft().inputValue()).includes('[MCP:search_docs]'))
    await capture('agent-actions-codex-references')
  })
  await check('未知命令保留草稿，只有明确选择后才作为文字发送', async () => {
    await draft().fill('/not-a-command 参数')
    await draft().press('Enter')
    await page
      .getByText('未识别为可用命令；可明确选择“作为普通文字发送”', { exact: true })
      .waitFor()
    assert.equal(await draft().inputValue(), '/not-a-command 参数')
    await button('作为普通文字发送').click()
    await button('停止任务').waitFor()
    assert.equal((await calls()).at(-1).literal, true)
    await page.evaluate(() => window.uiVerification.agentFinish())
    await button('发送给 Codex').waitFor()
  })
  await check('DSH 不显示虚假的压缩 / Skill 能力', async () => {
    await button('DeepSeek Harness').click()
    await button('/ 命令').click()
    await page.getByText('官方 DSH ACP 未提供命令与 MCP 状态查询', { exact: true }).waitFor()
    assert.equal(await page.getByRole('option', { name: /compact/ }).count(), 0)
    await capture('agent-actions-dsh-limits')
  })
  await page.keyboard.press('Escape')
  await check('Claude 扩展首次开启需确认，不切入口路由，也不发送任务', async () => {
    await button('Claude Code').click()
    await button('/ 命令').click()
    await page.getByRole('option', { name: /compact/ }).waitFor()
    await page.keyboard.press('Escape')
    await button('连接设置').click()
    const toggle = button('本机扩展配置：已关闭')
    await toggle.waitFor()
    const before = (await calls()).filter((item) => item.action === 'send').length
    await withDialog(page, true, () => toggle.click())
    await button('本机扩展配置：已开启').waitFor()
    assert.equal((await calls()).filter((item) => item.action === 'send').length, before)
    await button('本机扩展配置：已开启').click()
    await button('本机扩展配置：已关闭').waitFor()
    await button('连接设置').click()
  })
  for (const [theme, label] of [
    ['starry', '星轨深空'],
    ['graphite', '静夜石墨'],
    ['paper', '晨光纸白']
  ]) {
    await check(`命令候选 ${theme} 主题与 1280×820 布局`, async () => {
      await button('设置').click()
      await page.waitForFunction(
        () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
      )
      await button(label).click()
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
      await button('编程 Agent').click()
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
      )
      await button('/ 命令').click()
      await page.getByRole('option', { name: /compact/ }).waitFor()
      const box = await page.locator('.agent-actions-popover').boundingBox()
      const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      assert.ok(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= size.width + 1 &&
          box.y + box.height <= size.height + 1
      )
      await capture(`agent-actions-${theme}-1280`)
      await page.keyboard.press('Escape')
    })
  }
}
