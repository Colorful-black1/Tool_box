/* global document:readonly, window:readonly, innerWidth:readonly */
const assert = require('node:assert/strict')
const { withDialog } = require('./dialog.cjs')

async function verifyDeveloperCommands({ page, app, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const text = (name) => page.getByRole('textbox', { name, exact: true })
  const entry = () => page.locator('.command-entry').filter({ hasText: '验收多行命令' })
  const command = '  echo "中文"\n\tprintf \'\\n\'  \n'
  await check('独立入口、用途多词搜索和分类筛选', async () => {
    await page.locator('.composer-input').waitFor()
    await button('命令速查').waitFor()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: '搜索内容或命令' }).fill('打开命令速查')
    await page.getByRole('option').first().waitFor()
    await page.keyboard.press('Enter')
    await button('新增命令').waitFor({ state: 'visible' })
    await text('搜索命令').fill('容器 日志')
    await page.getByRole('heading', { name: '跟踪容器日志', exact: true }).waitFor()
    assert.equal(await page.locator('.command-entry').count(), 1)
    await button('Linux').click()
    await page.getByText('没有匹配的命令', { exact: true }).waitFor()
    await button('清空筛选').click()
  })
  await check('新增多行原文，经真实 IPC 和隔离 SQLite 保存', async () => {
    await button('新增命令').click()
    await page.getByLabel('标题', { exact: true }).fill('验收多行命令')
    await page.getByLabel('命令', { exact: true }).fill(command)
    await page.getByLabel('用途说明', { exact: true }).fill('本地合成记录，不执行任何命令')
    await page.getByLabel('标签', { exact: true }).fill('中文，多行')
    await button('保存').click()
    await page.getByRole('dialog', { name: '新增命令' }).waitFor({ state: 'hidden' })
    await text('搜索命令').fill('验收多行命令')
    assert.equal(await entry().locator('code').textContent(), command)
    const stored = await page.evaluate(() => window.toolbox.developerCommands.read())
    assert.equal(stored.entries[0].command, command)
  })
  await check('复制严格保持空白与多行，收藏切页后保留', async () => {
    await button('复制：验收多行命令').click()
    await page.getByText('已复制', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.uiVerification.copiedText()), command)
    await button('收藏：验收多行命令').click()
    await button('取消收藏：验收多行命令').waitFor()
    await button('收藏').click()
    assert.equal(await entry().count(), 1)
    await button('Token 统计').click()
    await button('命令速查').click()
    assert.equal(await text('搜索命令').inputValue(), '验收多行命令')
  })
  await check('取消编辑需确认并保留原命令', async () => {
    await button('更多：验收多行命令').click()
    await page.getByRole('option', { name: '编辑', exact: true }).click()
    await page.getByLabel('命令', { exact: true }).fill('未保存的修改')
    await withDialog(page, false, () => button('取消').click())
    assert.equal(await page.getByLabel('命令', { exact: true }).inputValue(), '未保存的修改')
    await withDialog(page, true, () => button('取消').click())
    assert.equal(await entry().locator('code').textContent(), command)
  })
  await check('磁盘保存失败不丢输入，重试成功', async () => {
    await button('更多：验收多行命令').click()
    await page.getByRole('option', { name: '编辑', exact: true }).click()
    await page.getByLabel('用途说明', { exact: true }).fill('保存重试后的说明')
    await page.evaluate(() => window.uiVerification.failNextCommandSave())
    await button('保存').click()
    await page.getByRole('dialog').getByRole('alert').filter({ hasText: '保存失败' }).waitFor()
    assert.equal(
      await page.getByLabel('用途说明', { exact: true }).inputValue(),
      '保存重试后的说明'
    )
    await button('保存').click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
  })
  await check('原生 IPC 拒绝过期版本，刷新核对后才能继续保存', async () => {
    await button('更多：验收多行命令').click()
    await page.getByRole('option', { name: '编辑', exact: true }).click()
    await page.getByLabel('用途说明', { exact: true }).fill('我的修改')
    await page.evaluate(async () => {
      const snapshot = await window.toolbox.developerCommands.read()
      const saved = snapshot.entries[0]
      await window.toolbox.developerCommands.save({
        ...saved,
        description: '其他窗口更新',
        expectedRevision: snapshot.revision
      })
    })
    await button('保存').click()
    await page.getByRole('dialog').getByRole('alert').filter({ hasText: '命令库已变化' }).waitFor()
    await button('刷新核对').click()
    await page.getByText(/其他窗口更新/).waitFor()
    assert.equal(await button('保存').isDisabled(), true)
    await button('已核对，保留我的修改').click()
    await button('保存').click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
  })
  await check('归档隐藏收藏，恢复保留原文和收藏', async () => {
    await button('更多：验收多行命令').click()
    await withDialog(page, true, () =>
      page.getByRole('option', { name: '归档', exact: true }).click()
    )
    await page.getByText('没有匹配的命令', { exact: true }).waitFor()
    await button('归档').click()
    await entry().getByRole('button', { name: '恢复', exact: true }).click()
    await button('收藏').click()
    await button('取消收藏：验收多行命令').waitFor()
    assert.equal(await entry().locator('code').textContent(), command)
  })
  await check('内置另存为个人命令，不改内置；非法输入不写入', async () => {
    await button('清空筛选').click()
    await text('搜索命令').fill('查看所有容器')
    await button('更多：查看所有容器').click()
    await page.getByRole('option', { name: '另存为我的命令', exact: true }).click()
    await page.getByLabel('标题', { exact: true }).fill('我的容器列表')
    await button('保存').click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    const result = await page.evaluate(async () => {
      const before = await window.toolbox.developerCommands.read()
      try {
        await window.toolbox.developerCommands.save({
          ...before.entries[0],
          shell: 'invalid',
          expectedRevision: before.revision
        })
        return false
      } catch {
        return (await window.toolbox.developerCommands.read()).revision === before.revision
      }
    })
    assert.equal(result, true)
    assert.equal(await page.getByRole('heading', { name: '查看所有容器', exact: true }).count(), 1)
  })
  await check('Ctrl+F 聚焦搜索、标题键盘导航和三主题双尺寸布局', async () => {
    await button('清空筛选').click()
    await page.keyboard.press('Control+f')
    assert.equal(
      await text('搜索命令').evaluate((element) => element === document.activeElement),
      true
    )
    await text('搜索命令').fill('容器')
    const titles = page.locator('.command-entry-title')
    await titles.first().focus()
    await page.keyboard.press('ArrowDown')
    assert.equal(
      await titles.nth(1).evaluate((element) => element === document.activeElement),
      true
    )
    await page.keyboard.press('Enter')
    assert.equal(await titles.nth(1).getAttribute('aria-expanded'), 'true')
    for (const theme of ['starry', 'graphite', 'paper']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value
      }, theme)
      for (const [width, height] of [
        [1280, 820],
        [1024, 680]
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
          [width, height]
        )
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false
        )
        await capture(`commands-${theme}-${width}`)
      }
    }
    await button('新增命令').click()
    await button('适用 Shell').click()
    await capture('commands-editor-menu-paper-1024')
    await page.keyboard.press('Escape')
    await button('关闭命令编辑').click()
  })
}

async function verifyDeveloperCommandsRestart(page) {
  await page.getByRole('button', { name: '命令速查', exact: true }).click()
  await page.getByRole('button', { name: '我的', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索命令', exact: true }).fill('验收多行命令')
  await page.getByRole('button', { name: '取消收藏：验收多行命令', exact: true }).waitFor()
  const snapshot = await page.evaluate(() => window.toolbox.developerCommands.read())
  assert.equal(snapshot.entries.length, 2)
  assert.equal(snapshot.entries[0].description, '我的修改')
}

module.exports = { verifyDeveloperCommands, verifyDeveloperCommandsRestart }
