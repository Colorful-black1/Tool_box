/* global window:readonly */
const assert = require('node:assert/strict')

/** 设置页的知识库模型字段：可见、可保存、回读一致。 */
module.exports = async function verifyModelSettings({ page, check, capture }) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '星轨链路', exact: true }).waitFor()

  const embedding = page.getByLabel('向量模型 · EMBEDDING', { exact: true })
  const rerank = page.getByLabel('重排模型 · RERANK', { exact: true })

  await check('设置页提供向量与重排模型入口', async () => {
    await embedding.waitFor()
    await rerank.waitFor()
    assert.equal(await embedding.inputValue(), '')
    assert.equal(await rerank.inputValue(), '')
    await embedding.scrollIntoViewIfNeeded()
    await capture('settings-model-fields')
  })

  await check('保存后回读向量与重排模型', async () => {
    await embedding.fill('bge-m3')
    await rerank.fill('bge-reranker-v2-m3')
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await page.getByText('配置已保存', { exact: true }).waitFor()

    const view = await page.evaluate(() => window.toolbox.settings.get())
    assert.equal(view.profiles[0].embeddingModel, 'bge-m3')
    assert.equal(view.profiles[0].rerankModel, 'bge-reranker-v2-m3')
    assert.equal(await embedding.inputValue(), 'bge-m3')
  })

  await check('配置向量模型后资料库显示覆盖率与补齐入口', async () => {
    await page.getByRole('button', { name: '资料库', exact: true }).click()
    await page.getByText('关键词 + 语义检索', { exact: false }).waitFor()
    await page.getByText('向量 0/2', { exact: true }).waitFor()
    await page.getByRole('button', { name: '补齐向量（1）', exact: true }).waitFor()
    await capture('knowledge-vector-pending')
  })
}
