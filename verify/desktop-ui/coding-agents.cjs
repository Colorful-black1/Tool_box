const { withDialog } = require('./dialog.cjs')
/* global window:readonly, document:readonly, innerWidth:readonly */
const assert = require('node:assert/strict')

module.exports = async function verifyCodingAgents({ page, app, check, capture }) {
  const draft = () => page.getByRole('textbox', { name: '编程任务草稿', exact: true })
  const agent = (name) => page.getByRole('button', { name, exact: true }).click()
  const calls = () => page.evaluate(() => window.uiVerification.agentCalls())
  const count = async (action) => (await calls()).filter((item) => item.action === action).length
  await agent('编程 Agent')
  await check('主流程只有已接入 Agent，进入页面不连接、建会话或发送', async () => {
    assert.equal(
      await page.getByRole('group', { name: '选择编程 Agent' }).getByRole('button').count(),
      5
    )
    assert.equal(await page.getByRole('button', { name: '交接给其他 Agent' }).count(), 0)
    assert.equal(await page.getByRole('textbox', { name: 'OpenCode 程序路径' }).count(), 0)
    assert.deepEqual(await calls(), [])
  })
  await check('首次发送一次完成连接、新建和发送，无需打开设置', async () => {
    await agent('选择项目')
    await draft().fill('检查当前项目')
    await agent('开始对话 · OpenCode')
    await page.getByRole('button', { name: '停止任务', exact: true }).waitFor()
    assert.equal(await count('connect'), 1)
    assert.equal(await count('create'), 1)
    assert.equal(await count('send'), 1)
    await page.evaluate(() => {
      window.uiVerification.agentDelta('第一次合成回复')
      window.uiVerification.agentFinish()
    })
    await page.getByRole('button', { name: '发送给 OpenCode', exact: true }).waitFor()
  })
  await check('新对话延迟创建，列表直接恢复历史并按原生身份去重', async () => {
    await agent('新对话')
    assert.equal(await count('create'), 1)
    await agent('历史会话')
    await page
      .locator('.opencode-session-item')
      .filter({ hasText: 'OpenCode 原生历史标题' })
      .click()
    await page.getByRole('heading', { name: 'OpenCode 原生历史标题', exact: true }).waitFor()
    assert.equal(await count('resume'), 1)
    assert.equal(
      await page
        .locator('.opencode-session-item')
        .filter({ hasText: 'OpenCode 原生历史标题' })
        .count(),
      1
    )
    await draft().fill('来源未发草稿')
  })
  await check('明确回复两步转用，目标未连接也不要求准备会话或填写表单', async () => {
    const before = await calls()
    await page.getByRole('button', { name: '用于 Codex', exact: true }).click()
    assert.deepEqual(await calls(), before)
    assert.ok((await draft().inputValue()).includes('已完成实现'))
    assert.equal(
      await page.getByRole('button', { name: '开始对话 · Codex', exact: true }).isEnabled(),
      true
    )
    assert.equal(await page.getByRole('dialog').count(), 0)
    await agent('OpenCode')
    assert.equal(await draft().inputValue(), '来源未发草稿')
    await agent('Codex')
    await draft().fill('目标新对话原稿')
    await agent('OpenCode')
    await withDialog(page, false, async () => {
      await agent('用于 Codex')
    })
    await agent('Codex')
    assert.equal(await draft().inputValue(), '目标新对话原稿')
    await agent('OpenCode')
    await withDialog(page, true, async () => {
      await agent('用于 Codex')
    })
    await capture('coding-agents-transfer')
  })
  await check('切换沿用项目，目标首次发送与真实流式事件分开处理', async () => {
    await agent('开始对话 · Codex')
    await page.getByRole('button', { name: '停止任务', exact: true }).waitFor()
    assert.equal(await count('connect'), 2)
    assert.equal(await count('create'), 2)
    await page.evaluate(() => window.uiVerification.agentDelta('Codex 流式第一段'))
    await page.getByText('Codex 流式第一段', { exact: true }).waitFor()
    await page.getByText('执行详情 · 0 项工具 / 1 项子任务', { exact: true }).click()
    await page.getByText('检查器', { exact: false }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: '用于 OpenCode', exact: true }).isDisabled(),
      true
    )
  })
  await check('后台任务可定位和停止，停止命中原任务且不抢占当前 Agent', async () => {
    await agent('OpenCode')
    await agent('查看运行任务')
    await page.getByRole('heading', { name: 'Codex 新会话', exact: true }).waitFor()
    await agent('OpenCode')
    await agent('停止任务')
    await page.getByRole('button', { name: '发送给 OpenCode', exact: true }).waitFor()
    const stopped = (await calls()).findLast((item) => item.action === 'stop')
    assert.equal(stopped.id, 'codex')
    assert.ok(stopped.sessionId.startsWith('codex-ref-'))
    assert.equal(await draft().inputValue(), '来源未发草稿')
  })
  await check('历史刷新失败保留列表、选择和草稿，不补建会话', async () => {
    const created = await count('create')
    await agent('历史会话')
    await page.evaluate(() => window.uiVerification.agentFailHistory())
    await agent('刷新历史会话')
    await page.getByRole('alert').filter({ hasText: '合成历史读取失败' }).waitFor()
    assert.equal(await count('create'), created)
    assert.equal(await draft().inputValue(), '来源未发草稿')
    await agent('关闭提示')
  })
  await check('交接说明只请求来源 Agent，不替换用户输入', async () => {
    const sent = await count('send')
    await page.locator('.opencode-more > summary').click()
    await agent('生成交接说明')
    await page.getByRole('button', { name: '停止任务', exact: true }).waitFor()
    const last = (await calls()).findLast((item) => item.action === 'send')
    assert.equal(last.id, 'opencode')
    assert.ok(last.content.includes('交接说明'))
    assert.equal(await count('send'), sent + 1)
    assert.equal(await draft().inputValue(), '来源未发草稿')
    await page.evaluate(() => {
      window.uiVerification.agentDelta('交接说明：已完成实现，待核对当前代码和验证。')
      window.uiVerification.agentFinish()
    })
    await page.getByRole('button', { name: '用于 Codex', exact: true }).last().click()
    const transferred = await draft().inputValue()
    await agent('工具')
    await agent('编程 Agent')
    assert.equal(await draft().inputValue(), transferred)
  })
  for (const [theme, label] of [
    ['starry', '星轨深空'],
    ['graphite', '静夜石墨'],
    ['paper', '晨光纸白']
  ]) {
    await check(`精简工作台 ${theme} 主题与双尺寸布局、菜单 Esc`, async () => {
      await agent('设置')
      await page.waitForFunction(
        () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
      )
      await agent(label)
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
      await agent('编程 Agent')
      for (const [width, height] of [
        [1280, 820],
        [1024, 680]
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
          [width, height]
        )
        await page.waitForFunction((value) => innerWidth === value, width)
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false
        )
        const input = await draft().boundingBox()
        assert.ok(input.height >= 48 && input.y + input.height < height)
        await page.locator('.opencode-more > summary').click()
        const box = await page.locator('.opencode-more-menu').boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= height)
        await page.keyboard.press('Escape')
        assert.equal(await page.locator('.opencode-more-menu').isVisible(), false)
        await page.locator('.opencode-transfer-target > summary').click()
        await page.getByRole('button', { name: '改用已有会话', exact: true }).click()
        const targetMenu = page.getByRole('listbox', { name: '改用已有会话', exact: true })
        const targetBox = await targetMenu.boundingBox()
        assert.ok(targetBox.y >= 0 && targetBox.y + targetBox.height <= height)
        const send = page.getByRole('button', { name: '开始对话 · Codex', exact: true })
        assert.equal(
          await send.evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            const panel = element.closest('.opencode-panel').getBoundingClientRect()
            return (
              bounds.bottom <= panel.bottom &&
              bounds.bottom <= window.innerHeight &&
              element.contains(
                document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
              )
            )
          }),
          true
        )
        assert.equal(
          await targetMenu
            .locator('.ui-dropdown-item')
            .first()
            .evaluate((element) => {
              const bounds = element.getBoundingClientRect()
              return element.contains(
                document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
              )
            }),
          true
        )
        await capture(`coding-agents-target-${theme}-${width}`)
        await page.keyboard.press('Escape')
        await page.locator('.opencode-transfer-target > summary').click()
        await capture(`coding-agents-${theme}-${width}`)
      }
    })
  }
  await check('重新加载恢复已保存草稿但不连接或自动重发，不出现旧交接界面', async () => {
    const expected = await draft().inputValue()
    assert.equal(await page.evaluate(() => window.uiVerification.flushDrafts()), true)
    await page.reload()
    await agent('编程 Agent')
    await page.waitForFunction(
      (text) => document.querySelector('#opencode-draft')?.value === text,
      expected
    )
    assert.equal(await draft().inputValue(), expected)
    assert.deepEqual(await calls(), [])
    assert.equal(await page.getByRole('button', { name: '交接给其他 Agent' }).count(), 0)
  })
  await check('Claude 两入口草稿独立，Desktop 明示来源并只发送到所选入口', async () => {
    await agent('Claude Code')
    await draft().fill('Code 保留草稿')
    await agent('Claude Desktop')
    assert.equal(await draft().inputValue(), '')
    await page.getByText('沿用 Desktop 的第三方供应商配置', { exact: false }).waitFor()
    await draft().fill('Desktop 合成任务')
    await agent('开始对话 · Claude Desktop')
    await page.getByRole('button', { name: '停止任务', exact: true }).waitFor()
    assert.equal((await calls()).findLast((item) => item.action === 'send').id, 'claude-desktop')
    await page.evaluate(() => {
      window.uiVerification.agentDelta('Desktop 入口合成回复')
      window.uiVerification.agentFinish()
    })
    await page.getByRole('button', { name: '发送给 Claude Desktop', exact: true }).waitFor()
    await agent('Claude Code')
    assert.equal(await draft().inputValue(), 'Code 保留草稿')
    await agent('Claude Desktop')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
    )
    await page.waitForFunction(() => innerWidth === 1280)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    )
    await capture('claude-desktop-paper-1280')
  })
}
