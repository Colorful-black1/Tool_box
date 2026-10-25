const { withDialog } = require('./dialog.cjs')
/* global window:readonly, document:readonly, innerWidth:readonly */
const assert = require('node:assert/strict')

async function verifyConvenience({ page, app, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const draft = () => page.getByRole('textbox', { name: '编程任务草稿', exact: true })
  const flush = () => page.evaluate(() => window.uiVerification.flushDrafts())
  const config = () => page.evaluate(() => window.uiVerification.readConfig())
  await button('工具').click()
  await check('收藏独立保存，不打开工具或改变排序；目录与快捷入口统一最近记录', async () => {
    await button('收藏JSON 工具箱').waitFor({ state: 'visible' })
    const before = await page.locator('.tool-panel-title').textContent()
    await button('收藏JSON 工具箱').click()
    await page.waitForFunction(async () =>
      (await window.uiVerification.readConfig()).toolFavorites?.includes('json')
    )
    assert.equal(await page.locator('.tool-panel-title').textContent(), before)
    await button('收藏UUID 生成器').click()
    await button('JSON 工具箱').click()
    await button('UUID 生成器').click()
    await button('打开收藏的JSON 工具箱').click()
    await page.waitForFunction(
      async () => (await window.uiVerification.readConfig()).toolRecent?.[0] === 'json'
    )
    const value = await config()
    assert.equal(value.fontSize, 23)
    assert.deepEqual(value.toolRecent.slice(0, 2), ['json', 'uuid'])
    assert.equal(new Set(value.toolRecent).size, value.toolRecent.length)
  })
  await check('Ctrl+K 空输入优先收藏，搜索不重复，中文输入法确认不跳转', async () => {
    await page.keyboard.press('Control+k')
    const search = page.getByRole('combobox', { name: '搜索内容或命令' })
    assert.ok((await page.getByRole('option').first().textContent()).includes('JSON 工具箱'))
    await search.fill('UUID')
    assert.equal(await page.getByRole('option').filter({ hasText: 'UUID 生成器' }).count(), 1)
    await search.evaluate((element) =>
      element.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
      )
    )
    assert.equal(await search.isVisible(), true)
    await search.press('Enter')
    await page.getByRole('heading', { name: 'UUID 生成器', exact: true }).waitFor()
    await page.waitForFunction(
      async () => (await window.uiVerification.readConfig()).toolRecent?.[0] === 'uuid'
    )
  })
  await check('取消离开 Prompt 草稿不刷新最近记录；收藏保存失败回退并可重试', async () => {
    await button('Prompt 模板库').click()
    const body = page.getByRole('textbox', { name: '模板正文', exact: true })
    await body.fill((await body.inputValue()) + '\n收藏入口验收草稿')
    await page.waitForFunction(
      async () => (await window.uiVerification.readConfig()).toolRecent?.[0] === 'prompt'
    )
    const before = (await config()).toolRecent
    await withDialog(page, false, async () => {
      await button('打开收藏的JSON 工具箱').click()
    })
    assert.deepEqual((await config()).toolRecent, before)
    assert.ok((await body.inputValue()).includes('收藏入口验收草稿'))
    await page.evaluate(() => window.uiVerification.failNextConfigSave())
    await button('收藏正则测试').click()
    await page.getByText('收藏保存失败，已恢复；请再次点击收藏重试。', { exact: true }).waitFor()
    assert.equal((await config()).toolFavorites.includes('regex'), false)
    await button('收藏正则测试').click()
    await page.waitForFunction(async () =>
      (await window.uiVerification.readConfig()).toolFavorites?.includes('regex')
    )
    await withDialog(page, true, async () => {
      await button('打开收藏的JSON 工具箱').click()
    })
  })
  await button('编程 Agent').click()
  await check('四个 Agent 的新对话和历史草稿隔离，落库使用真实密文', async () => {
    await button('选择项目').click()
    await draft().fill('合成草稿 · OpenCode 新对话')
    await button('历史会话').click()
    await page
      .locator('.opencode-session-item')
      .filter({ hasText: 'OpenCode 原生历史标题' })
      .click()
    await draft().fill('合成草稿 · OpenCode 历史会话')
    await button('新对话').click()
    assert.equal(await draft().inputValue(), '合成草稿 · OpenCode 新对话')
    for (const name of ['Codex', 'Claude Code', 'DeepSeek Harness']) {
      const before = await page.evaluate(() => window.uiVerification.agentCalls())
      await button(name).click()
      await draft().fill(`合成草稿 · ${name} 新对话`)
      assert.deepEqual(await page.evaluate(() => window.uiVerification.agentCalls()), before)
    }
    await page
      .getByText(
        '回复提交后更新，无实时 Token 分片；可续接上下文，暂不回放旧消息。历史属于独立 acp profile。',
        { exact: true }
      )
      .waitFor()
    assert.equal(await flush(), true)
    assert.equal(await page.evaluate(() => window.uiVerification.draftStorageEncrypted()), true)
    await button('Claude Code').click()
    assert.equal(await draft().inputValue(), '合成草稿 · Claude Code 新对话')
  })
  await check('重新加载只恢复 Agent、项目与草稿，不恢复运行态或发送', async () => {
    assert.equal(await flush(), true)
    await page.reload()
    await button('编程 Agent').click()
    await page.waitForFunction(
      () => document.querySelector('#opencode-draft')?.value === '合成草稿 · Claude Code 新对话'
    )
    assert.equal(await button('Claude Code').getAttribute('aria-pressed'), 'true')
    assert.deepEqual(await page.evaluate(() => window.uiVerification.agentCalls()), [])
    assert.equal(await button('开始对话 · Claude Code').isEnabled(), true)
  })
  await check('读取失败不能覆盖旧记录，重试保留读取期间输入；保存失败可恢复', async () => {
    await page.evaluate(() => window.uiVerification.failNextDraftRead())
    await page.reload()
    await button('编程 Agent').click()
    await page
      .getByText('草稿读取失败，旧记录已保留，当前输入不会覆盖它；请重试', { exact: true })
      .waitFor()
    await button('选择项目').click()
    await draft().fill('合成草稿 · 读取期间新输入')
    assert.equal(await flush(), false)
    await button('重试保存').click()
    await page.getByText('草稿已加密保存', { exact: true }).waitFor()
    assert.equal(await draft().inputValue(), '合成草稿 · 读取期间新输入')
    await page.evaluate(() => window.uiVerification.failNextDraftSave())
    await draft().fill('合成草稿 · 保存失败仍保留')
    assert.equal(await flush(), false)
    assert.equal(await draft().inputValue(), '合成草稿 · 保存失败仍保留')
    await button('重试保存').click()
    await page.getByText('草稿已加密保存', { exact: true }).waitFor()
  })
  await check('失效历史的草稿可主动取回，清除需要确认且不触发连接', async () => {
    await page.getByRole('button', { name: /^管理草稿/ }).click()
    const row = page.locator('.agent-draft-row').filter({ hasText: 'OpenCode · 历史会话' })
    const before = await page.evaluate(() => window.uiVerification.agentCalls())
    await withDialog(page, true, async () => {
      await row.getByRole('button', { name: '取回', exact: true }).click()
    })
    assert.equal(await draft().inputValue(), '合成草稿 · OpenCode 历史会话')
    await withDialog(page, false, async () => {
      await row.getByRole('button', { name: '清除', exact: true }).click()
    })
    assert.equal(await row.count(), 1)
    await withDialog(page, true, async () => {
      await row.getByRole('button', { name: '清除', exact: true }).click()
    })
    assert.equal(await row.count(), 0)
    assert.deepEqual(await page.evaluate(() => window.uiVerification.agentCalls()), before)
    assert.equal(await flush(), true)
    await page.getByRole('button', { name: /^管理草稿/ }).click()
  })
  await check('消息可转用到 Claude 或 DSH，只填入草稿不连接目标', async () => {
    await button('历史会话').click()
    await page
      .locator('.opencode-session-item')
      .filter({ hasText: 'OpenCode 原生历史标题' })
      .click()
    const before = await page.evaluate(() => window.uiVerification.agentCalls())
    await button('其他消息转用目标').click()
    await withDialog(page, true, async () => {
      await page.getByRole('option', { name: '用于 Claude Code', exact: true }).click()
    })
    assert.ok((await draft().inputValue()).includes('已完成实现'))
    assert.deepEqual(await page.evaluate(() => window.uiVerification.agentCalls()), before)
  })
  for (const [themeName, theme] of [
    ['星轨深空', 'starry'],
    ['静夜石墨', 'graphite'],
    ['晨光纸白', 'paper']
  ]) {
    for (const [width, height] of [
      [1280, 820],
      [1024, 680]
    ]) {
      await check(
        `${themeName} ${width}×${height}：收藏、四 Agent 与草稿入口无横向溢出`,
        async () => {
          await app.evaluate(
            ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
            [width, height]
          )
          await button('设置').click()
          await button(themeName).click()
          await page.waitForFunction((id) => document.documentElement.dataset.theme === id, theme)
          await button('工具').click()
          assert.equal(
            await page
              .locator('.viewport')
              .evaluate((element) => element.scrollWidth > element.clientWidth),
            false
          )
          await capture(`convenience-tools-${theme}-${width}`)
          await button('编程 Agent').click()
          await page.waitForFunction((size) => innerWidth === size[0], [width])
          assert.equal(
            await page
              .locator('.viewport')
              .evaluate((element) => element.scrollWidth > element.clientWidth),
            false
          )
          const bounds = await draft().boundingBox()
          assert.ok(bounds.width > 150 && bounds.height >= 48)
          await capture(`convenience-agents-${theme}-${width}`)
        }
      )
    }
  }
  await button('Claude Code').click()
  await draft().fill('合成草稿 · 重启恢复')
  await check('退出刷新绕过防抖，确认最新版本已加密保存', async () => {
    assert.equal(await flush(), true)
    await page.getByText('草稿已加密保存', { exact: true }).waitFor()
  })
}

async function verifyConvenienceAfterRestart(page) {
  await page.getByRole('button', { name: '编程 Agent', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('#opencode-draft')?.value === '合成草稿 · 重启恢复'
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Claude Code', exact: true })
      .getAttribute('aria-pressed'),
    'true'
  )
  assert.deepEqual(await page.evaluate(() => window.uiVerification.agentCalls()), [])
  await page.getByRole('button', { name: '工具', exact: true }).click()
  await page.getByRole('button', { name: '打开收藏的JSON 工具箱', exact: true }).waitFor()
  const config = await page.evaluate(() => window.uiVerification.readConfig())
  assert.deepEqual(config.toolFavorites, ['json', 'uuid', 'regex'])
  assert.equal(config.fontSize, 23)
  assert.equal(config.toolOrder, undefined)
}

module.exports = { verifyConvenience, verifyConvenienceAfterRestart }
