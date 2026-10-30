/* global window:readonly, document:readonly, getComputedStyle:readonly */
const assert = require('node:assert/strict')
const { withDialog } = require('./dialog.cjs')

/** 合成原生事件验证基本交互，不运行原生 CLI 或发送模型请求。 */
module.exports = async function verifyAgentBasics({ page, app, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const draft = () => page.getByRole('textbox', { name: '编程任务草稿', exact: true })
  const calls = () => page.evaluate(() => window.uiVerification.agentCalls())
  const metadata = (patch) =>
    page.evaluate((value) => window.uiVerification.agentSessionMetadata('opencode', value), patch)
  const usage = {
    usedTokens: 64000,
    windowTokens: 200000,
    source: 'acp',
    approximate: false,
    windowKind: 'context',
    measuredAt: Date.now()
  }
  const original = '先检查项目结构，不修改文件'
  await button('编程 Agent').click()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
  )
  await button('选择项目').click()
  await draft().fill(original)
  await draft().press('Enter')
  await button('停止任务').waitFor()
  await page.evaluate(() => {
    window.uiVerification.agentDelta('已检查目录结构。', 'opencode')
    window.uiVerification.agentFinish('opencode')
  })
  await button('取回编辑').waitFor()
  await check('用户消息可复制；取回与取消不连接、不发送、不改历史', async () => {
    const before = (await calls()).length
    const user = page.locator('.message.user').first()
    await user.getByRole('button', { name: '复制', exact: true }).click()
    await user.getByRole('status').filter({ hasText: '已复制' }).waitFor()
    await draft().fill('需要保留的原草稿')
    await withDialog(page, false, () => button('取回编辑').click())
    assert.equal(await draft().inputValue(), '需要保留的原草稿')
    await withDialog(page, true, () => button('取回编辑').click())
    assert.equal(await draft().inputValue(), original)
    await page.getByRole('status').filter({ hasText: '发送为新消息' }).waitFor()
    await page.waitForFunction(() => document.activeElement?.id === 'opencode-draft')
    await draft().fill('编辑后的新输入')
    await withDialog(page, true, () => button('取消取回').click())
    assert.equal(await draft().inputValue(), '需要保留的原草稿')
    assert.equal(await user.locator('.message-content').innerText(), original)
    assert.equal((await calls()).length, before)
  })
  await check('输入区直接切换模式、模型与思考强度，切参数不发送任务', async () => {
    const footer = page.locator('.composer-actions')
    for (const name of ['OpenCode 工作模式', 'OpenCode 模型', 'OpenCode 思考强度'])
      await footer.getByRole('button', { name, exact: true }).waitFor()
    assert.equal(await page.locator('.opencode-options').count(), 0)
    const before = (await calls()).filter((item) =>
      ['send', 'create', 'resume'].includes(item.action)
    ).length
    await button('OpenCode 思考强度').click()
    await page.getByRole('option', { name: 'High', exact: true }).click()
    await footer
      .getByRole('button', { name: 'OpenCode 思考强度' })
      .getByText('High', { exact: true })
      .waitFor()
    assert.equal(
      (await calls()).filter((item) => ['send', 'create', 'resume'].includes(item.action)).length,
      before
    )
    assert.deepEqual(
      (await calls()).find((item) => item.action === 'option'),
      { action: 'option', id: 'opencode', optionId: 'thought_level', value: 'high' }
    )
  })
  await check('添加菜单键盘可用，文件与命令候选仍在输入框上方', async () => {
    const before = (await calls()).filter((item) => item.action === 'send').length
    await button('添加文件或工具').press('ArrowDown')
    const menu = page.getByRole('menu', { name: '添加文件或工具' })
    await menu.waitFor()
    await page.getByRole('menuitem', { name: '引用文件 @' }).click()
    const panel = page.locator('.agent-actions-popover')
    await panel.waitFor()
    const bounds = await panel.boundingBox(),
      inputBounds = await draft().boundingBox()
    assert.ok(bounds && inputBounds && bounds.y + bounds.height <= inputBounds.y + 1)
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden' })
    await button('添加文件或工具').click()
    await page.getByRole('menuitem', { name: '命令 /' }).click()
    await panel.waitFor()
    await page.keyboard.press('Escape')
    assert.equal((await calls()).filter((item) => item.action === 'send').length, before)
  })
  await check('用量详情只显示原生快照，压缩入口只准备草稿，Esc 仅关浮层', async () => {
    await metadata({ contextUsage: usage })
    await button('上下文 32%').click()
    const panel = page.locator('.agent-context-popover')
    await panel.waitFor()
    assert.ok((await panel.innerText()).includes('ACP 原生报告'))
    const before = (await calls()).length
    await withDialog(page, true, () => button('准备压缩上下文').click())
    assert.equal(await draft().inputValue(), '/compact')
    assert.equal((await calls()).length, before)
    await button('上下文 32%').click()
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden' })
    assert.equal(await button('编程 Agent').isVisible(), true)
    await metadata({ contextUsage: { ...usage, windowTokens: null } })
    await button('上下文 未提供').waitFor()
    await metadata({ contextUsage: { ...usage, usedTokens: 220000, stale: true } })
    await button('上下文 110%，上次快照').click()
    await panel.getByText('已超过窗口 10%', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
  })
  await draft().fill('新的合成任务')
  await draft().press('Enter')
  await button('停止任务').waitFor()
  const question = {
    id: 'question-one',
    kind: 'questions',
    title: '原生需要你回答',
    questions: [
      {
        id: 'q0',
        title: '方案',
        text: '选择实现方案',
        multiple: false,
        allowText: false,
        options: [
          { label: '保留现有实现', description: '最小改动' },
          { label: '重新设计', description: '更多修改' }
        ]
      },
      {
        id: 'q1',
        title: '验证',
        text: '选择验证范围',
        multiple: true,
        allowText: true,
        options: [
          { label: '代码审查', description: '' },
          { label: '界面验证', description: '' }
        ]
      }
    ]
  }
  await metadata({ questions: [question], contextUsage: usage })
  await check('单选、多选与文本答案只答复原请求，不自动发送或批准工具', async () => {
    const form = page.getByRole('form', { name: question.title })
    await form.waitFor()
    assert.equal(await button('提交回答').isDisabled(), true)
    const before = (await calls()).filter((item) => item.action === 'send').length
    await form.getByRole('button', { name: '保留现有实现 最小改动' }).click()
    await form.getByRole('button', { name: '代码审查', exact: true }).click()
    await form.getByRole('button', { name: '界面验证', exact: true }).click()
    await form.getByRole('textbox', { name: '补充回答' }).fill('再检查边界')
    await button('提交回答').click()
    await form.waitFor({ state: 'hidden' })
    const answer = (await calls()).find((item) => item.action === 'answer')
    assert.deepEqual(answer.answers, [
      { questionId: 'q0', values: ['保留现有实现'] },
      { questionId: 'q1', values: ['代码审查', '界面验证', '再检查边界'] }
    ])
    assert.equal((await calls()).filter((item) => item.action === 'send').length, before)
  })
  for (const [theme, label] of [
    ['starry', '星轨深空'],
    ['graphite', '静夜石墨'],
    ['paper', '晨光纸白']
  ]) {
    await check(`问答、上下文与停止入口 ${theme} 主题布局`, async () => {
      await metadata({ questions: [{ ...question, id: `question-${theme}` }] })
      await button('设置').click()
      await page.waitForFunction(
        () => document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
      )
      await button(label).click()
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
      await button('编程 Agent').click()
      const card = page.getByRole('form', { name: question.title })
      await card.waitFor()
      await button('停止任务').waitFor()
      for (const node of [card, button('停止任务'), draft()]) {
        const box = await node.boundingBox()
        assert.ok(
          box && box.x >= 0 && box.x + box.width <= 1281 && box.y >= 0 && box.y + box.height <= 820,
          JSON.stringify({
            box,
            layout: await page.evaluate(() =>
              [
                ...document.querySelectorAll(
                  '.opencode-page, .opencode-layout, .opencode-panel, .agent-question-card, .composer'
                )
              ].map((node) => ({
                class: node.className,
                height: node.getBoundingClientRect().height,
                top: node.getBoundingClientRect().top,
                minHeight: getComputedStyle(node).minHeight
              }))
            )
          })
        )
      }
      await capture(`agent-basics-${theme}-1280`)
    })
  }
  await check('取消与停止清除待回答问题，旧输入不残留到下一请求', async () => {
    await button('取消本次请求').click()
    await page.getByRole('form', { name: question.title }).waitFor({ state: 'hidden' })
    assert.equal((await calls()).filter((item) => item.action === 'answer').at(-1).cancelled, true)
    await metadata({ questions: [{ ...question, id: 'before-stop' }] })
    await button('停止任务').click()
    await page.getByRole('form', { name: question.title }).waitFor({ state: 'hidden' })
    await page.getByLabel('任务恢复操作').waitFor()
  })
  await check('原生表单区分枚举值与标签，可选项不阻止提交，支持数字与布尔', async () => {
    await draft().fill('表单合成请求')
    await draft().press('Enter')
    await button('停止任务').waitFor()
    await metadata({
      questions: [
        {
          id: 'typed-form',
          kind: 'questions',
          title: '原生类型表单',
          questions: [
            {
              id: 'q0',
              title: '颜色',
              text: '选择颜色',
              multiple: false,
              allowText: false,
              required: true,
              options: [{ label: '金色', value: 'gold', description: '' }]
            },
            {
              id: 'q1',
              title: '数量',
              text: '填写数量',
              multiple: false,
              allowText: true,
              valueKind: 'integer',
              minimum: 1,
              maximum: 3,
              required: true,
              options: []
            },
            {
              id: 'q2',
              title: '启用',
              text: '是否启用',
              multiple: false,
              allowText: false,
              valueKind: 'boolean',
              required: true,
              options: [{ label: '否', value: 'false', description: '' }]
            },
            {
              id: 'q3',
              title: '备注',
              text: '可省略',
              multiple: false,
              allowText: true,
              required: false,
              options: []
            }
          ]
        }
      ]
    })
    const form = page.getByRole('form', { name: '原生类型表单' })
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 680)
    )
    const cardBounds = await form.boundingBox()
    const stopBounds = await button('停止任务').boundingBox()
    assert.ok(cardBounds && cardBounds.x >= 0 && cardBounds.x + cardBounds.width <= 1025)
    assert.ok(stopBounds && stopBounds.y >= 0 && stopBounds.y + stopBounds.height <= 681)
    await capture('agent-basics-form-paper-1024')
    await form.getByRole('button', { name: '金色', exact: true }).click()
    await form.getByRole('spinbutton').fill('2')
    await form.getByRole('button', { name: '否', exact: true }).click()
    assert.equal(await form.getByRole('button', { name: '提交回答' }).isEnabled(), true)
    await form.getByRole('button', { name: '提交回答' }).click()
    await form.waitFor({ state: 'hidden' })
    const answer = (await calls()).filter((item) => item.action === 'answer').at(-1)
    assert.deepEqual(
      answer.answers.map((item) => item.values),
      [['gold'], ['2'], ['false'], []]
    )
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
    )
    await button('停止任务').click()
  })
  await check('未知结果仅核对原生历史，不提供盲重试；草稿仍保留', async () => {
    await metadata({ status: 'error', outcome: 'unknown', questions: [] })
    const recovery = page.getByLabel('任务恢复操作')
    assert.equal(await recovery.getByRole('button', { name: '取回最近提问' }).count(), 0)
    await draft().fill('核对后再决定的草稿')
    const before = (await calls()).filter((item) => ['send', 'create'].includes(item.action)).length
    await button('核对原生历史').click()
    await recovery.waitFor({ state: 'hidden' })
    assert.equal(await draft().inputValue(), '核对后再决定的草稿')
    assert.equal(
      (await calls()).filter((item) => ['send', 'create'].includes(item.action)).length,
      before
    )
  })
  await check('顶部标签切换保留各自草稿，不重复恢复；历史面板可搜索并直接打开', async () => {
    const before = (await calls()).filter((item) => item.action === 'resume').length
    await button('新对话').click()
    await draft().fill('第二个会话的任务')
    await draft().press('Enter')
    await button('停止任务').waitFor()
    await page.evaluate(() => window.uiVerification.agentFinish('opencode'))
    await draft().fill('第二个会话未发送草稿')
    const tabs = page.getByRole('tablist', { name: '已打开会话' }).getByRole('tab')
    assert.equal(await tabs.count(), 2)
    await tabs.first().click()
    assert.equal(await draft().inputValue(), '核对后再决定的草稿')
    await tabs.last().click()
    assert.equal(await draft().inputValue(), '第二个会话未发送草稿')
    await tabs.last().press('ArrowLeft')
    await page.keyboard.press('Enter')
    assert.equal(await tabs.first().getAttribute('aria-selected'), 'true')
    assert.equal((await calls()).filter((item) => item.action === 'resume').length, before)
    await button('历史会话').click()
    const history = page.getByRole('dialog', { name: '历史会话', exact: true })
    await history.waitFor()
    await history.getByRole('textbox', { name: '搜索会话' }).fill('原生历史标题')
    await history.locator('.opencode-session-item').first().click()
    await history.waitFor({ state: 'hidden' })
    assert.equal((await calls()).filter((item) => item.action === 'resume').length, before + 1)
    assert.equal(await tabs.count(), 3)
  })
  await check('原生回退先预览，取消不改历史；确认后取回草稿且不自动发送', async () => {
    await metadata({ canRevert: true })
    const before = (await calls()).filter((item) => item.action === 'send').length
    const original = await page
      .locator('.message.user')
      .first()
      .locator('.message-content')
      .innerText()
    await draft().fill('回退前保留的草稿')
    await button('回退到此处').first().click()
    const dialog = page.locator('[data-app-dialog]')
    await dialog.waitFor()
    assert.ok((await dialog.innerText()).includes('文件改动保留'))
    const bounds = await dialog.boundingBox()
    assert.ok(
      bounds &&
        bounds.x >= 0 &&
        bounds.x + bounds.width <= 1281 &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= 821
    )
    await capture('agent-basics-revert-preview-paper-1280')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal((await calls()).filter((item) => item.action === 'revert').length, 0)
    assert.equal(await page.locator('.message.user').count(), 1)
    await withDialog(page, true, () => button('回退并编辑').first().click())
    await page.waitForFunction(() => document.querySelectorAll('.message.user').length === 0)
    assert.equal(await draft().inputValue(), original)
    await page.getByRole('status').filter({ hasText: '已回退原生对话' }).waitFor()
    assert.equal((await calls()).filter((item) => item.action === 'send').length, before)
    await button('恢复原草稿').click()
    assert.equal(await draft().inputValue(), '回退前保留的草稿')
    assert.equal(await page.locator('.message.user').count(), 0)
    assert.equal((await calls()).filter((item) => item.action === 'revert').length, 1)
  })
}
