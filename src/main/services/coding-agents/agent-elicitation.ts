import type { AgentQuestion, AgentQuestionAnswer } from '../../../shared/agent-session'
import { CodingAgentError } from './adapter'
import { acpObject } from './stdio-rpc-connection'

const SECRET_FIELD =
  /password|passphrase|secret|token|api[_ -]?key|credential|private[_ -]?key|密码|密钥|令牌/i

function unsupported(): never {
  throw new CodingAgentError('此表单含秘密信息或暂不支持的字段，请在原生客户端继续')
}

function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) return unsupported()
  return value
}

/** 只接入受限的平面表单；未知约束拒绝，不静默丢弃校验或执行原生正则。 */
export function nativeForm(
  value: unknown,
  message?: unknown
): {
  message: string
  questions: AgentQuestion[]
  content(answer: AgentQuestionAnswer): Record<string, string | number | boolean | string[]>
} {
  const prompt = message === undefined ? '' : boundedText(message, 4000)
  if (SECRET_FIELD.test(prompt)) return unsupported()
  const schema = acpObject(value)
  const properties = acpObject(schema?.properties)
  if (
    schema?.type !== 'object' ||
    !properties ||
    Object.keys(schema).some(
      (key) =>
        ![
          'type',
          'properties',
          'required',
          '$schema',
          'title',
          'description',
          'additionalProperties'
        ].includes(key)
    ) ||
    (schema.additionalProperties !== undefined && schema.additionalProperties !== false)
  )
    return unsupported()
  for (const name of ['title', 'description'])
    if (schema[name] !== undefined && SECRET_FIELD.test(boundedText(schema[name], 4000)))
      return unsupported()
  const entries = Object.entries(properties)
  const required = schema.required ?? []
  if (
    !entries.length ||
    entries.length > 4 ||
    !Array.isArray(required) ||
    required.some((key) => typeof key !== 'string' || !Object.hasOwn(properties, key)) ||
    new Set(required).size !== required.length
  )
    return unsupported()
  const questions = entries.map(([key, raw], index): AgentQuestion => {
    const field = acpObject(raw)
    if (!field || !key || key.length > 200) return unsupported()
    const title = field.title === undefined ? key : boundedText(field.title, 100)
    const description = field.description === undefined ? '' : boundedText(field.description, 4000)
    if (SECRET_FIELD.test(`${key} ${title} ${description}`)) return unsupported()
    const kind = field.type
    if (!['string', 'number', 'integer', 'boolean', 'array'].includes(String(kind)))
      return unsupported()
    const allowed = ['type', 'title', 'description', 'default']
    if (kind === 'string') allowed.push('minLength', 'maxLength', 'enum', 'enumNames', 'oneOf')
    if (kind === 'number' || kind === 'integer') allowed.push('minimum', 'maximum')
    if (kind === 'array') allowed.push('items', 'minItems', 'maxItems', 'uniqueItems')
    if (Object.keys(field).some((name) => !allowed.includes(name))) return unsupported()
    if (field.uniqueItems !== undefined && typeof field.uniqueItems !== 'boolean')
      return unsupported()
    const question: AgentQuestion = {
      id: `q${index}`,
      title,
      text: description || title,
      multiple: kind === 'array',
      allowText: kind === 'string' || kind === 'number' || kind === 'integer',
      required: required.includes(key),
      valueKind: kind as AgentQuestion['valueKind'],
      options: []
    }
    for (const constraint of [
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems'
    ] as const) {
      const bound = field[constraint]
      if (bound === undefined) continue
      if (
        typeof bound !== 'number' ||
        !Number.isFinite(bound) ||
        (!['minimum', 'maximum'].includes(constraint) && (!Number.isInteger(bound) || bound < 0))
      )
        return unsupported()
      question[constraint] = bound
    }
    for (const [min, max] of [
      ['minimum', 'maximum'],
      ['minLength', 'maxLength'],
      ['minItems', 'maxItems']
    ] as const)
      if (
        question[min] !== undefined &&
        question[max] !== undefined &&
        question[min]! > question[max]!
      )
        return unsupported()
    if ((question.minLength ?? 0) > 4000 || (question.minItems ?? 0) > 12) return unsupported()
    let choices = field
    if (kind === 'array') {
      const items = acpObject(field.items)
      if (
        !items ||
        Object.keys(items).some((name) => !['type', 'enum', 'anyOf', 'oneOf'].includes(name)) ||
        (items.type !== undefined && items.type !== 'string')
      )
        return unsupported()
      choices = items
    }
    const variants = choices.oneOf ?? choices.anyOf
    if (variants !== undefined && choices.enum !== undefined) return unsupported()
    if (choices.enum !== undefined || variants !== undefined) {
      if (kind !== 'string' && kind !== 'array') return unsupported()
      const values = choices.enum ?? variants
      if (!Array.isArray(values) || !values.length || values.length > 12) return unsupported()
      const names = choices.enumNames
      if (names !== undefined && (!Array.isArray(names) || names.length !== values.length))
        return unsupported()
      question.options = values.map((item, choiceIndex) => {
        const option = variants !== undefined ? acpObject(item) : undefined
        if (
          variants !== undefined &&
          (!option ||
            (option.type !== undefined && option.type !== 'string') ||
            Object.keys(option).some(
              (name) => !['const', 'title', 'description', 'type'].includes(name)
            ))
        )
          return unsupported()
        const choice = boundedText(option ? option.const : item, 500)
        const label = boundedText(
          option?.title ?? (Array.isArray(names) ? names[choiceIndex] : choice),
          500
        )
        if (!choice.trim() || !label.trim()) return unsupported()
        return {
          value: choice,
          label,
          description:
            option?.description === undefined ? '' : boundedText(option.description, 1000)
        }
      })
      if (new Set(question.options.map((option) => option.value)).size !== question.options.length)
        return unsupported()
      question.allowText = false
    } else if (kind === 'array') return unsupported()
    if (kind === 'boolean')
      question.options = [
        { label: '是', value: 'true', description: '' },
        { label: '否', value: 'false', description: '' }
      ]
    return question
  })
  return {
    message: prompt,
    questions,
    content: (answer) =>
      Object.fromEntries(
        entries.flatMap(([key], index) => {
          const question = questions[index]
          const values =
            answer.answers.find((item) => item.questionId === question.id)?.values ?? []
          validateQuestionValues(question, values)
          if (!values.length && question.valueKind === 'array' && question.required)
            return [[key, []]]
          if (!values.length) return []
          const value =
            question.valueKind === 'array'
              ? values
              : question.valueKind === 'boolean'
                ? values[0] === 'true'
                : question.valueKind === 'number' || question.valueKind === 'integer'
                  ? Number(values[0])
                  : values[0]
          return [[key, value]]
        })
      )
  }
}

