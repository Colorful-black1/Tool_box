/* global document:readonly, window:readonly */
const assert = require('node:assert/strict')

async function verifyToolNavigation({ page, app, check, capture }) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
  )
  await page.getByRole('button', { name: '工具', exact: true }).click()
  const search = page.getByRole('searchbox', { name: '搜索开发者工具', exact: true })
  const leaves = page.locator('.tools-tree-leaf')
  const handle = (name) => page.getByRole('button', { name: `调整${name}顺序`, exact: true })
  const savedFirst = (id) =>
    page.waitForFunction(
      async (id) => (await window.uiVerification.readConfig()).toolOrder?.[0] === id,
      id
    )
  await page.getByText('拖动右侧手柄排序 · Alt+↑/↓', { exact: true }).waitFor()

  await check('工具搜索匹配名称、用途与全半角英文，不自动切换面板', async () => {
    await page.getByRole('button', { name: 'JSON 工具箱', exact: true }).click()
    await search.fill('ＵＵＩＤ')
    assert.deepEqual(await leaves.allTextContents(), ['UUID 生成器'])
    assert.equal(await page.locator('.tool-panel-title').textContent(), 'JSON 工具箱')
    assert.equal(await handle('UUID 生成器').getAttribute('aria-disabled'), 'true')
    await search.evaluate((element) =>
      element.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
      )
    )
    assert.equal(await page.locator('.tool-panel-title').textContent(), 'JSON 工具箱')
    await search.press('Enter')
    await page.getByRole('heading', { name: 'UUID 生成器', exact: true }).waitFor()
    await search.fill('SHA-512')
    assert.deepEqual(await leaves.allTextContents(), ['哈希计算'])
    await search.fill('json 字段')
    assert.deepEqual(await leaves.allTextContents(), ['JSON 工具箱', '差异比较'])
    await capture('tools-search')
  })
  await check('无结果显示提示，Esc 或清空恢复完整目录', async () => {
    await search.fill('没有这个工具')
    await page.getByText('没有匹配的工具，试试名称、用途或英文标识。', { exact: true }).waitFor()
    assert.equal(await leaves.count(), 0)
    await search.press('Escape')
    assert.equal(await search.inputValue(), '')
    assert.equal(await leaves.count(), 14)
    await search.fill('json')
    await page.getByRole('button', { name: '清空工具搜索', exact: true }).click()
    assert.equal(await leaves.count(), 14)
  })
  await check('真实鼠标拖动调整顺序并持久化，不切换当前工具', async () => {
    await handle('UUID 生成器').dragTo(
      page.getByRole('button', { name: '正则测试', exact: true }),
      { targetPosition: { x: 24, y: 3 } }
    )
    await savedFirst('uuid')
    assert.equal(await leaves.first().textContent(), 'UUID 生成器')
    assert.equal(await page.locator('.tool-panel-title').textContent(), 'UUID 生成器')
    await capture('tools-reordered')
  })
  await check('Alt 方向键可连续排序且保留焦点，保存失败回退后可重试', async () => {
    await handle('UUID 生成器').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await savedFirst('regex')
    assert.equal(await leaves.nth(1).textContent(), 'UUID 生成器')
    assert.equal(
      await handle('UUID 生成器').evaluate((element) => element === document.activeElement),
      true
    )
    await page.evaluate(() => window.uiVerification.failNextConfigSave())
    await page.keyboard.press('Alt+ArrowUp')
    await page.getByRole('alert').filter({ hasText: '工具顺序保存失败' }).waitFor()
    assert.equal(await leaves.first().textContent(), '正则测试')
    await page.keyboard.press('Alt+ArrowUp')
    await savedFirst('uuid')
    assert.equal(await leaves.first().textContent(), 'UUID 生成器')
    assert.equal((await page.evaluate(() => window.uiVerification.readConfig())).fontSize, 23)
  })
  await check('搜索切换仍保护 Prompt 草稿，排序不更换面板或丢失输入', async () => {
    await page.getByRole('button', { name: 'Prompt 模板库', exact: true }).click()
    const body = page.getByRole('textbox', { name: '模板正文', exact: true })
    const draft = (await body.inputValue()) + '\n导航验收草稿'
    await body.fill(draft)
    await search.fill('json')
    page.once('dialog', (dialog) => dialog.dismiss())
    await search.press('Enter')
    assert.equal(await body.inputValue(), draft)
    await search.press('Escape')
    await handle('UUID 生成器').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await savedFirst('regex')
    assert.equal(await body.inputValue(), draft)
    await page.keyboard.press('Alt+ArrowUp')
    await savedFirst('uuid')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '正则测试', exact: true }).click()
  })
  for (const [name, id] of [
    ['星轨深空', 'starry'],
    ['静夜石墨', 'graphite'],
    ['晨光纸白', 'paper']
  ]) {
    await check(`${name}下工具搜索与拖动手柄布局完整`, async () => {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('button', { name, exact: true }).click()
      await page.waitForFunction((id) => document.documentElement.dataset.theme === id, id)
      await page.getByRole('button', { name: '工具', exact: true }).click()
      assert.equal(
        await page
          .locator('.viewport')
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        false
      )
      assert.equal(await leaves.first().textContent(), 'UUID 生成器')
      await capture(`tools-navigation-${id}`)
    })
  }
  await check('1024×680 下搜索与排序无横向溢出', async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 680)
    )
    assert.equal(
      await page
        .locator('.viewport')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
      false
    )
    await capture('tools-navigation-narrow')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
    )
  })
}

async function verifyToolNavigationAfterRestart(page) {
  await page.getByRole('button', { name: '工具', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.tools-tree-leaf')?.textContent === 'UUID 生成器'
  )
  assert.equal(
    await page.getByRole('searchbox', { name: '搜索开发者工具', exact: true }).inputValue(),
    ''
  )
  assert.equal((await page.evaluate(() => window.uiVerification.readConfig())).toolOrder[0], 'uuid')
}

module.exports = { verifyToolNavigation, verifyToolNavigationAfterRestart }
