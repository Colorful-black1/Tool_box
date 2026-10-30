const { withDialog } = require('./dialog.cjs')
/** npm run build 后执行：node verify/desktop-ui/run.cjs */
/* global document:readonly, window:readonly, Event:readonly, innerWidth:readonly, innerHeight:readonly */
// 上述浏览器全局只在 Playwright 的页面回调中使用，不在 Node 侧读取。
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('playwright')
const verifyThemes = require('./themes.cjs')
const verifyUiControls = require('./ui-controls.cjs')
const verifyChatTools = require('./chat-tools.cjs')
const verifyOpenCode = require('./opencode.cjs')
const verifyCodingAgents = require('./coding-agents.cjs')
const verifyAgentUsage = require('./agent-usage.cjs')
const verifySidebarNavigation = require('./sidebar-navigation.cjs')
const verifyIpPrompt = require('./ip-prompt.cjs')
const verifyAiStream = require('./ai-stream.cjs')
const verifyDeveloperUtilities = require('./developer-utilities.cjs')
const { verifyDeveloperCommands, verifyDeveloperCommandsRestart } = require('./developer-commands.cjs')
const { verifyToolExpansion, verifyTodoRestart } = require('./tool-expansion.cjs')
const { verifyConvenience, verifyConvenienceAfterRestart } = require('./desktop-convenience.cjs')
const { verifyToolNavigation, verifyToolNavigationAfterRestart } = require('./tool-navigation.cjs')
const { verifyDevTools, verifyTemplatesAfterRestart } = require('./dev-tools.cjs')

