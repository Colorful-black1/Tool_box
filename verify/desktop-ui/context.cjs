const assert = require('node:assert/strict')

/** 对话上下文：标题栏占用、浮层分项、手动压缩入口。 */
module.exports = async function verifyContext({ page, check, capture }) {
  await page.getByRole('button', { name: '对话', exact: true }).click()

  await check('标题栏显示上下文占用并可展开分项', async () => {
    const trigger = page.getByRole('button', { name: /上下文约 42%/ }).first()
    await trigger.waitFor()
    await trigger.click()
    await page.getByText('当前上下文', { exact: true }).waitFor()
    assert.match(await page.locator('.chat-context-popover').innerText(), /约 5\.4 万 \/ 12\.8 万/)
    assert.match(await page.locator('.chat-context-popover').innerText(), /模型接口/)
    assert.match(await page.locator('.chat-context-popover').innerText(), /工具定义/)
    await capture('chat-context-popover')
    await page.keyboard.press('Escape')
  })

  await check('手动压缩入口给出无需压缩反馈', async () => {
    await page.getByRole('button', { name: /上下文约 42%/ }).first().click()
    await page.getByRole('button', { name: '立即压缩', exact: true }).click()
    await page
      .locator('.chat-panel .status-banner', { hasText: '对话还短，无需压缩' })
      .waitFor()
    await capture('chat-context-compact-noop')
  })
}
