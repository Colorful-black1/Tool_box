/* global document:readonly, window:readonly */
const assert = require('node:assert/strict')

/** 知识库：列表、检索、导入汇总、类别筛选、重建、删除与空状态。 */
module.exports = async function verifyKnowledge({ page, check, capture }) {
  const nav = page.getByRole('navigation', { name: '主导航', exact: true })
  await nav.getByRole('button', { name: '资料库', exact: true }).click()
  await page.getByRole('heading', { name: '本地知识库', exact: true }).waitFor()

  await check('资料库列出文档、类别、块数与状态', async () => {
    await page
      .getByText('共 2 篇 · 2 段 · 关键词检索（未配置向量模型）', { exact: true })
      .waitFor()
    assert.equal(await page.locator('.kb-row').count(), 2)
    assert.equal(await page.locator('.kb-row-name').first().innerText(), '验收资料甲')
    assert.equal(await page.locator('.kb-status.ready').innerText(), '就绪')
    assert.equal(await page.locator('.kb-status.failed').innerText(), '失败')
    assert.match(await page.locator('.kb-row-error').innerText(), /合成索引失败/)
    await capture('knowledge-list')
  })

  await check('关键词检索显示降级说明，点击命中定位到分块', async () => {
    await page.getByRole('searchbox', { name: '检索知识库' }).fill('回滚')
    await page.getByRole('button', { name: '检索', exact: true }).click()
    await page.getByRole('region', { name: '检索结果' }).waitFor()
    assert.match(await page.locator('.kb-hits-head').innerText(), /命中 1 段/)
    assert.match(await page.locator('.kb-degraded').first().innerText(), /仅关键词/)
    assert.equal(await page.locator('.kb-hit').count(), 1)
    await capture('knowledge-search')
    await page.locator('.kb-hit').click()
    await page.getByText('数据库回滚要先恢复备份。', { exact: true }).waitFor()
    assert.equal(await page.locator('.kb-chunk.focused').count(), 1)
    await capture('knowledge-detail')
    await page.getByRole('button', { name: '← 返回资料库', exact: true }).click()
    await page.getByRole('button', { name: '清除', exact: true }).click()
  })

  await check('导入汇总如实显示跳过原因', async () => {
    await page.getByRole('button', { name: '导入资料', exact: true }).click()
    await page.getByText(/已导入 1 篇，跳过 1 篇（仅支持 \.md \/ \.txt 文件）/).waitFor()
    assert.equal(await page.evaluate(() => window.uiVerification.kbImportCount()), 1)
  })

  await check('类别筛选与下拉选择生效', async () => {
    await page.getByRole('button', { name: '资料类别', exact: true }).click()
    await page.getByRole('option', { name: '个人资料', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.kb-row').length === 1)
    assert.equal(await page.locator('.kb-row-name').innerText(), '验收资料乙')
    await page.getByRole('button', { name: '资料类别', exact: true }).click()
    await page.getByRole('option', { name: '全部资料', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.kb-row').length === 2)
  })

  await check('失败资料重建后状态恢复', async () => {
    const row = page.locator('.kb-row', { hasText: '验收资料乙' })
    await row.getByRole('button', { name: '重建', exact: true }).click()
    await page.getByText(/已重建「验收资料乙」，共 2 段/).waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.kb-row')].some(
        (item) => item.textContent.includes('验收资料乙') && item.querySelector('.kb-status.ready')
      )
    )
    await capture('knowledge-reindexed')
  })

  await check('删除需二次确认，删除后列表移除', async () => {
    await page
      .locator('.kb-row', { hasText: '验收资料甲' })
      .getByRole('button', { name: '删除', exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: '确认操作' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.kb-row').length === 1)
    assert.equal(await page.locator('.kb-row-name').innerText(), '验收资料乙')
  })

  await check('空资料库给出导入指引', async () => {
    await page
      .locator('.kb-row', { hasText: '验收资料乙' })
      .getByRole('button', { name: '删除', exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: '确认操作' })
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await page.getByText('还没有导入资料', { exact: true }).waitFor()
    await page.getByRole('button', { name: '选择文件导入', exact: true }).waitFor()
    await capture('knowledge-empty')
  })
}
