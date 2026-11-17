/* global document:readonly, window:readonly */
const assert = require('node:assert/strict')

module.exports = async function verifyExtensions({ page, check, capture }) {
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.locator('.ext-group').first().waitFor()

  await check('技能页展示同名冲突、自带标记与 Agent 徽标', async () => {
    assert.equal(await page.locator('.ext-metric').count(), 4)
    assert.equal(await page.locator('.ext-metric').first().innerText(), '技能名\n3')
    assert.equal(await page.locator('.ext-metric').nth(2).innerText(), '同名冲突\n1')
    assert.equal(await page.locator('.ext-group').count(), 3)
    const conflict = page.locator('.ext-badge[data-tone="warn"]').first()
    assert.equal(await conflict.innerText(), '同名 2 份 · 内容不同')
    assert.equal(await page.getByText('随 Codex 自带', { exact: true }).count(), 1)
    const gamma = page.locator('.ext-group').filter({ hasText: 'gamma' })
    assert.ok((await gamma.innerText()).includes('Claude Code'))
    assert.ok((await gamma.innerText()).includes('OpenCode'))
  })
  await capture('skills-local')

  await check('关键字与 Agent 筛选只作用于本机列表', async () => {
    await page.getByLabel('筛选本机技能').fill('gamma')
    await page.waitForFunction(() => document.querySelectorAll('.ext-group').length === 1)
    await page.getByLabel('筛选本机技能').fill('')
    await page.waitForFunction(() => document.querySelectorAll('.ext-group').length === 3)
    await page.getByRole('button', { name: '按 Agent 筛选技能' }).click()
    await page.getByRole('option', { name: 'Codex', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.ext-group').length === 1)
    await page.getByRole('button', { name: '按 Agent 筛选技能' }).click()
    await page.getByRole('option', { name: '全部 Agent', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.ext-group').length === 3)
  })

  await check('复制技能路径走系统剪贴板', async () => {
    await page.locator('.ext-copy').first().getByRole('button', { name: '复制路径' }).click()
    await page.getByRole('button', { name: '已复制' }).first().waitFor()
    const copied = await page.evaluate(() => window.uiVerification.copiedText())
    assert.ok(copied.endsWith('SKILL.md'))
  })

  await check('技能页将本机看板与在线搜索拆成两个页签', async () => {
    assert.equal(await page.getByRole('tab').count(), 2)
    assert.equal(
      await page.getByRole('tab', { name: '本机技能' }).getAttribute('aria-selected'),
      'true'
    )
    await page.getByRole('tab', { name: '在线搜索' }).click()
    await page.getByLabel('搜索在线技能').waitFor()
    assert.equal(await page.locator('.ext-filters').count(), 0)
    assert.equal(await page.locator('.ext-group').count(), 0)
  })

  await check('在线搜索给出可复制的安装命令并支持翻页', async () => {
    await page.getByLabel('搜索在线技能').fill('pdf')
    await page.locator('.ext-search-form').getByRole('button', { name: '搜索' }).click()
    await page.locator('.ext-result').first().waitFor()
    assert.equal(await page.locator('.ext-result').count(), 1)
    assert.ok(
      (await page.locator('.ext-result').innerText()).includes(
        'npx skills add anthropics/skills --skill pdf -g'
      )
    )
    await page.getByRole('button', { name: '复制命令' }).click()
    assert.equal(
      await page.evaluate(() => window.uiVerification.copiedText()),
      'npx skills add anthropics/skills --skill pdf -g'
    )
    await page.getByRole('button', { name: '加载更多' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.ext-result').length === 2)
    const calls = await page.evaluate(() => window.uiVerification.extensionCalls())
    assert.equal(calls.skill.length, 2)
    assert.equal(calls.skill[0].query, 'pdf')
  })
  await capture('skills-search')

  await page.getByRole('button', { name: 'MCP', exact: true }).click()
  await page.locator('.ext-group').first().waitFor()

  await check('MCP 页展示传输方式、环境变量名与禁用状态', async () => {
    assert.equal(await page.getByRole('tab').count(), 2)
    assert.equal(
      await page.getByRole('tab', { name: '本机 MCP' }).getAttribute('aria-selected'),
      'true'
    )
    assert.equal(await page.locator('.ext-metric').first().innerText(), '配置条数\n3')
    assert.equal(await page.locator('.ext-metric').nth(1).innerText(), '不同服务\n2')
    assert.equal(await page.locator('.ext-group').count(), 2)
    assert.equal(await page.getByText('启动方式不同', { exact: true }).count(), 1)
    const repl = page.locator('.ext-group').filter({ hasText: 'node_repl' })
    assert.ok((await repl.innerText()).includes('env：TOKEN'))
    assert.ok((await repl.innerText()).includes('已禁用'))
    // 只展示变量名，不展示值；界面上不应出现 KEY=值 形态。
    const body = await page.locator('.ext-page').innerText()
    assert.ok(body.includes('env：SECRET_TOKEN'))
    assert.equal(/SECRET_TOKEN\s*=/.test(body), false)
  })
  await capture('mcp-local')

  await check('MCP 在线搜索可复制启动命令与配置片段', async () => {
    await page.getByRole('tab', { name: '在线搜索' }).click()
    assert.equal(await page.locator('.ext-group').count(), 0)
    await page.locator('.ext-search-form').getByRole('button', { name: '搜索' }).click()
    await page.locator('.ext-result').first().waitFor()
    assert.ok(
      (await page.locator('.ext-result').first().innerText()).includes(
        'npx -y remote-filesystem-mcp-server@0.1.2'
      )
    )
    assert.ok((await page.locator('.ext-snippet').first().innerText()).includes('GCS_BUCKET'))
    await page.getByRole('button', { name: '复制配置' }).first().click()
    const copied = await page.evaluate(() => window.uiVerification.copiedText())
    assert.ok(copied.includes('"mcpServers"'))
    await page.getByRole('button', { name: '加载更多' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.ext-result').length === 2)
    assert.ok((await page.locator('.ext-result').nth(1).innerText()).includes('mcp.example.com'))
  })
  await capture('mcp-search')

  await page.getByRole('button', { name: '设置', exact: true }).click()
  const roots = page.locator('section[aria-label="技能扫描路径"]')
  await roots.waitFor()

  await check('设置页可添加与删除自定义技能路径', async () => {
    assert.equal(await roots.locator('.skill-root-chip').count(), 5)
    assert.ok((await roots.innerText()).includes('尚未添加自定义路径'))
    await roots.getByLabel('新增技能扫描路径').fill('~/.cc-switch/skills')
    await roots.getByRole('button', { name: '添加路径' }).click()
    await roots.locator('.skill-root-row code', { hasText: '~/.cc-switch/skills' }).waitFor()
    assert.ok((await roots.innerText()).includes('已添加'))
    await roots.getByRole('button', { name: '删除' }).click()
    await roots.getByText('尚未添加自定义路径').waitFor()
  })
  await capture('settings-skill-roots')
}
