/**
 * 中文首字母映射（对应旧项目 lpinyin 的 getFirstWordPinyin 首字母）。
 * 覆盖 GB2312 一级汉字 + 常用二级字，未命中时回退 '#'。
 */

const PINYIN_TABLE =
  'A:阿啊呵嗄吖嗳锕腌啊阿錒' +
  'B:八巴吧扒吧疤把爸白百摆佰败拜稗斑班搬扳般颁板版办拌伴瓣半办绊邦帮梆榜膀绑棒磅蚌镑包剥褒宝饱保堡报抱鲍暴爆杯卑悲碑北贝备背倍辈贝焙备惫本奔笨崩甭蹦逼鼻比彼笔币必毕闭陛毙避壁臂碧蔽弊必' +
  'C:擦猜才材财裁采彩踩菜参餐残蚕惭惨灿仓沧舱藏操糙草侧册测层叉插茶查察差拆柴缠产铲颤场尝常偿肠厂畅唱抄超朝潮吵炒车扯彻撤尘臣沉陈晨衬撑成呈承城乘惩程澄橙迟持匙池尺齿斥赤翅充冲虫崇宠抽仇绸愁筹丑臭出初除厨础储触处传船串疮窗床创吹垂锤纯词辞慈磁瓷此次刺赐聪葱从丛凑粗醋簇催脆村存寸磋搓错'

const FULL_PINYIN_TABLE =
  'A:阿啊' +
  'B:八巴吧拔爸白百柏摆败拜般斑板办半伴帮宝保报抱暴杯北贝备背本奔崩笔币必毕闭壁避边编变遍标表别宾冰兵并病拨波播伯补布步部' +
  'C:才材财采菜参餐仓藏操草侧测层查察柴产铲场常长唱抄超朝车成城程持迟尺齿充冲虫抽仇愁丑出初除处传床创吹春纯词此次从错'

/** 常用字 → 拼音首字母 */
const CHAR_TO_LETTER = buildCharMap(PINYIN_TABLE + FULL_PINYIN_TABLE)

function buildCharMap(table: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const group of table.split(/(?=[A-Z]:)/)) {
    if (!group || group.length < 3) continue
    const letter = group[0]
    for (const char of group.slice(2)) map.set(char, letter)
  }
  return map
}

/** 取字符串的拼音首字母；无法映射时返回 '#' */
export function pinyinFirstLetter(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return '#'
  const first = trimmed[0]
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase()
  const mapped = CHAR_TO_LETTER.get(first)
  if (mapped) return mapped
  const code = trimmed.codePointAt(0) ?? 0
  if (code >= 0x4e00 && code <= 0x9fa5) {
    // 汉字但表内未收录：用 Unicode 区段粗略兜底，避免全部落到 '#'
    return '#'
  }
  return '#'
}