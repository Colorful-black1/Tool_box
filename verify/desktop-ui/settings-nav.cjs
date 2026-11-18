/** 设置已拆成左侧导航子页；展开分组后点击对应子项。 */
module.exports = async function openSettings(page, label) {
  const nav = page.getByRole('navigation', { name: '主导航', exact: true })
  const group = nav.getByRole('button', { name: '设置', exact: true })
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
  await nav.getByRole('button', { name: label, exact: true }).click()
}
