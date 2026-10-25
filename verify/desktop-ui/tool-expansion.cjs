const { withDialog } = require('./dialog.cjs')
/* global document:readonly, window:readonly */
const assert = require('node:assert/strict')

async function verifyToolExpansion({ page, app, check, capture }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  const text = (name) => page.getByRole('textbox', { name, exact: true })
  const choose = async (label, option) => {
    await button(label).click()
    await page.getByRole('option', { name: option, exact: true }).click()
  }
  const tool = async (name) => {
    await button('工具').click()
    await page.getByRole('searchbox', { name: '搜索开发者工具' }).fill(name)
    await page.getByRole('searchbox', { name: '搜索开发者工具' }).press('Enter')
    await page.getByRole('heading', { name, exact: true }).waitFor()
    await page.getByRole('searchbox', { name: '搜索开发者工具' }).fill('')
  }
  await check('MyBatis 批量还原与错误隔离，字符串问号不会被替换', async () => {
    await tool('MyBatis SQL 还原')
    await text('MyBatis 日志').fill(
      "Preparing: SELECT '?' AS literal, ? AS name\nParameters: O'Reilly(String)"
    )
    assert.match(await text('还原 SQL').inputValue(), /SELECT '\?' AS literal, 'O''Reilly' AS name/)
    await capture('expansion-mybatis')
    await text('MyBatis 日志').fill('Preparing: SELECT ?, ?\nParameters: 1(Integer)')
    await page.getByRole('alert').filter({ hasText: '占位符数量' }).waitFor()
    assert.equal(await text('还原 SQL').inputValue(), '')
  })
  await check('颜色输入即转换，黑白对比 21:1，无效颜色清空预览', async () => {
    await tool('颜色工具')
    await page.getByText('对比度 21.00:1', { exact: true }).waitFor()
    await text('前景色').fill('hsl(120, 100%, 50%)')
    await page.getByText('#00FF00', { exact: true }).waitFor()
    await capture('expansion-colors')
    await text('前景色').fill('invalid')
    assert.equal(await page.locator('.color-preview').count(), 0)
  })
  await check('单位区分 MiB 与 MB，进制大整数准确换算', async () => {
    await tool('单位与进制换算')
    await page.getByText('1.048576', { exact: true }).waitFor()
    await text('待换算整数').fill('9007199254740993')
    await page.getByText('20000000000001', { exact: true }).waitFor()
    await capture('expansion-converters')
  })
  await check('时区转换提示 DST 重复，显式选择后得到对应时刻', async () => {
    await tool('时间戳换算')
    await choose('源时区', 'America/New_York')
    await choose('目标时区', 'UTC')
    await text('源时区日期时间').fill('2026-11-01 01:30:00')
    await page.getByRole('alert').filter({ hasText: '夏令时重复' }).waitFor()
    await choose('夏令时重复时间', '选择较晚时刻')
    await page.getByText(/2026-11-01T06:30:00.000Z/).waitFor()
    await capture('expansion-timezones')
  })
  await check('待办快速添加、日期顺序校验与保存失败保留输入', async () => {
    await button('待办清单').click()
    await text('待办标题').fill('首批验收待办')
    await text('待办备注').fill('本地临时数据库的合成事项')
    await page.getByLabel('待办开始时间', { exact: true }).fill('2030-10-25 09:00')
    await page.getByLabel('待办截止时间', { exact: true }).fill('2030-10-24T18:00')
    await button('添加待办').click()
    await page.getByRole('alert').filter({ hasText: '开始时间不能晚于截止时间' }).waitFor()
    assert.equal(await text('待办标题').inputValue(), '首批验收待办')
    await page.getByLabel('待办截止时间', { exact: true }).fill('2030-10-25T18:00')
    await button('添加待办').click()
    await page.locator('.todo-card').filter({ hasText: '首批验收待办' }).waitFor()
    assert.equal(await text('待办标题').inputValue(), '')
    await capture('expansion-todos')
  })
  await check('待办完成／重开、归档／恢复与筛选', async () => {
    // 完成后立即退出当前筛选，click 后验证列表，避免 check 等待已移除节点。
    await page.getByRole('checkbox', { name: '完成 首批验收待办', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.todo-card').length === 0)
    await choose('待办筛选', '已完成')
    await page.getByRole('checkbox', { name: '完成 首批验收待办', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.todo-card').length === 0)
    await choose('待办筛选', '未完成')
    await withDialog(page, true, async () => {
      await button('归档').click()
    })
    await page.waitForFunction(() => document.querySelectorAll('.todo-card').length === 0)
    await choose('待办筛选', '已归档')
    await button('恢复').click()
    await choose('待办筛选', '未完成')
    await page.locator('.todo-card').waitFor()
  })
  await check('编辑草稿跨页面保留，关闭提醒可保存', async () => {
    await button('编辑').click()
    await text('待办备注').fill('修改后的合成事项')
    await button('工具').click()
    await button('待办清单').click()
    assert.equal(await text('待办备注').inputValue(), '修改后的合成事项')
    await page.getByRole('checkbox', { name: '开始／截止时通知我', exact: true }).uncheck()
    await button('保存修改').click()
    await page.locator('.todo-card').getByText('修改后的合成事项', { exact: true }).waitFor()
    await page.getByText(/提醒已关闭/).waitFor()
  })
  await check('通知点击事件打开并定位待办，可返回完整列表', async () => {
    const id = await page.locator('.todo-card').getAttribute('data-todo-id')
    await button('工具').click()
    await page.evaluate((value) => window.uiVerification.openTodo(value), id)
    await page.locator('.todo-card.highlighted').waitFor()
    assert.equal(await page.locator('.todo-card.highlighted').getAttribute('data-todo-id'), id)
    await button('返回完整列表').click()
  })
  for (const [label, theme] of [
    ['星轨深空', 'starry'],
    ['静夜石墨', 'graphite'],
    ['晨光纸白', 'paper']
  ]) {
    await check(`${label}：待办和时区在双尺寸下可用，弹层不溢出`, async () => {
      await button('设置').click()
      await button(label).click()
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
      for (const [width, height] of [
        [1280, 820],
        [1024, 680]
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
          [width, height]
        )
        await button('待办清单').click()
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        )
        await capture(`expansion-todos-${theme}-${width}`)
        await tool('时间戳换算')
        await button('源时区').click()
        const box = await page.locator('.dropdown-popover').boundingBox()
        assert.ok(
          box &&
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= width &&
            box.y + box.height <= height
        )
        await page.keyboard.press('Escape')
        await capture(`expansion-timezone-${theme}-${width}`)
      }
    })
  }
}

async function verifyTodoRestart(page) {
  await page.getByRole('button', { name: '待办清单', exact: true }).click()
  await page.locator('.todo-card').getByText('修改后的合成事项', { exact: true }).waitFor()
  assert.equal(await page.locator('.todo-card').count(), 1)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  assert.equal(
    await page.getByLabel('待办开始时间', { exact: true }).inputValue(),
    '2030-10-25 09:00'
  )
  assert.equal(
    await page.getByRole('checkbox', { name: '开始／截止时通知我', exact: true }).isChecked(),
    false
  )
}

module.exports = { verifyToolExpansion, verifyTodoRestart }
