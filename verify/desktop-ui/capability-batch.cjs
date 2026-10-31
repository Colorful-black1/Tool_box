/* global window:readonly, document:readonly, innerWidth:readonly */
const assert = require('node:assert/strict')
const { withDialog } = require('./dialog.cjs')

module.exports = async ({ page, app, check, capture }) => {
  const nav = (name) =>
    page
      .getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('button', { name, exact: true })
  const openClipboard = async () => {
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: '搜索内容或命令' }).fill('剪贴板历史')
    await page.keyboard.press('Enter')
    await page.getByRole('dialog', { name: '剪贴板历史', exact: true }).waitFor()
  }
  await nav('密码箱').click()
  await check('健康报告重复3条、弱1条、失败1条，报告无密码明文，详情跳转与焦点归还', async () => {
    await page.getByRole('button', { name: '健康检查', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '密码健康报告' })
    await sheet.getByText('共 5 条 · 解密失败 1 条', { exact: true }).waitFor()
    await sheet.getByText('第 1 组 · 3 条', { exact: true }).click()
    assert.ok((await sheet.innerText()).includes('弱密码 · 1 条'))
    assert.ok(!(await sheet.innerText()).includes('SyntheticStrong#1234'))
    await capture('capability-health-starry-1280')
    await page.keyboard.press('Escape')
    assert.equal(
      await page
        .getByRole('button', { name: '健康检查', exact: true })
        .evaluate((element) => element === document.activeElement),
      true
    )
    await page.getByRole('button', { name: '健康检查', exact: true }).click()
    await sheet.getByRole('button', { name: '待修改弱密码 · 很弱', exact: true }).click()
    await page
      .getByRole('dialog', { name: '条目详情' })
      .getByRole('heading', { name: '待修改弱密码', exact: true })
      .waitFor()
    await page.keyboard.press('Escape')
  })
  await check('健康库与空库状态明确且可关闭', async () => {
    await page.evaluate(() => window.uiVerification.healthyPasswords())
    await nav('对话').click()
    await nav('密码箱').click()
    await page.getByRole('button', { name: '健康检查', exact: true }).click()
    await page.getByText('暂未发现健康问题，继续使用不同的强密码。', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.uiVerification.emptyPasswords())
    await nav('对话').click()
    await nav('密码箱').click()
    await page.getByRole('button', { name: '健康检查', exact: true }).click()
    await page.getByText('还没有密码条目，先新增一条再检查。', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
  })
  await check('空密码独立命中重复、弱和空指标，不因分类交集漏报', async () => {
    await page.evaluate(() => window.uiVerification.emptyPasswordEntries())
    await nav('对话').click()
    await nav('密码箱').click()
    await page.getByRole('button', { name: '健康检查', exact: true }).click()
    const report = page.getByRole('dialog', { name: '密码健康报告' })
    await report.getByText('第 1 组 · 2 条', { exact: true }).waitFor()
    await report.getByRole('heading', { name: '弱密码 · 2 条', exact: true }).waitFor()
    await report.getByRole('heading', { name: '空密码 · 2 条', exact: true }).waitFor()
    await page.keyboard.press('Escape')
  })
  await check('命令入口、默认关闭与开启确认、搜索固定回填暂停清空', async () => {
    await openClipboard()
    const panel = page.getByRole('dialog', { name: '剪贴板历史', exact: true })
    await panel.getByText('记录已关闭', { exact: true }).waitFor()
    await withDialog(page, true, () =>
      panel.getByRole('button', { name: '开启记录', exact: true }).click()
    )
    await page.evaluate(() => window.uiVerification.seedClipboard())
    await panel.getByRole('textbox', { name: '搜索剪贴板历史' }).fill('第一段')
    await panel.getByRole('button', { name: '固定', exact: true }).click()
    await panel.getByRole('button', { name: '第一段日志', exact: true }).click()
    await panel.getByText('已复制', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.uiVerification.copiedText()), '第一段日志')
    await panel.getByRole('textbox', { name: '搜索剪贴板历史' }).fill('')
    assert.equal(await panel.locator('.clipboard-preview').first().innerText(), '第一段日志')
    await panel.getByRole('button', { name: '暂停记录 30 分钟', exact: true }).click()
    await panel.getByText(/已暂停，/).waitFor()
    await panel.getByText(/已截断至 10,000 字符/).waitFor()
    await capture('capability-clipboard-starry-1280')
    await withDialog(page, true, () =>
      panel.getByRole('button', { name: '清空全部', exact: true }).click()
    )
    await panel.getByText('暂无历史，开启后复制一段纯文本即可。', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
  })
  await check('文件工具分组、空状态、目录选择与展开只读重复组', async () => {
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: '搜索内容或命令' }).fill('重复文件查找')
    await page.keyboard.press('Enter')
    await page
      .getByText('先选择一个目录，再查找内容完全相同的非空文件。', { exact: true })
      .waitFor()
    await page.getByRole('button', { name: '选择目录', exact: true }).click()
    await page.getByRole('button', { name: '开始查重', exact: true }).click()
    await page.getByText('1.00 KiB · 2 份 · 可释放 1.00 KiB', { exact: true }).click()
    await page.getByText('C:/合成目录/另一个名字.txt', { exact: true }).waitFor()
    await capture('capability-duplicates-starry-1280')
  })
  await check('设置备份入口、风险提示与导出结果路径', async () => {
    await nav('设置').click()
    const card = page.getByRole('region', { name: '数据与备份', exact: true })
    await card.getByRole('button', { name: '导出本机快照', exact: true }).click()
    await card
      .getByText('本机快照已导出，仅本机可恢复。请勿上传网盘或发给他人。', { exact: true })
      .waitFor()
    await card
      .getByText('C:/Users/合成用户/Documents/Tool_box-快照-合成', { exact: true })
      .waitFor()
    await card.scrollIntoViewIfNeeded()
    await capture('capability-backup-starry-1280')
  })
  for (const theme of ['静夜石墨', '晨光纸白']) {
    await check(`${theme}与1024窄窗：剪贴板可关闭，无横向溢出`, async () => {
      await page.getByRole('button', { name: theme, exact: true }).click()
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1024, 680)
      )
      await page.waitForFunction(() => innerWidth === 1024)
      await openClipboard()
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false
      )
      await capture(`capability-clipboard-${theme === '晨光纸白' ? 'paper' : 'graphite'}-1024`)
      await page.keyboard.press('Escape')
    })
  }
}
