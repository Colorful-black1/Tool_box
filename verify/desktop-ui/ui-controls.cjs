/* global document:readonly, window:readonly */
const assert = require('node:assert/strict')

/** 隔离用户目录，覆盖公共控件的真实键盘/弹层行为，不调用模型。 */
module.exports = async function verifyUiControls({ page, app, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const tool = async (name) => {
    await button('工具').click()
    await button(name).click()
  }
  const fits = async () => {
    const box = await page.locator('.ui-popover').boundingBox()
    const size =
      page.viewportSize() ??
      (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
    assert.ok(
      box &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= size.width + 1 &&
        box.y + box.height <= size.height + 1
    )
  }
  await check('日期直接输入、闰日、日历方向键与时间精度', async () => {
    await button('待办清单').click()
    await page.getByRole('textbox', { name: '待办标题', exact: true }).fill('日期控件校验')
    const start = page.getByRole('textbox', { name: '待办开始时间', exact: true })
    await start.fill('2026-02-30 09:00')
    await start.press('Tab')
    assert.equal(await start.getAttribute('aria-invalid'), 'true')
    assert.equal(await button('添加待办').isDisabled(), true)
    await start.fill('2028-02-29 09:37')
    assert.equal(await button('添加待办').isEnabled(), true)
    await button('选择待办开始时间').click()
    await page.getByRole('gridcell', { name: '2028-02-29', exact: true }).waitFor()
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('data-date') === '2028-02-29'
    )
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('data-date') === '2028-03-01'
    )
    await page.keyboard.press('Enter')
    assert.equal(await start.inputValue(), '2028-03-01 09:37')
    await button('选择待办开始时间').click()
    await page.keyboard.press('PageUp')
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('data-date') === '2028-02-01'
    )
    await page.keyboard.press('Enter')
    assert.equal(await start.inputValue(), '2028-02-01 09:37')
    await start.fill('1970-01-01 09:00')
    await button('选择待办开始时间').click()
    assert.equal(
      await page.getByRole('gridcell', { name: '1969-12-31', exact: true }).isDisabled(),
      true
    )
    await page.keyboard.press('ArrowLeft')
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-date')),
      '1970-01-01'
    )
    await button('清空').click()
    assert.equal(await start.inputValue(), '')
    await tool('Cron 计算器')
    const cron = page.getByRole('textbox', { name: '计算起点', exact: true })
    await cron.fill('2026-10-25 08:30:59')
    await button('选择计算起点').click()
    assert.equal(
      await page.getByRole('textbox', { name: '计算起点时刻', exact: true }).inputValue(),
      '08:30:59'
    )
    await page.keyboard.press('Escape')
    assert.equal(
      await button('选择计算起点').evaluate((node) => document.activeElement === node),
      true
    )
  })
  await check('下拉键盘选择、长列表过滤、空结果与焦点返回', async () => {
    await tool('单位与进制换算')
    const category = button('单位类别')
    await category.focus()
    await category.press('ArrowDown')
    await page.keyboard.press('End')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowDown')
    const selected = await page
      .locator('.ui-dropdown-item.highlighted .ui-dropdown-item-label')
      .innerText()
    await page.keyboard.press('Enter')
    assert.ok((await category.innerText()).includes(selected.trim()))
    await tool('时间戳换算')
    await button('源时区').click()
    const search = page.getByRole('combobox', { name: '源时区 过滤', exact: true })
    await search.fill('no-such-zone')
    await page.getByText('暂无可选项', { exact: true }).waitFor()
    await search.fill('America/New_York')
    assert.equal(await page.getByRole('option').count(), 1)
    await fits()
    await page.keyboard.press('Enter')
    assert.equal(await button('源时区').evaluate((node) => document.activeElement === node), true)
    await button('源时区').click()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.ui-popover').count(), 0)
    await button('源时区').click()
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('.ui-popover').count(), 0)
    await button('源时区').click()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: '搜索内容或命令', exact: true }).waitFor()
    assert.equal(await page.locator('.ui-popover').count(), 0)
    await page.keyboard.press('Escape')
  })
  await check('主题输入框、分组可见入口、嵌套确认与焦点限制', async () => {
    await button('书架').click()
    await button('＋ 新建').click()
    const dialog = page.locator('[data-app-dialog]')
    await dialog.getByRole('textbox', { name: '输入内容' }).fill('控件验收分组')
    await page.keyboard.press('Escape')
    assert.equal(await button('控件验收分组').count(), 0)
    assert.equal(await button('＋ 新建').evaluate((node) => document.activeElement === node), true)
    await button('＋ 新建').click()
    await dialog.getByRole('textbox').fill('控件验收分组')
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await button('管理分组 控件验收分组').click()
    const manage = page.getByRole('dialog', { name: '分组管理', exact: true })
    await manage.getByRole('button', { name: '删除分组', exact: true }).click()
    await dialog.waitFor()
    await page.keyboard.press('Tab')
    assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true)
    await page.keyboard.press('Escape')
    assert.equal(await manage.isVisible(), true)
    await page.keyboard.press('Escape')
    await manage.waitFor({ state: 'hidden' })
    assert.equal(
      await button('管理分组 控件验收分组').evaluate((node) => document.activeElement === node),
      true
    )
  })
  await check('UUID 步进、边界禁用和无效输入不生成', async () => {
    await tool('UUID 生成器')
    const input = page.getByRole('spinbutton', { name: '生成数量', exact: true })
    await input.fill('1')
    assert.equal(await button('减少生成数量').isDisabled(), true)
    await button('增加生成数量').click()
    assert.equal(await input.inputValue(), '2')
    await input.fill('')
    assert.equal(await button('生成').isDisabled(), true)
    await input.fill('1000')
    assert.equal(await button('增加生成数量').isDisabled(), true)
  })
  await check('滑块保留原生键盘操作，弹窗焦点不逃到背景', async () => {
    await button('密码箱').click()
    await button('＋ 新增条目').click()
    const editor = page.getByRole('dialog', { name: '密码编辑', exact: true })
    const slider = page.getByRole('slider', { name: '生成密码的长度', exact: true })
    await slider.focus()
    const previous = Number(await slider.inputValue())
    await slider.press('ArrowRight')
    assert.equal(Number(await slider.inputValue()), previous + 1)
    await slider.press('Tab')
    assert.equal(await editor.evaluate((node) => node.contains(document.activeElement)), true)
    await capture('controls-slider')
    await page.keyboard.press('Escape')
    await editor.waitFor({ state: 'hidden' })
    assert.equal(await button('＋ 新增条目').evaluate((node) => document.activeElement === node), true)
  })
  for (const [theme, label] of [
    ['starry', '星轨深空'],
    ['graphite', '静夜石墨'],
    ['paper', '晨光纸白']
  ]) {
    await check(`${label}：双尺寸日历、下拉、确认框与复选框`, async () => {
      await button('设置').click()
      await button(label).click()
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
      assert.equal(await page.locator('select').count(), 0)
      for (const size of [
        [1280, 820],
        [1024, 680]
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, dimensions) =>
            BrowserWindow.getAllWindows()[0].setContentSize(...dimensions),
          size
        )
        await button('待办清单').click()
        await button('选择待办截止时间').click()
        await fits()
        await capture(`controls-calendar-${theme}-${size[0]}`)
        await page.keyboard.press('Escape')
        await tool('时间戳换算')
        await button('源时区').click()
        await fits()
        await capture(`controls-dropdown-${theme}-${size[0]}`)
        await page.keyboard.press('Escape')
        await button('书架').click()
        await button('＋ 新建').click()
        await capture(`controls-dialog-${theme}-${size[0]}`)
        await page.keyboard.press('Escape')
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true
        )
      }
    })
  }
}
