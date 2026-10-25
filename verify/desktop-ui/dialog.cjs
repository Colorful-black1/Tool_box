/** 等待应用内业务确认完成，测试不再监听阻塞式原生 dialog。 */
async function withDialog(page, accepted, action) {
  const response = page
    .locator('[data-app-dialog]')
    .getByRole('button', { name: accepted ? '确认' : '取消', exact: true })
    .click()
  await Promise.all([response, action()])
  await page.locator('[data-app-dialog]').waitFor({ state: 'hidden' })
}
module.exports = { withDialog }
