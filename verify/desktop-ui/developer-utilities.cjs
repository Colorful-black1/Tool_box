/* global document:readonly, window:readonly */
const assert = require('node:assert/strict')
const { rootCertificates } = require('node:tls')
const { X509Certificate } = require('node:crypto')
const { Buffer } = require('node:buffer')

module.exports = async function verifyDeveloperUtilities({ page, app, check, capture }) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
  )
  const button = (name) => page.getByRole('button', { name, exact: true })
  const textbox = (name) => page.getByRole('textbox', { name, exact: true })
  const choose = async (name, option) => {
    await button(name).click()
    await page.getByRole('option', { name: option, exact: true }).click()
  }
  const open = async (name) => {
    await page.getByRole('searchbox', { name: '搜索开发者工具' }).fill(name)
    await page.getByRole('searchbox', { name: '搜索开发者工具' }).press('Enter')
    await page.getByRole('heading', { name, exact: true }).waitFor()
    await page.getByRole('searchbox', { name: '搜索开发者工具' }).fill('')
  }
  await button('工具').click()
  await check('Cron 三种格式、字段说明、未来时间和非法字段反馈', async () => {
    await open('Cron 计算器')
    await button('表达式解析').click()
    await page.getByLabel('计算起点', { exact: true }).fill('2026-10-22 08:00:00')
    await button('计算执行时间').click()
    assert.equal(
      await page.getByRole('list', { name: '执行时间' }).getByRole('listitem').count(),
      10
    )
    await page.getByText('2026-10-22 09:00:00 +08:00', { exact: true }).waitFor()
    await capture('tools-cron')
    await choose('Cron 格式', 'Quartz · 六/七段')
    assert.equal(await page.getByRole('list', { name: '执行时间' }).count(), 0)
    await button('计算执行时间').click()
    await page.getByRole('alert').filter({ hasText: '只能有一个' }).waitFor()
    await textbox('Cron 表达式').fill('0 0 9 ? * MON-FRI')
    await button('计算执行时间').click()
    await page.getByRole('list', { name: '执行时间' }).waitFor()
    await choose('Cron 格式', 'Unix · 五段')
    await textbox('Cron 表达式').fill('0 9 * * MON-FRI')
    await button('计算执行时间').click()
    await page.getByRole('list', { name: '执行时间' }).waitFor()
  })
  await check('Cron 可视化间隔生成并带回表达式解析', async () => {
    await open('Cron 计算器')
    await choose('Cron 格式', 'Spring · 六段')
    await button('可视化生成').click()
    await choose('分钟模式', '间隔')
    await page.getByLabel('分钟间隔起点', { exact: true }).fill('0')
    await page.getByLabel('分钟间隔值', { exact: true }).fill('15')
    await page.getByText('0 0/15 9 * * MON-FRI', { exact: true }).waitFor()
    await capture('tools-cron-builder')
    await button('填入表达式并计算').click()
    assert.equal(await textbox('Cron 表达式').inputValue(), '0 0/15 9 * * MON-FRI')
    await page.getByRole('list', { name: '执行时间' }).waitFor()
    await capture('tools-cron-builder-applied')
  })
  await check('Spring 配置保留占位符与长整数，转换、比较和拒绝不支持的语法', async () => {
    await open('Spring 配置工具')
    await button('填入配置示例').click()
    await button('转换配置').click()
    assert.match(await textbox('Properties 结果').inputValue(), /app.ids\[0\]=9223372036854775807/)
    assert.match(await textbox('Properties 结果').inputValue(), /\$\{DB_URL/)
    await capture('tools-spring-config')
    await choose('配置操作', '配置比较')
    await textbox('左侧配置').fill('server:\n  port: 8080')
    await textbox('右侧参考配置').fill('server:\n  port: 9090\nonly: test')
    await button('比较配置').click()
    assert.match(await textbox('配置差异').inputValue(), /值不同 {2}server.port/)
    assert.match(await textbox('配置差异').inputValue(), /仅右侧 {2}only/)
    await textbox('左侧配置').fill('a: &anchor 1')
    assert.equal(await textbox('配置差异').inputValue(), '')
    await button('比较配置').click()
    await page.getByRole('alert').filter({ hasText: '暂不支持' }).waitFor()
  })
  await check('JWT 解码明确提示未验签与过期，修改后清空结果且不调用 AI', async () => {
    await open('JWT／证书查看器')
    const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"sub":"合成用户","exp":1}').toString('base64url')}.YWJj`
    await textbox('JWT 令牌').fill(token)
    await button('解码 JWT').click()
    assert.match(await textbox('JWT 解码结果').inputValue(), /合成用户/)
    await page.getByText('签名未验证，不能据此判断令牌真实有效', { exact: true }).waitFor()
    await page.getByText('令牌已过期（exp）', { exact: true }).waitFor()
    await capture('tools-jwt')
    await textbox('JWT 令牌').fill('invalid')
    assert.equal(await textbox('JWT 解码结果').inputValue(), '')
    await button('解码 JWT').click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.uiVerification.polishCount()), 0)
  })
  await check('证书支持 PEM 与 DER 文件，拒绝私钥，切换类型清除输入', async () => {
    await choose('查看类型', 'X.509 证书')
    await textbox('证书内容').fill(rootCertificates[0])
    await button('查看证书').click()
    await page.waitForFunction(() =>
      document.querySelector('textarea[aria-label="证书详情"]')?.value.includes('SHA-256 指纹')
    )
    await capture('tools-certificate')
    await page
      .getByLabel('选择证书文件', { exact: true })
      .setInputFiles({
        name: 'public.cer',
        mimeType: 'application/pkix-cert',
        buffer: new X509Certificate(rootCertificates[0]).raw
      })
    await page.waitForFunction(() =>
      document.querySelector('textarea[aria-label="证书内容"]')?.value.startsWith('MI')
    )
    await button('查看证书').click()
    await page.waitForFunction(() =>
      document.querySelector('textarea[aria-label="证书详情"]')?.value.includes('SHA-256 指纹')
    )
    await textbox('证书内容').fill('-----BEGIN PRIVATE KEY-----')
    await button('查看证书').click()
    await page.getByRole('alert').filter({ hasText: '检测到私钥' }).waitFor()
    await choose('查看类型', 'JWT 解码')
    assert.equal(await textbox('JWT 令牌').inputValue(), '')
  })
  await check('我的 IP 手动查询端口，支持 IPv6、监听过滤、进程筛选、复制与失败重试', async () => {
    await open('我的 IP')
    assert.equal(await page.getByRole('table', { name: '端口占用列表' }).count(), 0)
    await button('查询端口占用').click()
    const table = page.getByRole('table', { name: '端口占用列表' })
    await table.getByText('java', { exact: true }).waitFor()
    assert.equal(await table.getByRole('row').count(), 3)
    await page.getByRole('checkbox', { name: '仅 TCP 监听与 UDP 绑定' }).uncheck()
    assert.equal(await table.getByRole('row').count(), 4)
    await textbox('筛选端口或进程').fill('java')
    assert.equal(await table.getByRole('row').count(), 2)
    await button('复制筛选结果').click()
    assert.match(await page.evaluate(() => window.uiVerification.copiedText()), /8080.*1200.*java/)
    await capture('tools-ports')
    await page.evaluate(() => window.uiVerification.failNextPorts())
    await button('查询端口占用').click()
    await page.getByRole('alert').filter({ hasText: '无法读取端口占用' }).waitFor()
    assert.equal(await table.count(), 0)
    await button('查询端口占用').click()
    await table.getByText('java', { exact: true }).waitFor()
  })
  for (const [label, theme] of [
    ['星轨深空', 'starry'],
    ['静夜石墨', 'graphite'],
    ['晨光纸白', 'paper']
  ]) {
    await check(`新增工具在${label}下布局不溢出，主题下拉可操作`, async () => {
      await button('设置').click()
      await button(label).click()
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
      await button('工具').click()
      await open('Cron 计算器')
      await button('Cron 格式').click()
      const menu = page.getByRole('listbox', { name: 'Cron 格式' })
      await menu.waitFor()
      const box = await menu.boundingBox()
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 820)
      await page.keyboard.press('Escape')
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= 1280)
      assert.ok(fits)
      await capture(`tools-cron-${theme}`)
    })
  }
}