/** IPC 后再次按当前待回答字段复核，不能依赖浏览器输入类型或按钮禁用。 */
export function validateQuestionValues(question: AgentQuestion, values: string[]): void {
  const fail = (): never => {
    throw new CodingAgentError('答案不符合原生问题要求，请重新选择或填写')
  }
  if (!values.length) {
    if (
      question.required !== false &&
      !(question.valueKind === 'array' && (question.minItems ?? 0) === 0)
    )
      fail()
    return
  }
  if (
    (!question.multiple && values.length !== 1) ||
    values.length > 12 ||
    new Set(values).size !== values.length
  )
    fail()
  for (const value of values) {
    if (
      !value.trim() ||
      value.length > 4000 ||
      (!question.allowText &&
        !question.options.some((option) => (option.value ?? option.label) === value))
    )
      fail()
    const length = [...value].length
    if (length < (question.minLength ?? 0) || length > (question.maxLength ?? 4000)) fail()
    if (question.valueKind === 'number' || question.valueKind === 'integer') {
      if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) fail()
      const number = Number(value)
      if (
        !Number.isFinite(number) ||
        (question.valueKind === 'integer' && !Number.isSafeInteger(number)) ||
        number < (question.minimum ?? -Infinity) ||
        number > (question.maximum ?? Infinity)
      )
        fail()
    }
  }
  if (
    question.multiple &&
    (values.length < (question.minItems ?? 0) || values.length > (question.maxItems ?? 12))
  )
    fail()
}
