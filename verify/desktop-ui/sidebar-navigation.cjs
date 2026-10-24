/* global document:readonly, window:readonly, getComputedStyle:readonly */
const assert = require('node:assert/strict')

/** 只操作合成桥接，检查树形分组、原页面导航、键盘及窄栏降级。 */
module.exports = async function verifySidebarNavigation({ page, app, check, capture }) {
  const nav = page.getByRole('navigation', { name: '主导航', exact: true })
  const button = (name) => nav.getByRole('button', { name, exact: true })
  const groups = {
    开发工作台: ['编程 Agent', 'Token 统计', '工具'],
    阅读空间: ['书架', '统计'],
    个人管理: ['密码箱', '记事本'],
    系统: ['设置']
  }
  const resize = async (width, height, collapsed = width < 1120) => {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height]
    )
    await page.waitForFunction(
      ([width, height, collapsed]) =>
        window.innerWidth === width &&
        window.innerHeight === height &&
        document.querySelector('.side-rail')?.classList.contains('collapsed') === collapsed,
      [width, height, collapsed]
    )
  }
  await resize(1280, 820)
  await button('对话').waitFor()

  await check('主导航四类树形分组，AI 助手保持首个独立入口', async () => {
    assert.equal(await nav.locator('.nav-tree > li').count(), 5)
    assert.equal(await nav.locator('.nav-tree > li').first().innerText(), '对话')
    assert.equal(await button('对话').getAttribute('aria-current'), 'page')
    for (const [name, children] of Object.entries(groups)) {
      assert.equal(await button(name).getAttribute('aria-expanded'), 'true')
      assert.deepEqual(
        await nav.getByRole('list', { name, exact: true }).getByRole('button').allTextContents(),
        children
      )
    }
    await capture('sidebar-tree-initial')
  })

  await check('分类只折叠子项，支持 Enter / Space 与可见键盘焦点，不清空对话草稿', async () => {
    await page.locator('.composer-input').fill('导航验收草稿')
    const group = button('开发工作台')
    await group.focus()
    await page.keyboard.press('Enter')
    assert.equal(await group.getAttribute('aria-expanded'), 'false')
    assert.equal(await button('编程 Agent').count(), 0)
    assert.equal(await button('对话').getAttribute('aria-current'), 'page')
    assert.equal(await page.locator('.composer-input').inputValue(), '导航验收草稿')
    await page.keyboard.press('Tab')
    assert.equal(
      await button('阅读空间').evaluate((element) => element === document.activeElement),
      true
    )
    await group.focus()
    await page.keyboard.press('Space')
    assert.equal(await group.getAttribute('aria-expanded'), 'true')
    assert.equal(await group.evaluate((element) => getComputedStyle(element).outlineStyle), 'solid')
    await page.keyboard.press('Tab')
    assert.equal(
      await button('编程 Agent').evaluate((element) => element === document.activeElement),
      true
    )
    // 描边沿用导航按钮的渐变过渡，等待焦点样式绘制后再判断。
    await page.waitForFunction(() => {
      const focused = document.activeElement
      return (
        focused?.matches('.nav-item:focus-visible') &&
        getComputedStyle(focused).borderTopColor !== 'rgba(0, 0, 0, 0)'
      )
    })
  })

  await check('所有原 TAB 仍可切换，当前子项和归属分类标记正确', async () => {
    for (const [name, title] of [
      ['编程 Agent', '编程 Agent'],
      ['Token 统计', 'Token 统计'],
      ['工具', '开发者工具'],
      ['书架', '星轨书架'],
      ['统计', '阅读统计'],
      ['密码箱', '密码宝匣'],
      ['记事本', '星笺手记'],
      ['设置', '星轨链路']
    ]) {
      await button(name).click()
      await page.getByRole('heading', { name: title, exact: true }).waitFor()
      assert.equal(await button(name).getAttribute('aria-current'), 'page')
      assert.equal(await nav.locator('[aria-current="page"]').count(), 1)
      assert.equal(await nav.locator('.nav-group-toggle.contains-current').count(), 1)
    }
    await button('系统').click()
    assert.equal(await button('设置').count(), 0)
    assert.equal(await button('系统').getAttribute('aria-expanded'), 'false')
    assert.equal(
      await page.getByRole('heading', { name: '星轨链路', exact: true }).isVisible(),
      true
    )
    await button('系统').click()
    await button('对话').click()
    assert.equal(await page.locator('.composer-input').inputValue(), '导航验收草稿')
    await page.locator('.composer-input').fill('')
  })

  await check('全局搜索跳转自动展开目标分类，保留其他分类的折叠状态', async () => {
    await button('个人管理').click()
    await button('开发工作台').click()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: '搜索内容或命令' }).fill('验收笔记甲')
    await page.getByRole('option').first().waitFor()
    await page.keyboard.press('Enter')
    await page.getByRole('textbox', { name: '笔记正文', exact: true }).waitFor()
    assert.equal(await button('个人管理').getAttribute('aria-expanded'), 'true')
    assert.equal(await button('记事本').getAttribute('aria-current'), 'page')
    assert.equal(await button('开发工作台').getAttribute('aria-expanded'), 'false')
    await capture('sidebar-tree-folded')
    await button('开发工作台').click()
  })

  await check('阅读器仍归属书架，AI 助手保持独立可直接访问', async () => {
    await button('书架').click()
    await page.locator('.book-cover').first().click()
    await page.getByRole('button', { name: '返回书架', exact: true }).waitFor()
    assert.equal(await button('书架').getAttribute('aria-current'), 'page')
    assert.equal(await button('阅读空间').getAttribute('aria-expanded'), 'true')
    await button('对话').click()
    assert.equal(await button('对话').getAttribute('aria-current'), 'page')
    assert.equal(await nav.locator('.nav-group-toggle.contains-current').count(), 0)
  })

  await check('手动收起侧栏后所有图标入口可达，展开后保留分类状态', async () => {
    await button('个人管理').click()
    await button('收起侧边栏').click()
    assert.equal(await nav.locator('.nav-group-toggle:visible').count(), 0)
    assert.equal(await nav.locator('.nav-item:visible').count(), 9)
    await button('工具').click()
    assert.equal(await button('工具').getAttribute('aria-current'), 'page')
    await capture('sidebar-tree-icons')
    await button('展开侧边栏').click()
    assert.equal(await button('个人管理').getAttribute('aria-expanded'), 'false')
    await button('个人管理').click()
  })

  await check('窄窗自动显示全部图标，变宽后恢复手动侧栏偏好', async () => {
    await resize(1024, 680)
    assert.equal(await nav.locator('.nav-item:visible').count(), 9)
    assert.equal(await nav.locator('.nav-group-toggle:visible').count(), 0)
    assert.equal(await nav.evaluate((element) => element.scrollWidth > element.clientWidth), false)
    await button('记事本').click()
    await capture('sidebar-tree-narrow')
    await resize(1280, 820)
    assert.equal(await nav.locator('.nav-group-toggle:visible').count(), 4)
    await button('收起侧边栏').click()
    await resize(1024, 680, true)
    await resize(1280, 820, true)
    assert.equal(await nav.locator('.nav-group-toggle:visible').count(), 0)
    await button('展开侧边栏').click()
  })

  await check('矮窗口导航可滚动，底部设置入口可达且无横向溢出', async () => {
    await resize(1280, 560)
    await button('设置').scrollIntoViewIfNeeded()
    await button('设置').click()
    assert.equal(await button('设置').isVisible(), true)
    assert.equal(await nav.evaluate((element) => element.scrollWidth > element.clientWidth), false)
    await capture('sidebar-tree-short')
    await resize(1280, 820)
    await nav.evaluate((element) => {
      element.scrollTop = 0
    })
  })

  for (const [name, id] of [
    ['星轨深空', 'starry'],
    ['静夜石墨', 'graphite'],
    ['晨光纸白', 'paper']
  ]) {
    await check(`${name}下树形导航层级、选中态和宽度`, async () => {
      await button('设置').click()
      await page.getByRole('button', { name, exact: true }).click()
      await page.waitForFunction((id) => document.documentElement.dataset.theme === id, id)
      await button('编程 Agent').click()
      assert.equal(await button('编程 Agent').getAttribute('aria-current'), 'page')
      assert.equal(
        await nav.evaluate((element) => element.scrollWidth > element.clientWidth),
        false
      )
      await capture(`sidebar-tree-${id}`)
    })
  }
  await button('设置').click()
  await page.getByRole('button', { name: '星轨深空', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'starry')
  await button('对话').click()
}
