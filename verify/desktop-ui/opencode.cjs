/* global window:readonly, document:readonly */
const assert = require('node:assert/strict')

module.exports = async function verifyOpenCode({ page, app, check, capture }) {
  const initialChatCount = await page.evaluate(() => window.uiVerification.chatSendCount())
  await check('OpenCode 未选择项目时说明连接按钮禁用原因', async () => {
    await page.getByRole('button', { name: '编程 Agent', exact: true }).click()
    await page.getByRole('textbox', { name: 'OpenCode 程序路径', exact: true }).waitFor()
    await page
      .getByText('已检测到 OpenCode 程序，请先点击「选择项目」，再连接。', { exact: true })
      .waitFor()
    assert.equal(
      await page.getByRole('button', { name: '连接 OpenCode', exact: true }).isDisabled(),
      true
    )
    assert.equal(await page.evaluate(() => window.uiVerification.codeSendCount()), 0)
    await capture('opencode-select-project')
  })
  await check('OpenCode 未检测到程序时可重新检测，保留已选项目且不自动发送', async () => {
    await page.getByRole('button', { name: '选择项目', exact: true }).click()
    const directory = await page
      .getByRole('textbox', { name: '编程项目目录', exact: true })
      .inputValue()
    await page.evaluate(() => window.uiVerification.codeSetDetectedExecutable(null))
    await page.getByRole('button', { name: '重新检测', exact: true }).click()
    await page
      .getByText('未检测到 OpenCode 内置程序，请点击「重新检测」或「选择程序」。', { exact: true })
      .waitFor()
    assert.equal(
      await page.getByRole('button', { name: '连接 OpenCode', exact: true }).isDisabled(),
      true
    )
    await capture('opencode-missing-program')
    await page.evaluate(() =>
      window.uiVerification.codeSetDetectedExecutable('C:\\合成程序\\resources\\opencode-cli.exe')
    )
    await page.getByRole('button', { name: '重新检测', exact: true }).click()
    await page
      .getByText('准备就绪，点击「连接 OpenCode」即可；无需先打开 Desktop。', { exact: true })
      .waitFor()
    assert.equal(
      await page.getByRole('textbox', { name: '编程项目目录', exact: true }).inputValue(),
      directory
    )
    assert.equal(
      await page.getByRole('button', { name: '连接 OpenCode', exact: true }).isEnabled(),
      true
    )
    assert.equal(await page.evaluate(() => window.uiVerification.codeSendCount()), 0)
  })
  await check('OpenCode 检测与选择项目，连接默认 Plan 且不发送任务', async () => {
    await page.getByRole('button', { name: '连接 OpenCode', exact: true }).click()
    await page.getByRole('button', { name: 'OpenCode 工作模式', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'OpenCode 工作模式', exact: true }).textContent(),
      'Plan▾'
    )
    assert.equal(await page.evaluate(() => window.uiVerification.codeSendCount()), 0)
    await capture('opencode-connected')
  })
  await check('OpenCode 连接后收起配置，展开设置不改变项目或触发任务', async () => {
    assert.equal(
      await page.getByRole('textbox', { name: 'OpenCode 程序路径', exact: true }).count(),
      0
    )
    assert.equal(
      await page
        .locator('.opencode-connection')
        .evaluate((element) => element.getBoundingClientRect().height < 110),
      true
    )
    assert.equal(
      await page
        .locator('.opencode-messages')
        .evaluate((element) => element.getBoundingClientRect().height > 300),
      true
    )
    await page.getByRole('button', { name: '连接设置', exact: true }).click()
    const project = page.getByRole('textbox', { name: '编程项目目录', exact: true })
    await project.waitFor()
    assert.equal(await project.inputValue(), 'E:\\合成项目')
    assert.equal(
      await page.getByRole('button', { name: '选择项目', exact: true }).isDisabled(),
      true
    )
    await capture('opencode-settings')
    await page.getByRole('button', { name: '连接设置', exact: true }).click()
    assert.equal(await project.count(), 0)
    assert.equal(await page.evaluate(() => window.uiVerification.codeSendCount()), 0)
    await capture('opencode-connected')
  })
  await check('Prompt 生成内容填入编程草稿，拒绝替换可保留原稿', async () => {
    await page.getByRole('button', { name: '工具', exact: true }).click()
    await page.getByRole('button', { name: 'Prompt 模板库', exact: true }).click()
    await page
      .getByRole('textbox', { name: '变量 context', exact: true })
      .fill('合成 Java 异常上下文')
    const output = await page
      .getByRole('textbox', { name: '生成的 Prompt', exact: true })
      .inputValue()
    await page.getByRole('button', { name: '用于编程 Agent', exact: true }).click()
    assert.equal(
      await page.getByRole('textbox', { name: '编程任务草稿', exact: true }).inputValue(),
      output
    )
    assert.equal(await page.evaluate(() => window.uiVerification.codeSendCount()), 0)
    await page.getByRole('textbox', { name: '编程任务草稿', exact: true }).fill('保留编程草稿')
    await page.getByRole('button', { name: '工具', exact: true }).click()
    await page.getByRole('button', { name: 'JSON 工具箱', exact: true }).click()
    await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).fill('{"synthetic":true}')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('button', { name: '用于编程 Agent', exact: true }).click()
    await page.getByRole('button', { name: '编程 Agent', exact: true }).click()
    assert.equal(
      await page.getByRole('textbox', { name: '编程任务草稿', exact: true }).inputValue(),
      '保留编程草稿'
    )
  })
  await check('OpenCode 发送失败保留草稿，重试后显示回复与代码块', async () => {
    await page.evaluate(() => window.uiVerification.codeFailNextSend())
    await page.getByRole('button', { name: '发送给 OpenCode', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '合成发送失败' }).waitFor()
    assert.equal(
      await page.getByRole('textbox', { name: '编程任务草稿', exact: true }).inputValue(),
      '保留编程草稿'
    )
    await page.getByRole('button', { name: '发送给 OpenCode', exact: true }).click()
    await page.getByRole('button', { name: '停止任务', exact: true }).waitFor()
    await page.evaluate(() => window.uiVerification.codeComplete())
    await page.getByText('合成回答', { exact: true }).waitFor()
    assert.equal(await page.locator('.opencode-messages pre code').count(), 1)
  })
  await check('OpenCode 模型/模式可切换，待审批可拒绝并可停止任务', async () => {
    await page.getByRole('button', { name: 'OpenCode 工作模式', exact: true }).click()
    await page.getByRole('option', { name: 'Build', exact: true }).click()
    await page.getByRole('textbox', { name: '编程任务草稿', exact: true }).fill('合成待审批任务')
    await page.getByRole('button', { name: '发送给 OpenCode', exact: true }).click()
    await page.evaluate(() => window.uiVerification.codePermission())
    await page.getByRole('region', { name: 'OpenCode 操作审批', exact: true }).waitFor()
    await capture('opencode-approval')
    await page.getByRole('button', { name: '拒绝操作', exact: true }).click()
    assert.equal(
      await page.getByRole('region', { name: 'OpenCode 操作审批', exact: true }).count(),
      0
    )
    await page.getByRole('button', { name: '停止任务', exact: true }).click()
    await page.getByRole('button', { name: '发送给 OpenCode', exact: true }).waitFor()
  })
  await check('OpenCode 历史会话可恢复，原生记录不与项目助手混合', async () => {
    await page.getByRole('button', { name: '读取 OpenCode 历史', exact: true }).click()
    await page.getByRole('button', { name: '恢复编程会话', exact: true }).click()
    await page.getByRole('option', { name: '合成历史会话', exact: true }).click()
    await page.getByText('合成历史正文', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.uiVerification.chatSendCount()), initialChatCount)
  })
  for (const [name, id] of [
    ['星轨深空', 'starry'],
    ['静夜石墨', 'graphite'],
    ['晨光纸白', 'paper']
  ]) {
    await check(`${name}下 OpenCode 工作台布局和菜单`, async () => {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('button', { name, exact: true }).click()
      await page.waitForFunction((id) => document.documentElement.dataset.theme === id, id)
      await page.getByRole('button', { name: '编程 Agent', exact: true }).click()
      assert.equal(
        await page
          .locator('.viewport')
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        false
      )
      await page.getByRole('button', { name: 'OpenCode 模型', exact: true }).click()
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
  await check('1024×680 下 OpenCode 工作台无横向溢出', async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 680)
    )
    assert.equal(
      await page
        .locator('.viewport')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
      false
    )
    await capture('opencode-narrow')
    await page.getByRole('textbox', { name: '编程任务草稿', exact: true }).scrollIntoViewIfNeeded()
    assert.equal(
      await page.getByRole('button', { name: '发送给 OpenCode', exact: true }).isVisible(),
      true
    )
    await capture('opencode-narrow-draft')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
    )
  })
}
