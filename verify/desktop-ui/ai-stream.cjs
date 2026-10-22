/* global window:readonly, document:readonly */
const assert = require('node:assert/strict')

/** 手动控制分片与结算，证明正文在请求完成前可见，不调用真实模型或读密码文件。 */
module.exports = async function verifyAiStream({ page, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const output = () => page.getByRole('textbox', { name: 'AI 润色结果', exact: true })
  await button('工具').click()
  await button('提示词美化').click()
  const input = page.getByRole('textbox', { name: '待美化的提示词', exact: true })
  const start = async () => {
    await page.evaluate(() => window.uiVerification.holdNextAi())
    await button('开始 AI 润色').click()
    await page.waitForFunction(() => window.uiVerification.pendingAiId())
  }
  await check('提示词分片在完成前可见，未校验时禁用复制与结果交接', async () => {
    await input.fill('合成输入 {{context}}')
    await start()
    await page.evaluate(() => window.uiVerification.aiDelta('第一段'))
    await page.waitForFunction(
      () => document.querySelector('[aria-label="AI 润色结果"]')?.value === '第一段'
    )
    assert.equal(await button('复制').isDisabled(), true)
    assert.equal(await button('转为新模板草稿').count(), 0)
    await page.evaluate(() => window.uiVerification.aiDelta('，第二段 {{context}}'))
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="AI 润色结果"]')?.value.includes('第二段')
    )
    await capture('ai-polish-streaming')
    await page.evaluate(() => window.uiVerification.finishAi('第一段，第二段 {{context}}'))
    await button('转为新模板草稿').waitFor()
    assert.equal(await output().inputValue(), '第一段，第二段 {{context}}')
    assert.equal(await button('复制').isDisabled(), false)
  })
  await check('修改输入后旧分片与旧结果均不采用，失败清除未完成内容', async () => {
    await start()
    await input.fill('新输入')
    await page.evaluate(() => window.uiVerification.aiDelta('过期分片'))
    assert.equal(await output().inputValue(), '')
    await page.evaluate(() => window.uiVerification.finishAi('过期结果'))
    await page.getByRole('alert').filter({ hasText: '输入已变化' }).waitFor()
    assert.equal(await output().inputValue(), '')
    await start()
    await page.evaluate(() => window.uiVerification.aiDelta('未完成内容'))
    await page.evaluate(() => window.uiVerification.failAi())
    await page.getByRole('alert').filter({ hasText: '合成生成失败' }).waitFor()
    assert.equal(await output().inputValue(), '')
  })
  await check('切换工具不打断流式预览，可返回并手动停止', async () => {
    await start()
    await button('我的 IP').click()
    await page.evaluate(() => window.uiVerification.aiDelta('切换期间的分片'))
    await button('提示词美化').click()
    assert.equal(await output().inputValue(), '切换期间的分片')
    await button('停止润色').click()
    await page.getByRole('alert').filter({ hasText: '已停止' }).waitFor()
    assert.equal(await output().inputValue(), '')
    assert.equal(await input.inputValue(), '新输入')
  })
  const openImport = async () => {
    await button('密码箱').click()
    await button('批量导入').click()
    await button('AI 识别').click()
    await page.evaluate(() => window.uiVerification.holdNextAi())
    await button('选择文本文件').click()
    await page.waitForFunction(() => window.uiVerification.pendingAiId())
    await page.evaluate(() =>
      window.uiVerification.aiPasswordPreview([
        { title: '合成流式账号', account: 'fixture', url: '', hasPassword: true }
      ])
    )
    await page.getByText('合成流式账号', { exact: true }).waitFor()
  }
  await check('密码识别逐条展示脱敏预览，完成前不能导入', async () => {
    await openImport()
    assert.equal(await page.getByRole('button', { name: /导入所选/ }).isDisabled(), true)
    await page.getByText('fixture · 密码已填', { exact: true }).waitFor()
    await capture('ai-password-streaming')
    await page.evaluate(() =>
      window.uiVerification.finishAi([
        {
          title: '合成流式账号',
          account: 'fixture',
          url: '',
          password: 'fixture-only-private',
          remark: ''
        }
      ])
    )
    await button('导入所选（1）').waitFor({ state: 'visible' })
    await page.waitForFunction(
      () => !document.querySelector('.overlay-actions .btn-gold')?.disabled
    )
    assert.ok(
      !(await page.getByRole('dialog', { name: '批量导入密码' }).innerText()).includes(
        'fixture-only-private'
      )
    )
    await button('关闭').click()
  })
  await check('停止或关闭识别会取消请求，旧预览不进入下一次导入', async () => {
    await openImport()
    await button('停止识别').click()
    await page.getByRole('alert').filter({ hasText: '已停止' }).waitFor()
    assert.equal(await page.getByText('合成流式账号', { exact: true }).count(), 0)
    await button('关闭').click()
    await openImport()
    await button('关闭').click()
    await page.waitForFunction(() => !window.uiVerification.pendingAiId())
    await button('批量导入').click()
    assert.equal(await page.getByText('合成流式账号', { exact: true }).count(), 0)
    await button('关闭').click()
  })
}
