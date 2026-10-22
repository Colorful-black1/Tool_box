/* global window:readonly, document:readonly */
const assert = require('node:assert/strict')

module.exports = async function verifyIpPrompt({ page, app, check, capture }) {
  await page.getByRole('button', { name: '工具', exact: true }).click()
  const button = (name) => page.getByRole('button', { name, exact: true })
  const input = () => page.getByRole('textbox', { name: '待美化的提示词', exact: true })
  const result = () => page.getByRole('textbox', { name: 'AI 润色结果', exact: true })
  let originalBody
  let polished
  await check('我的 IP 可从搜索打开，显示两种协议并复制单项', async () => {
    const search = page.getByRole('searchbox', { name: '搜索开发者工具' })
    await search.fill('我的 IP')
    await search.press('Enter')
    const table = page.getByRole('table', { name: '本机 IP 地址' })
    await table.getByText('192.0.2.10', { exact: true }).waitFor()
    await table.getByText('2001:db8::10', { exact: true }).waitFor()
    await table.getByRole('row').filter({ hasText: '192.0.2.10' }).getByRole('button').click()
    assert.equal(await page.evaluate(() => window.uiVerification.copiedText()), '192.0.2.10')
    await button('复制全部地址').click()
    assert.match(await page.evaluate(() => window.uiVerification.copiedText()), /IPv6/)
    await search.fill('')
    await capture('tools-my-ip')
  })
  await check('IP 刷新失败有提示且清除旧地址，可重试恢复', async () => {
    await page.evaluate(() => window.uiVerification.failNextIp())
    await button('刷新 IP').click()
    await page.getByRole('alert').filter({ hasText: '无法读取本机 IP' }).waitFor()
    assert.equal(await button('复制全部地址').isDisabled(), true)
    await button('刷新 IP').click()
    await page.getByText('192.0.2.10', { exact: true }).waitFor()
  })
  await check('模板正文交接不请求 AI，手动润色保留占位符并转为新模板草稿', async () => {
    await button('Prompt 模板库').click()
    originalBody = await page.getByRole('textbox', { name: '模板正文', exact: true }).inputValue()
    await button('美化模板正文').click()
    assert.equal(await input().inputValue(), originalBody)
    assert.equal(await page.evaluate(() => window.uiVerification.polishCount()), 0)
    await button('开始 AI 润色').click()
    await page.waitForFunction(
      () => document.querySelector('textarea[aria-label="AI 润色结果"]')?.value
    )
    polished = await result().inputValue()
    assert.ok(polished.includes('{{context}}'))
    await capture('tools-prompt-polish')
    await button('转为新模板草稿').click()
    assert.equal(
      await page.getByRole('textbox', { name: '模板正文', exact: true }).inputValue(),
      polished
    )
    await button('保存模板').click()
    await page.getByText('模板已保存；变量值未保存', { exact: true }).waitFor()
    const library = (await page.evaluate(() => window.uiVerification.readConfig())).promptTemplates
    assert.ok(library.some((entry) => entry.body === polished))
    assert.ok(library.some((entry) => entry.body === originalBody))
  })
  await check('生成的 Prompt 可交接，润色失败保留原文，Agent 草稿不自动发送', async () => {
    await page.getByRole('textbox', { name: '变量 context', exact: true }).fill('合成变量值')
    const generated = await page
      .getByRole('textbox', { name: '生成的 Prompt', exact: true })
      .inputValue()
    await button('美化生成的 Prompt').click()
    assert.equal(await input().inputValue(), generated)
    assert.equal(await page.evaluate(() => window.uiVerification.polishCount()), 1)
    await page.evaluate(() => window.uiVerification.failNextPolish())
    await button('开始 AI 润色').click()
    await page.getByRole('alert').filter({ hasText: '合成润色失败' }).waitFor()
    assert.equal(await input().inputValue(), generated)
    await button('开始 AI 润色').click()
    await page.waitForFunction(
      () => document.querySelector('textarea[aria-label="AI 润色结果"]')?.value
    )
    const output = await result().inputValue()
    await button('用于编程 Agent').click()
    const draft = page.getByRole('textbox', { name: '编程任务草稿', exact: true })
    assert.equal(await draft.inputValue(), output)
    assert.equal(await page.evaluate(() => window.uiVerification.codeSendCount()), 0)
    await draft.fill('')
    await button('工具').click()
    assert.equal(await result().inputValue(), output)
    const saved = await page.evaluate(async () =>
      JSON.stringify(await window.uiVerification.readConfig())
    )
    assert.ok(!saved.includes('合成变量值'))
  })
  for (const [name, id] of [
    ['星轨深空', 'starry'],
    ['静夜石墨', 'graphite'],
    ['晨光纸白', 'paper']
  ]) {
    await check(`${name}下提示词美化布局完整`, async () => {
      await button('设置').click()
      await button(name).click()
      await page.waitForFunction((id) => document.documentElement.dataset.theme === id, id)
      await button('工具').click()
      assert.equal(
        await page.locator('.viewport').evaluate((node) => node.scrollWidth > node.clientWidth),
        false
      )
      await capture(`tools-prompt-polish-${id}`)
    })
  }
  await check('窄窗口 IP 表格和润色面板不撑宽页面', async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 680)
    )
    await button('我的 IP').click()
    await page.getByText('192.0.2.10', { exact: true }).waitFor()
    assert.equal(
      await page.locator('.viewport').evaluate((node) => node.scrollWidth > node.clientWidth),
      false
    )
    await capture('tools-my-ip-narrow')
    await button('提示词美化').click()
    assert.equal(
      await page.locator('.viewport').evaluate((node) => node.scrollWidth > node.clientWidth),
      false
    )
    await capture('tools-prompt-polish-narrow')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
    )
  })
  await button('设置').click()
  await button('星轨深空').click()
  await button('工具').click()
}
