const { withDialog } = require('./dialog.cjs')
/* global document:readonly, window:readonly */
const assert = require('node:assert/strict')

async function choose(page, label, option) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

/** 真实 renderer + 合成桥接；输入值均为测试数据，禁止读取用户数据库。 */
async function verifyDevTools({ page, app, check, capture }) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
  )
  const tool = async (name) => {
    await page.getByRole('button', { name: '工具', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).click()
  }
  const menuFits = async (label) => {
    await page.getByRole('button', { name: label, exact: true }).click()
    const fits = await page.locator('.dropdown-popover').evaluate((element) => {
      const box = element.getBoundingClientRect()
      return (
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= window.innerWidth &&
        box.bottom <= window.innerHeight
      )
    })
    assert.equal(fits, true, `${label} 不应超出窗口`)
    await page.keyboard.press('Escape')
  }
  const longId = '9223372036854775807'
  await check('JSON 无损格式化、排序与复制保留长整数', async () => {
    await tool('JSON 工具箱')
    await page
      .getByRole('textbox', { name: 'JSON 输入', exact: true })
      .fill(`{"z":1,"a":${longId}}`)
    let output = await page.getByRole('textbox', { name: '处理结果', exact: true }).inputValue()
    assert.ok(output.includes(longId))
    await choose(page, 'JSON 操作', '字段排序')
    output = await page.getByRole('textbox', { name: '处理结果', exact: true }).inputValue()
    assert.ok(output.indexOf('"a"') < output.indexOf('"z"'))
    await page.getByRole('button', { name: '复制', exact: true }).click()
    assert.equal(await page.evaluate(() => window.uiVerification.copiedText()), output)
  })
  await check('JSONPath 命中大整数，未支持语法明确提示', async () => {
    await page
      .getByRole('textbox', { name: 'JSON 输入', exact: true })
      .fill(`{"data":[{"id":${longId}}]}`)
    await choose(page, 'JSON 操作', 'JSONPath 提取')
    assert.ok(
      (await page.getByRole('textbox', { name: '处理结果', exact: true }).inputValue()).includes(
        longId
      )
    )
    await page.getByRole('textbox', { name: 'JSONPath', exact: true }).fill('$..id')
    await page.getByRole('alert').filter({ hasText: '不支持此路径语法' }).waitFor()
    assert.equal(
      await page.getByRole('textbox', { name: '处理结果', exact: true }).inputValue(),
      ''
    )
    await choose(page, 'JSON 操作', '解除转义 / 展开')
    await page
      .getByRole('textbox', { name: 'JSON 输入', exact: true })
      .fill(JSON.stringify('line1\nline2'))
    assert.equal(
      await page.getByRole('textbox', { name: '处理结果', exact: true }).inputValue(),
      'line1\nline2'
    )
  })
  await check('文本差异对齐行号，JSON 比较忽略字段顺序且精确到长整数', async () => {
    await tool('差异比较')
    await page.getByRole('textbox', { name: '原始内容', exact: true }).fill('a\nb')
    await page.getByRole('textbox', { name: '修改后内容', exact: true }).fill('a\nx\nb')
    assert.equal(await page.locator('.tool-diff-line.added').count(), 1)
    assert.equal(await page.locator('.tool-diff-line.same').count(), 2)
    await choose(page, '比较方式', 'JSON 字段')
    await page
      .getByRole('textbox', { name: '原始内容', exact: true })
      .fill(`{"id":${longId},"updatedAt":1}`)
    await page
      .getByRole('textbox', { name: '修改后内容', exact: true })
      .fill('{"updatedAt":2,"id":9223372036854775806}')
    await page.getByRole('textbox', { name: '忽略字段名', exact: true }).fill('updatedAt')
    assert.equal(await page.locator('.tool-diff-entry').count(), 1)
    await capture('devtools-json-diff')
  })
  await check('脱敏预览保留 JSON 结构、同值替身与规则开关', async () => {
    await tool('数据脱敏')
    await page
      .getByRole('textbox', { name: '待脱敏内容', exact: true })
      .fill(
        '{"token":"synthetic-secret","email":"test@example.invalid","copy":"synthetic-secret","count":1}'
      )
    const output = await page.getByRole('textbox', { name: '脱敏预览', exact: true }).inputValue()
    assert.ok(!output.includes('synthetic-secret') && !output.includes('test@example.invalid'))
    const parsed = JSON.parse(output)
    assert.equal(parsed.token, parsed.copy)
    assert.equal(parsed.count, 1)
    await page.getByRole('checkbox', { name: '邮箱', exact: true }).uncheck()
    assert.ok(
      (await page.getByRole('textbox', { name: '脱敏预览', exact: true }).inputValue()).includes(
        'test@example.invalid'
      )
    )
    await page.getByRole('checkbox', { name: '邮箱', exact: true }).check()
    await capture('devtools-redaction')
  })
  await check('日志按 traceId 保留异常链并可送入脱敏', async () => {
    await tool('Java 日志整理')
    await page
      .getByRole('textbox', { name: '原始日志', exact: true })
      .fill(
        'ERROR [trace-1] synthetic failure\n\tat demo.A.run(A.java:1)\nCaused by: java.io.IOException\nINFO [trace-2] ok'
      )
    await page.getByRole('textbox', { name: '筛选 traceId', exact: true }).fill('trace-1')
    const output = await page.getByRole('textbox', { name: '整理结果', exact: true }).inputValue()
    assert.ok(output.includes('Caused by') && !output.includes('trace-2'))
    await page.getByLabel('异常链', { exact: true }).waitFor()
    await capture('devtools-java-log')
    await page.getByRole('button', { name: '用于脱敏', exact: true }).click()
    assert.equal(
      await page.getByRole('textbox', { name: '待脱敏内容', exact: true }).inputValue(),
      output
    )
  })
  await check('工具结果填入 Prompt context，放入对话只准备草稿', async () => {
    await page.getByRole('button', { name: '填入 Prompt', exact: true }).click()
    const context = page.getByRole('textbox', { name: '变量 context', exact: true })
    await context.waitFor()
    assert.ok((await context.inputValue()).includes('trace-1'))
    const output = await page
      .getByRole('textbox', { name: '生成的 Prompt', exact: true })
      .inputValue()
    const count = await page.evaluate(() => window.uiVerification.chatSendCount())
    await page.getByRole('button', { name: '放入对话草稿', exact: true }).click()
    await page.getByRole('textbox', { name: '输入消息', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue(),
      output
    )
    assert.equal(await page.evaluate(() => window.uiVerification.chatSendCount()), count)
  })
  await check('已有对话草稿可拒绝替换，离开页面后仍保留', async () => {
    await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('保留这份合成草稿')
    await tool('JSON 工具箱')
    await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).fill('{"value":1}')
    await withDialog(page, false, async () => {
      await page.getByRole('button', { name: '放入对话草稿', exact: true }).click()
    })
    assert.equal(await page.locator('.tool-panel-title').textContent(), 'JSON 工具箱')
    await page.getByRole('button', { name: '对话', exact: true }).click()
    assert.equal(
      await page.getByRole('textbox', { name: '输入消息', exact: true }).inputValue(),
      '保留这份合成草稿'
    )
    await page.getByRole('textbox', { name: '输入消息', exact: true }).fill('')
  })
  await check('保存笔记失败可重试，成功后防止重复保存同一结果', async () => {
    await tool('JSON 工具箱')
    await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).fill('{"verified":true}')
    await page.evaluate(() => window.uiVerification.failNextNoteSave())
    const count = await page.evaluate(() => window.uiVerification.noteSaveCount())
    await page.getByRole('button', { name: '保存为笔记', exact: true }).click()
    await page.getByText('保存笔记失败，请重试', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.uiVerification.noteSaveCount()), count)
    await page.getByRole('button', { name: '保存为笔记', exact: true }).click()
    await page.getByRole('button', { name: '已保存笔记', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.uiVerification.noteSaveCount()), count + 1)
    assert.equal(
      (await page.evaluate(() => window.uiVerification.lastNote())).content,
      '{\n  "verified": true\n}'
    )
  })
  await check('自定义 Prompt 模板保存，填充值不写入配置', async () => {
    await tool('Prompt 模板库')
    await page.getByRole('button', { name: '新建模板', exact: true }).click()
    await page.getByRole('textbox', { name: '模板名称', exact: true }).fill('验收 Prompt 模板')
    await page
      .getByRole('textbox', { name: '模板正文', exact: true })
      .fill('请分析 {{context}}，输出结论。')
    await page
      .getByRole('textbox', { name: '变量 context', exact: true })
      .fill('synthetic-unsaved-context')
    await page.getByRole('button', { name: '保存模板', exact: true }).click()
    await page.getByText('模板已保存；变量值未保存', { exact: true }).waitFor()
    const config = await page.evaluate(() => window.uiVerification.readConfig())
    assert.ok(config.promptTemplates.some((item) => item.title === '验收 Prompt 模板'))
    assert.ok(!JSON.stringify(config.promptTemplates).includes('synthetic-unsaved-context'))
    await capture('devtools-prompt')
  })
  await check('模板切换工具时取消可保留未保存正文', async () => {
    const before = await page.getByRole('textbox', { name: '模板正文', exact: true }).inputValue()
    await page
      .getByRole('textbox', { name: '模板正文', exact: true })
      .fill('未保存正文 {{context}}')
    await withDialog(page, false, async () => {
      await page.getByRole('button', { name: '差异比较', exact: true }).click()
    })
    assert.equal(await page.locator('.tool-panel-title').textContent(), 'Prompt 模板库')
    assert.equal(
      await page.getByRole('textbox', { name: '模板正文', exact: true }).inputValue(),
      '未保存正文 {{context}}'
    )
    await page.getByRole('textbox', { name: '模板正文', exact: true }).fill(before)
  })
  await check('模板保存失败保留编辑草稿，成功后保存历史', async () => {
    await page.getByRole('textbox', { name: '模板正文', exact: true }).fill('第二版 {{context}}')
    await page.evaluate(() => window.uiVerification.failNextConfigSave())
    await page.getByRole('button', { name: '保存新版本', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '模板保存失败' }).waitFor()
    assert.equal(
      await page.getByRole('textbox', { name: '模板正文', exact: true }).inputValue(),
      '第二版 {{context}}'
    )
    const before = await page.evaluate(() => window.uiVerification.readConfig())
    assert.equal(
      before.promptTemplates.find((item) => item.title === '验收 Prompt 模板').versions.length,
      0
    )
    await page.getByRole('button', { name: '保存新版本', exact: true }).click()
    await page.getByText('模板已保存；变量值未保存', { exact: true }).waitFor()
    const after = await page.evaluate(() => window.uiVerification.readConfig())
    assert.equal(
      after.promptTemplates.find((item) => item.title === '验收 Prompt 模板').versions.length,
      1
    )
  })
  await check('历史版本只读，采用后保存为新版本，并可送入 Diff', async () => {
    await page.getByRole('button', { name: '模板版本', exact: true }).click()
    await page.getByRole('option').filter({ hasText: '历史 1' }).click()
    assert.equal(
      await page.getByRole('textbox', { name: '模板正文', exact: true }).getAttribute('readonly'),
      ''
    )
    assert.equal(
      await page.getByRole('button', { name: '保存新版本', exact: true }).isDisabled(),
      true
    )
    await page.getByRole('button', { name: '采用此版本', exact: true }).click()
    await page.getByRole('button', { name: '保存新版本', exact: true }).click()
    await page.getByText('模板已保存；变量值未保存', { exact: true }).waitFor()
    await page.getByRole('button', { name: '与历史版本比较', exact: true }).click()
    await page.getByRole('textbox', { name: '原始内容', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('textbox', { name: '原始内容', exact: true }).inputValue(),
      '第二版 {{context}}'
    )
    assert.equal(
      await page.getByRole('textbox', { name: '修改后内容', exact: true }).inputValue(),
      '请分析 {{context}}，输出结论。'
    )
  })

  for (const [name, id] of [
    ['星轨深空', 'starry'],
    ['静夜石墨', 'graphite'],
    ['晨光纸白', 'paper']
  ]) {
    await check(`${name}下新工具布局与弹层无横向溢出`, async () => {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('button', { name, exact: true }).click()
      await page.waitForFunction((id) => document.documentElement.dataset.theme === id, id)
      for (const label of [
        'JSON 工具箱',
        '差异比较',
        '数据脱敏',
        'Java 日志整理',
        'Prompt 模板库'
      ]) {
        await tool(label)
        assert.equal(
          await page
            .locator('.viewport')
            .evaluate((element) => element.scrollWidth > element.clientWidth),
          false
        )
        if (label === 'JSON 工具箱') await menuFits('JSON 操作')
        if (label === 'Prompt 模板库') await menuFits('选择 Prompt 模板')
        if (label === 'Prompt 模板库') await capture(`devtools-prompt-${id}`)
      }
    })
  }
  await check('1024×680 新工具与 Prompt 控件无裁切', async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 680)
    )
    for (const label of ['JSON 工具箱', '差异比较', '数据脱敏', 'Java 日志整理', 'Prompt 模板库']) {
      await tool(label)
      assert.equal(
        await page
          .locator('.viewport')
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        false
      )
    }
    await capture('devtools-prompt-narrow')
    await menuFits('选择 Prompt 模板')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
    )
  })
}

async function verifyTemplatesAfterRestart(page) {
  await page.getByRole('button', { name: '工具', exact: true }).click()
  await page.getByRole('button', { name: 'Prompt 模板库', exact: true }).click()
  await choose(page, '选择 Prompt 模板', '验收 Prompt 模板')
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="模板正文"]')?.value === '请分析 {{context}}，输出结论。'
  )
  assert.equal(
    await page.getByRole('textbox', { name: '模板正文', exact: true }).inputValue(),
    '请分析 {{context}}，输出结论。'
  )
  assert.equal(
    await page.getByRole('textbox', { name: '变量 context', exact: true }).inputValue(),
    ''
  )
  assert.equal(
    await page.getByRole('textbox', { name: '生成的 Prompt', exact: true }).inputValue(),
    ''
  )
  const config = await page.evaluate(() => window.uiVerification.readConfig())
  assert.equal(
    config.promptTemplates.find((item) => item.title === '验收 Prompt 模板').versions.length,
    2
  )
}

module.exports = { verifyDevTools, verifyTemplatesAfterRestart }