async function main() {
  const tempRoot = path.resolve(os.tmpdir())
  const profile = await fs.mkdtemp(path.join(tempRoot, 'toolbox-ui-'))
  const env = { ...process.env, TOOLBOX_UI_VERIFY_PROFILE: profile }
  if (process.argv.includes('--agent-usage-only')) env.TOOLBOX_USAGE_VERIFY = '1'
  if (process.argv.includes('--chat-tools-only')) {
    env.TOOLBOX_CHAT_TOOLS_VERIFY = '1'
    env.TOOLBOX_USAGE_VERIFY = '1'
  }
  if (
    process.argv.includes('--coding-agents-only') ||
    process.argv.includes('--agent-actions-only') ||
    process.argv.includes('--agent-parallel-only') ||
    process.argv.includes('--agent-basics-only') ||
    process.argv.includes('--agent-projects-only')
  )
    env.TOOLBOX_CODING_AGENT_VERIFY = '1'
  if (process.argv.includes('--convenience-only')) env.TOOLBOX_CONVENIENCE_VERIFY = '1'
  delete env.ELECTRON_RUN_AS_NODE
  let app
  const passed = []
  try {
    app = await _electron.launch({ args: [path.join(__dirname, 'main.cjs')], env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(10000)
    const errors = []
    const artifactDir = path.join(__dirname, '../../.playwright-mcp/desktop-ui')
    const capture = async (name) => {
      if (!process.argv.includes('--screenshots')) return
      await fs.mkdir(artifactDir, { recursive: true })
      await page.screenshot({ path: path.join(artifactDir, `${name}.png`), animations: 'disabled' })
    }
    page.on('pageerror', (error) => errors.push(error.message))
    const check = async (name, action) => {
      try {
        await action()
      } catch (error) {
        process.stderr.write(`FAIL ${name}\n`)
        await capture('failed-check')
        throw error
      }
      passed.push(name)
      process.stdout.write(`PASS ${name}\n`)
    }
    const search = async (query) => {
      await page.keyboard.press('Control+k')
      await page.getByRole('combobox', { name: '搜索内容或命令' }).fill(query)
      await page.getByRole('option').first().waitFor()
    }
    const select = () => page.keyboard.press('Enter')
    const bottom = () =>
      page.waitForFunction(() => {
        const element = document.querySelector('.message-list')
        return element && element.scrollHeight - element.clientHeight - element.scrollTop < 2
      })

    if (process.argv.includes('--commands-only')) {
      await verifyDeveloperCommands({ page, app, check, capture })
      await check('命令库完整重启后恢复个人记录与收藏', async () => {
        await app.close()
        app = await _electron.launch({ args: [path.join(__dirname, 'main.cjs')], env })
        const restarted = await app.firstWindow()
        restarted.on('pageerror', (error) => errors.push(error.message))
        await verifyDeveloperCommandsRestart(restarted)
      })
      assert.deepEqual(errors, [])
      process.stdout.write(`命令速查验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--chat-tools-only')) {
      await verifyChatTools({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`对话五项能力验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--ui-controls-only')) {
      await verifyUiControls({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`桌面控件验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--tool-expansion-only')) {
      await verifyToolExpansion({ page, app, check, capture })
      await check('待办完整退出重启后仍保留，编辑完成和提醒开关持久化', async () => {
        await app.close()
        app = await _electron.launch({ args: [path.join(__dirname, 'main.cjs')], env })
        const restarted = await app.firstWindow()
        restarted.on('pageerror', (error) => errors.push(error.message))
        await verifyTodoRestart(restarted)
      })
      assert.deepEqual(errors, [])
      process.stdout.write(`首批工具与待办验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--convenience-only')) {
      await verifyConvenience({ page, app, check, capture })
      await check('完整退出并重启后收藏与草稿恢复，不创建连接或任务', async () => {
        await app.close()
        app = await _electron.launch({ args: [path.join(__dirname, 'main.cjs')], env })
        const restarted = await app.firstWindow()
        restarted.on('pageerror', (error) => errors.push(error.message))
        await verifyConvenienceAfterRestart(restarted)
      })
      assert.deepEqual(errors, [])
      process.stdout.write(`桌面便捷功能验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--agent-usage-only')) {
      await verifyAgentUsage({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`Token 统计验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--agent-basics-only')) {
      await require('./agent-basics.cjs')({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`Agent 基础交互验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--agent-actions-only')) {
      await require('./agent-actions.cjs')({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`Agent 快捷操作验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--agent-projects-only')) {
      await require('./agent-projects.cjs')({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`Agent 项目记忆与转用验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--agent-parallel-only')) {
      await require('./agent-parallel.cjs')({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`Agent 多项目并行验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--coding-agents-only')) {
      await verifyCodingAgents({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`统一编程工作台验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--developer-utilities-only')) {
      await verifyDeveloperUtilities({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`开发工具扩展验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }

    if (process.argv.includes('--ai-stream-only')) {
      await verifyAiStream({ page, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`AI 流式验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }

    if (process.argv.includes('--ip-prompt-only')) {
      await verifyIpPrompt({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`IP 与提示词美化验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }

    if (process.argv.includes('--sidebar-only')) {
      await verifySidebarNavigation({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`侧栏导航验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }

    if (process.argv.includes('--opencode-only')) {
      await verifyOpenCode({ page, app, check, capture })
      assert.deepEqual(errors, [])
      process.stdout.write(`OpenCode 验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }

    if (process.argv.includes('--tool-navigation-only')) {
      await verifyToolNavigation({ page, app, check, capture })
      await check('重启后恢复工具顺序，搜索词不保存', async () => {
        await app.close()
        app = await _electron.launch({ args: [path.join(__dirname, 'main.cjs')], env })
        const restarted = await app.firstWindow()
        restarted.on('pageerror', (error) => errors.push(error.message))
        await verifyToolNavigationAfterRestart(restarted)
      })
      assert.deepEqual(errors, [])
      process.stdout.write(`工具导航验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }

    if (process.argv.includes('--dev-tools-only')) {
      await verifyDevTools({ page, app, check, capture })
      await check('重启后恢复模板及历史，变量值不恢复', async () => {
        await app.close()
        app = await _electron.launch({ args: [path.join(__dirname, 'main.cjs')], env })
        const restarted = await app.firstWindow()
        restarted.on('pageerror', (error) => errors.push(error.message))
        await verifyTemplatesAfterRestart(restarted)
      })
      assert.deepEqual(errors, [])
      process.stdout.write(`数据工具与模板验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    if (process.argv.includes('--tools-only')) {
      await verifyDeveloperUtilities({ page, app, check, capture })
      await verifyIpPrompt({ page, app, check, capture })
      await verifyToolNavigation({ page, app, check, capture })
      await verifyDevTools({ page, app, check, capture })
      await check('重启后恢复模板及历史，变量值不恢复', async () => {
        await app.close()
        app = await _electron.launch({ args: [path.join(__dirname, 'main.cjs')], env })
        const restarted = await app.firstWindow()
        restarted.on('pageerror', (error) => errors.push(error.message))
        await verifyTemplatesAfterRestart(restarted)
        await verifyToolNavigationAfterRestart(restarted)
      })
      assert.deepEqual(errors, [])
      process.stdout.write(`开发工具验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }

    await verifySidebarNavigation({ page, app, check, capture })
    await check('搜索笔记直接打开目标', async () => {
      await page.getByRole('button', { name: '工具', exact: true }).waitFor()
      await search('验收笔记甲')
      await select()
      await page.getByRole('textbox', { name: '笔记正文' }).waitFor()
      assert.equal(await page.getByRole('textbox', { name: '笔记标题' }).inputValue(), '验收笔记甲')
    })
    await check('取消跳转保留草稿并恢复焦点', async () => {
      await page.getByRole('textbox', { name: '笔记正文' }).fill('未保存的合成草稿')
      await search('验收笔记乙')
      await withDialog(page, false, async () => {
        await select()
      })
      assert.equal(
        await page.getByRole('textbox', { name: '笔记正文' }).inputValue(),
        '未保存的合成草稿'
      )
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: '全局搜索' }).waitFor({ state: 'hidden' })
      assert.equal(
        await page
          .getByRole('textbox', { name: '笔记正文' })
          .evaluate((element) => element === document.activeElement),
        true
      )
    })
    await check('同页切换笔记重置编辑器', async () => {
      await search('验收笔记乙')
      await withDialog(page, true, async () => {
        await select()
      })
      await page.waitForFunction(
        () => document.querySelector('.note-title-input')?.value === '验收笔记乙'
      )
      assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), '乙笔记正文')
    })
    await check('重复打开同一笔记也重置已确认放弃的草稿', async () => {
      await page.getByRole('textbox', { name: '笔记正文' }).fill('准备放弃的同页草稿')
      await search('验收笔记乙')
      await withDialog(page, true, async () => {
        await select()
      })
      await page.waitForFunction(
        () => document.querySelector('.note-body-input')?.value === '乙笔记正文'
      )
    })
    await check('密码搜索打开详情且 Esc 只关顶层搜索', async () => {
      await search('验收账号')
      await select()
      await page.getByRole('dialog', { name: '条目详情' }).waitFor()
      await search('验收分组乙')
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('dialog', { name: '条目详情' }).isVisible(), true)
    })
    await check('切换密码条目后恢复遮罩', async () => {
      await page.getByRole('button', { name: '显示', exact: true }).click()
      await search('验收账号乙')
      await select()
      const detail = page.getByRole('dialog', { name: '条目详情' })
      await detail.getByRole('heading', { name: '验收账号乙', exact: true }).waitFor()
      assert.match(await detail.locator('.field-value.mono').innerText(), /^•+$/)
    })
    await check('密码编辑中取消跳转保留草稿，Esc 只关闭搜索', async () => {
      await page
        .getByRole('dialog', { name: '条目详情' })
        .getByRole('button', { name: '编辑', exact: true })
        .click()
      await page.getByRole('textbox', { name: '名称 *', exact: true }).fill('未保存的合成条目')
      await search('验收分组乙')
      await withDialog(page, false, async () => {
        await select()
      })
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('dialog', { name: '密码编辑' }).isVisible(), true)
      assert.equal(
        await page.getByRole('textbox', { name: '名称 *', exact: true }).inputValue(),
        '未保存的合成条目'
      )
    })
    await check('分组搜索选中过滤目标分组', async () => {
      await search('验收分组乙')
      await withDialog(page, true, async () => {
        await select()
      })
      await page.getByRole('button', { name: '验收分组乙', exact: true }).waitFor()
      await page.waitForFunction(
        () => document.querySelector('.group-chip.active')?.textContent === '验收分组乙'
      )
      assert.equal(
        await page.locator('.book-name').filter({ hasText: '乙组小说' }).isVisible(),
        true
      )
      assert.equal(await page.locator('.book-name').filter({ hasText: '甲组小说' }).count(), 0)
    })
    await check('加载失败可重试，已删除搜索目标给出失效提示', async () => {
      await search('验收笔记甲')
      await page.evaluate(() => {
        window.uiVerification.removeNote('n1')
        window.uiVerification.failNextNotesLoad()
      })
      await select()
      await page.getByRole('button', { name: '重试', exact: true }).click()
      await page.getByText('该笔记已不存在，请重新搜索', { exact: true }).waitFor()
      assert.equal(await page.locator('.note-editor-page').count(), 0)
    })
    await check('键盘选中项自动滚入可视区，Tab 留在搜索中', async () => {
      await search('验收会话')
      for (let index = 0; index < 20; index += 1) await page.keyboard.press('ArrowDown')
      await page.waitForFunction(() => document.querySelector('.palette-list').scrollTop > 0)
      const visible = await page.getByRole('option', { selected: true }).evaluate((element) => {
        const item = element.getBoundingClientRect()
        const list = element.closest('.palette-list').getBoundingClientRect()
        return item.top >= list.top - 1 && item.bottom <= list.bottom + 1
      })
      assert.equal(visible, true)
      await page.keyboard.press('Tab')
      assert.equal(
        await page.getByRole('combobox').evaluate((element) => element === document.activeElement),
        true
      )
      await page.keyboard.press('Escape')
    })
    if (process.argv.includes('--modal-only')) {
      assert.deepEqual(errors, [])
      process.stdout.write(`搜索与模态焦点验收通过 ${passed.length} 项，页面异常 0 项\n`)
      return
    }
    await check('底部跟随流式消息，上滚后保持阅读位置', async () => {
      await page.getByRole('button', { name: '对话', exact: true }).click()
      await bottom()
      await page.getByRole('textbox', { name: '输入消息' }).fill('开始流式验收')
      await page.getByRole('button', { name: '发送', exact: true }).click()
      await page.getByRole('button', { name: '停止', exact: true }).waitFor()
      await page.evaluate(() => window.uiVerification.delta('新增段落。'.repeat(80)))
      await bottom()
      await page.getByLabel('对话消息', { exact: true }).evaluate((element) => {
        element.scrollTop = 100
        element.dispatchEvent(new Event('scroll'))
      })
      await page.getByRole('button', { name: '回到最新', exact: true }).waitFor()
      const before = await page.locator('.message-list').evaluate((element) => element.scrollTop)
      await page.evaluate(() => window.uiVerification.delta('流式继续。'.repeat(80)))
      await page.getByText(/流式继续。/).waitFor()
      assert.ok(
        Math.abs(
          (await page.locator('.message-list').evaluate((element) => element.scrollTop)) - before
        ) < 2
      )
      await capture('chat-history')
    })
    await check('缩放窗口时保持历史阅读状态', async () => {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1024, 680)
      )
      await page.waitForFunction(() => innerWidth === 1024)
      assert.equal(
        await page.getByRole('button', { name: '回到最新', exact: true }).isVisible(),
        true
      )
      const before = await page.locator('.message-list').evaluate((element) => element.scrollTop)
      await page.evaluate(() => window.uiVerification.delta('缩放后追加。'.repeat(80)))
      await page.getByText(/缩放后追加。/).waitFor()
      assert.ok(
        Math.abs(
          (await page.locator('.message-list').evaluate((element) => element.scrollTop)) - before
        ) < 2
      )
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1280, 820)
      )
      await page.waitForFunction(() => innerWidth === 1280)
    })
    await check('回到最新后恢复自动跟随', async () => {
      await page.getByRole('button', { name: '回到最新', exact: true }).click()
      await bottom()
      await page.evaluate(() => window.uiVerification.delta('再次追加。'.repeat(80)))
      await bottom()
      assert.equal(await page.getByRole('button', { name: '回到最新', exact: true }).count(), 0)
      await page.getByRole('button', { name: '停止', exact: true }).click()
    })
    await check('切换会话后重新定位到消息末尾', async () => {
      await page.locator('.message-list').evaluate((element) => {
        element.scrollTop = 0
        element.dispatchEvent(new Event('scroll'))
      })
      await search('验收会话 1')
      await select()
      await page.waitForFunction(() => document.querySelectorAll('.message-row').length === 1)
      await bottom()
    })
    await check('文本清洗保留原文，输出可复制且反馈随内容更新', async () => {
      await page.getByRole('button', { name: '工具', exact: true }).click()
      await page.getByRole('button', { name: '文本统计', exact: true }).click()
      await page.getByRole('textbox', { name: '文本', exact: true }).fill('b\na\nb\n')
      await page.getByRole('button', { name: '按行去重', exact: true }).click()
      assert.equal(
        await page.getByRole('textbox', { name: '文本', exact: true }).inputValue(),
        'b\na\nb\n'
      )
      assert.equal(
        await page.getByRole('textbox', { name: '处理结果', exact: true }).inputValue(),
        'b\na'
      )
      await page.getByRole('button', { name: '复制', exact: true }).click()
      await page.getByRole('button', { name: '已复制', exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.uiVerification.copiedText()), 'b\na')
      await capture('text-result')
      await page.getByRole('textbox', { name: '文本', exact: true }).fill('c\nc')
      assert.equal(
        await page.getByRole('textbox', { name: '处理结果', exact: true }).inputValue(),
        'c'
      )
      assert.equal(await page.getByRole('button', { name: '复制', exact: true }).isEnabled(), true)
    })
    for (const [width, height] of [
      [1280, 820],
      [1024, 680],
      [1920, 1080]
    ]) {
      await check(`${width}×${height} 布局无横向溢出`, async () => {
        await app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
          [width, height]
        )
        await page.waitForFunction(
          (size) => innerWidth === size[0] && innerHeight === size[1],
          [width, height]
        )
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false
        )
        const boxes = await page.locator('.tool-workbench .tool-input').evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect()
            return { top: box.top, bottom: box.bottom }
          })
        )
        if (width === 1024) assert.ok(boxes[1].top > boxes[0].bottom, '窄窗应上下排列')
        else assert.ok(Math.abs(boxes[1].top - boxes[0].top) < 2, '宽窗输入输出应对齐')
        if (width === 1024) await capture('text-result-narrow')
      })
    }
    await verifyDeveloperUtilities({ page, app, check, capture })
    await verifyIpPrompt({ page, app, check, capture })
    await verifyToolNavigation({ page, app, check, capture })
    await verifyDevTools({ page, app, check, capture })
    await verifyAiStream({ page, check, capture })
    await verifyOpenCode({ page, app, check, capture })
    await verifyThemes({ page, app, check, capture })
    await check('重启 Electron 后恢复主题和动效设置', async () => {
      await app.close()
      app = await _electron.launch({ args: [path.join(__dirname, 'main.cjs')], env })
      const restarted = await app.firstWindow()
      restarted.on('pageerror', (error) => errors.push(error.message))
      await restarted.getByRole('button', { name: '设置', exact: true }).click()
      await restarted.waitForFunction(
        () =>
          document.documentElement.dataset.theme === 'paper' &&
          document.querySelector('.appearance-options')?.getAttribute('aria-busy') === 'false'
      )
      assert.equal(
        await restarted
          .getByRole('button', { name: '晨光纸白', exact: true })
          .getAttribute('aria-pressed'),
        'true'
      )
      assert.equal(
        await restarted.getByRole('switch', { name: '星空背景动效' }).getAttribute('aria-checked'),
        'false'
      )
      await verifyTemplatesAfterRestart(restarted)
      await verifyToolNavigationAfterRestart(restarted)
    })
    assert.deepEqual(errors, [], '验收期间不应出现页面异常')
    process.stdout.write(`UI 验收通过 ${passed.length} 项，页面异常 0 项\n`)
  } finally {
    if (app) await app.close()
    // 只清理本脚本创建的临时目录，先验证绝对路径和固定前缀。
    if (
      path.dirname(path.resolve(profile)) === tempRoot &&
      path.basename(profile).startsWith('toolbox-ui-')
    ) {
      await fs.rm(profile, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  process.stderr.write((error.stack ?? String(error)) + '\n')
  process.exitCode = 1
})
