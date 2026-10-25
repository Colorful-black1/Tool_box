/* global document:readonly, window:readonly */
const assert = require('node:assert/strict')

module.exports = async function verifyChatTools({ page, app, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const chat = () => button('对话').click()
  const call = (name, input, permission = 'confirm') =>
    page.evaluate(
      ({ name, input, permission }) => window.uiVerification.callChatTool(name, input, permission),
      { name, input, permission }
    )
  const write = async (name, input, approved = true, permission = 'confirm') => {
    const pending = call(name, input, permission)
    const approval = page.getByRole('alertdialog', { name: '需要确认的操作' })
    await approval.waitFor()
    await approval.getByRole('button', { name: approved ? '允许' : '拒绝', exact: true }).click()
    return pending
  }
  await page.locator('.message-empty').waitFor()
  let noteId, todoId, bookId
  await check('真实局部编辑工具在完全访问下仍显示差异，拒绝不写入', async () => {
    const notes = await page.evaluate(() => window.toolbox.notes.list())
    noteId = notes[0].id
    const pending = call(
      'notes_edit',
      { note: noteId, operation: 'replace', text: '启动命令 old', replacement: '启动命令 new' },
      'full'
    )
    const preview = page.getByLabel('操作预览')
    await preview.waitFor()
    assert.match(await preview.innerText(), /- 2: 启动命令 old/)
    assert.match(await preview.innerText(), /\+ :2 启动命令 new/)
    await capture('chat-note-edit-preview')
    await button('拒绝').click()
    assert.match(await pending, /用户拒绝/)
    assert.match((await page.evaluate(() => window.toolbox.notes.list()))[0].content, /命令 old/)
  })
  await check('批准片段替换后入口打开最新笔记且保留其余正文', async () => {
    await write('notes_edit', {
      note: noteId,
      operation: 'replace',
      text: '启动命令 old',
      replacement: '启动命令 new'
    })
    await button('打开笔记「发布笔记」').last().click()
    await page.getByRole('textbox', { name: '笔记正文' }).waitFor()
    assert.equal(
      await page.getByRole('textbox', { name: '笔记正文' }).inputValue(),
      '第一段\n启动命令 new\n保留末尾'
    )
    await chat()
  })
  await check('真实待办工具新建、完成、归档，打开已归档结果并保留草稿', async () => {
    const result = JSON.parse(
      await write('todos_save', {
        title: '发布检查',
        details: '合成待办备注',
        due: '2099-10-26 15:00',
        remind: true
      })
    )
    todoId = result.id
    await button('打开待办「发布检查」').last().click()
    await page.locator(`[data-todo-id="${todoId}"]`).waitFor()
    await page.getByRole('textbox', { name: '待办标题', exact: true }).fill('保留未保存待办草稿')
    await chat()
    await write('todos_set_state', { id: todoId, action: 'complete' })
    await write('todos_set_state', { id: todoId, action: 'archive' })
    await button('打开待办「发布检查」').last().click()
    await page.locator(`[data-todo-id="${todoId}"].highlighted`).waitFor()
    assert.equal(
      await page.getByRole('textbox', { name: '待办标题', exact: true }).inputValue(),
      '保留未保存待办草稿'
    )
    assert.equal(await page.getByRole('checkbox', { name: '完成 发布检查' }).isChecked(), true)
    await chat()
  })
  await check('四域搜索包含归档事项且分组入口精确定位', async () => {
    const result = JSON.parse(await call('workspace_search', { query: '发布' }))
    assert.deepEqual(
      result.results.map((group) => group.total),
      [1, 1, 1, 1]
    )
    assert.match(result.results[1].items[0].snippet, /已归档/)
    bookId = result.results[2].items[0].target.id
    await button('打开发布分组').last().click()
    await page.locator('.group-chip.active').filter({ hasText: '发布分组' }).waitFor()
    await chat()
  })
  await check('章节入口打开指定章节，未走默认阅读位置', async () => {
    await call('workspace_open', { kind: 'book', ref: bookId, chapterIdx: 1 })
    await button('打开发布故事 · 第二章').last().click()
    await page.locator('.reader-content').filter({ hasText: '第二章合成正文' }).first().waitFor()
    await chat()
  })
  await check('统计入口保留 Agent 和完整自定义日期范围', async () => {
    await call('usage_query', {
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-25',
      client: 'codex',
      comparePrevious: true
    })
    await button('打开Token 统计（本次筛选）').last().click()
    assert.equal(
      await page.getByRole('textbox', { name: '开始日期', exact: true }).inputValue(),
      '2026-10-01'
    )
    assert.equal(
      await page.getByRole('textbox', { name: '结束日期', exact: true }).inputValue(),
      '2026-10-25'
    )
    await page.waitForFunction(() =>
      window.uiVerification
        .usageCalls()
        .some(
          (call) =>
            call.client === 'codex' && call.from === '2026-10-01' && call.to === '2026-10-25'
        )
    )
    await chat()
  })
  await check('重载从真实 SQLite 消息恢复入口，已删除目标显示提示', async () => {
    await page.reload()
    await button('打开Token 统计（本次筛选）').last().waitFor()
    await page.evaluate((id) => window.uiVerification.removeChatNote(id), noteId)
    await button('打开笔记「发布笔记」').last().click()
    await page.getByRole('alert').filter({ hasText: '该笔记已不存在' }).waitFor()
    assert.equal(
      await page.getByRole('heading', { name: '对话工具验收', exact: true }).isVisible(),
      true
    )
  })
  await check('三主题双尺寸的结果按钮与审批卡可见且无横向溢出', async () => {
    for (const theme of ['starry', 'graphite', 'paper']) {
      await page.evaluate(async (theme) => {
        await window.toolbox.config.set({ appearance: { theme, backgroundMotion: false } })
      }, theme)
      await page.reload()
      await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme)
      await button('打开Token 统计（本次筛选）').last().waitFor()
      const pending = call('todos_save', {
        title: '只预览不保存',
        details: '合成审批卡，拒绝后不写入'
      })
      await page.getByRole('alertdialog', { name: '需要确认的操作' }).waitFor()
      for (const size of [
        [1280, 820],
        [1024, 680]
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
          size
        )
        await button('打开Token 统计（本次筛选）').last().scrollIntoViewIfNeeded()
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true
        )
        await capture(`chat-references-${theme}-${size[0]}`)
      }
      await button('拒绝').click()
      await pending
    }
  })
}
