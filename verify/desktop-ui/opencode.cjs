/* global window:readonly, document:readonly */
const assert = require('node:assert/strict')

/** 保留旧 OpenCode 桥接的回归验收，交互与新的统一工作台一致。 */
module.exports = async function verifyOpenCode({ page, app, check, capture }) {
  const draft = () => page.getByRole('textbox', { name: '编程任务草稿', exact: true })
  const click = (name) => page.getByRole('button', { name, exact: true }).click()
  const more = async (name) => {
    await page.locator('.opencode-more > summary').click()
    await click(name)
  }
  const initialChatCount = await page.evaluate(() => window.uiVerification.chatSendCount())
  await check('未选择项目不能开始任务，正常入口不展开程序路径', async () => {
    await click('编程 Agent')
    await draft().fill('首次任务')
    assert.equal(
      await page.getByRole('button', { name: '开始对话 · OpenCode', exact: true }).isDisabled(),
      true
    )
    assert.equal(await page.getByRole('textbox', { name: 'OpenCode 程序路径' }).count(), 0)
    await click('选择项目')
    await capture('opencode-select-project')
  })
  await check('程序缺失可在设置中重新检测，保留项目和输入', async () => {
    await click('连接设置')
    await page.evaluate(() => window.uiVerification.codeSetDetectedExecutable(null))
    await click('重新检测')
    assert.equal(
      await page.getByRole('button', { name: '开始对话 · OpenCode', exact: true }).isDisabled(),
      true
    )
    assert.equal(await draft().inputValue(), '首次任务')
    await page.evaluate(() =>
      window.uiVerification.codeSetDetectedExecutable('C:\\合成程序\\resources\\opencode-cli.exe')
    )
    await click('重新检测')
    await click('连接设置')
  })
  await check('首次发送自动连接与创建，默认 Plan，失败保留草稿并复用会话', async () => {
    await page.evaluate(() => window.uiVerification.codeFailNextSend())
    await click('开始对话 · OpenCode')
    await page.getByRole('alert').filter({ hasText: '合成发送失败' }).waitFor()
    assert.equal(await page.evaluate(() => window.uiVerification.codeCreateCount()), 1)
    assert.equal(await page.evaluate(() => window.uiVerification.codeLoadCount()), 0)
    assert.equal(await draft().inputValue(), '首次任务')
    assert.equal(
      await page.getByRole('button', { name: 'OpenCode 工作模式', exact: true }).textContent(),
      'Plan▾'
    )
    await click('发送给 OpenCode')
    await page.getByRole('button', { name: '停止任务', exact: true }).waitFor()
    await page.evaluate(() => window.uiVerification.codeComplete())
    await page.getByText('合成回答', { exact: true }).waitFor()
    assert.equal(await page.locator('.opencode-messages pre code').count(), 1)
    assert.equal(await page.evaluate(() => window.uiVerification.codeCreateCount()), 1)
    await capture('opencode-connected')
  })
  await check('模型只显示可见项，同步不改变用户草稿或静默切换模型', async () => {
    const dropdown = page.getByRole('button', { name: 'OpenCode 模型', exact: true })
    await dropdown.click()
    assert.equal(await page.getByRole('option').count(), 2)
    await page.keyboard.press('Escape')
    await draft().fill('同步时保留草稿')
    await page.evaluate(() => window.uiVerification.codeSetVisibleModels(['fixture/model-two']))
    await more('同步模型')
    await page
      .getByText('当前模型不可用，请选择已启用模型，或在更多菜单同步模型。', { exact: true })
      .waitFor()
    assert.equal(
      await page.getByRole('button', { name: '发送给 OpenCode', exact: true }).isDisabled(),
      true
    )
    assert.equal(await draft().inputValue(), '同步时保留草稿')
    await dropdown.click()
    assert.equal(await page.getByRole('option').count(), 1)
    await clickOption('合成模型二')
    await page.evaluate(() =>
      window.uiVerification.codeSetVisibleModels(['fixture/model-one', 'fixture/model-two'])
    )
    await more('同步模型')
    await draft().fill('')
  })
  async function clickOption(name) {
    await page.getByRole('option', { name, exact: true }).click()
  }
  await check('Prompt 和工具结果仍只填编程草稿，拒绝覆盖保留原稿', async () => {
    const before = await page.evaluate(() => window.uiVerification.codeSendCount())
    await click('工具')
    await click('Prompt 模板库')
    await page
      .getByRole('textbox', { name: '变量 context', exact: true })
      .fill('合成 Java 异常上下文')
    const output = await page
      .getByRole('textbox', { name: '生成的 Prompt', exact: true })
      .inputValue()
    await click('用于编程 Agent')
    assert.equal(await draft().inputValue(), output)
    await draft().fill('保留编程草稿')
    await click('工具')
    await click('JSON 工具箱')
    await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).fill('{"synthetic":true}')
    page.once('dialog', (dialog) => dialog.dismiss())
    await click('用于编程 Agent')
    await click('编程 Agent')
    assert.equal(await draft().inputValue(), '保留编程草稿')
    assert.equal(await page.evaluate(() => window.uiVerification.codeSendCount()), before)
  })
  await check('审批保持即时可见，拒绝和停止可用', async () => {
    await click('OpenCode 工作模式')
    await clickOption('Build')
    await click('发送给 OpenCode')
    await page.evaluate(() => window.uiVerification.codePermission())
    await page.getByRole('region', { name: 'OpenCode 操作审批', exact: true }).waitFor()
    await capture('opencode-approval')
    await click('拒绝操作')
    assert.equal(
      await page.getByRole('region', { name: 'OpenCode 操作审批', exact: true }).count(),
      0
    )
    await click('停止任务')
    await page.getByRole('button', { name: '发送给 OpenCode', exact: true }).waitFor()
  })
  await check('新对话不创建原生记录，历史列表直接恢复且不混入普通助手', async () => {
    const created = await page.evaluate(() => window.uiVerification.codeCreateCount())
    await click('新对话')
    assert.equal(await page.evaluate(() => window.uiVerification.codeCreateCount()), created)
    await click('历史会话')
    await page.locator('.opencode-session-item').filter({ hasText: '合成历史会话' }).click()
    await page.getByText('合成历史正文', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.uiVerification.chatSendCount()), initialChatCount)
  })
  await check('断开后读取历史只连接和列出，不自动恢复或新建', async () => {
    const created = await page.evaluate(() => window.uiVerification.codeCreateCount())
    const loaded = await page.evaluate(() => window.uiVerification.codeLoadCount())
    await click('连接设置')
    await click('断开连接')
    await click('连接设置')
    await click('刷新历史会话')
    assert.equal(await page.evaluate(() => window.uiVerification.codeCreateCount()), created)
    assert.equal(await page.evaluate(() => window.uiVerification.codeLoadCount()), loaded)
    await page.locator('.opencode-session-item').filter({ hasText: '合成历史会话' }).click()
    await page.getByText('合成历史正文', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.uiVerification.codeLoadCount()), loaded + 1)
  })
  for (const [name, id] of [
    ['星轨深空', 'starry'],
    ['静夜石墨', 'graphite'],
    ['晨光纸白', 'paper']
  ]) {
    await check(`${name} 主题与模型菜单不溢出`, async () => {
      await click('设置')
      await click(name)
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, id)
      await click('编程 Agent')
      await click('OpenCode 模型')
      assert.equal(
        await page.locator('.ui-dropdown-menu').evaluate((element) => {
          const box = element.getBoundingClientRect()
          return (
            box.left >= 0 &&
            box.right <= window.innerWidth &&
            box.top >= 0 &&
            box.bottom <= window.innerHeight
          )
        }),
        true
      )
      await page.keyboard.press('Escape')
      await capture(`opencode-${id}`)
    })
  }
  await check('1024×680 下输入和主要动作可见', async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 680)
    )
    assert.equal(
      await page
        .locator('.viewport')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
      false
    )
    const box = await draft().boundingBox()
    assert.ok(box.height >= 48 && box.y + box.height < 680)
    await capture('opencode-narrow')
  })
}
