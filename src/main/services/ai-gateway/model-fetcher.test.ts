import { describe, expect, it } from 'vitest'

import { extractModelIds } from './model-fetcher'

describe('extractModelIds', () => {
  it('reads the OpenAI data array shape', () => {
    expect(
      extractModelIds({
        object: 'list',
        data: [
          { id: 'deepseek-v4-pro', object: 'model' },
          { id: 'deepseek-v4-flash', object: 'model' }
        ]
      })
    ).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  })

  it('reads the Gemini models shape and strips the models/ prefix', () => {
    expect(
      extractModelIds({ models: [{ name: 'models/gemini-2.5-pro' }, { name: 'models/gemini-2.5-flash' }] })
    ).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
  })

  it('reads a bare string array', () => {
    expect(extractModelIds(['b-model', 'a-model'])).toEqual(['a-model', 'b-model'])
  })

  it('dedupes, trims and drops empty ids', () => {
    expect(
      extractModelIds({
        data: [{ id: '  spaced  ' }, { id: 'spaced' }, { id: '' }, { name: 'named' }, 42]
      })
    ).toEqual(['named', 'spaced'])
  })

  it('returns an empty list for unrecognised payloads', () => {
    expect(extractModelIds(null)).toEqual([])
    expect(extractModelIds({ object: 'list' })).toEqual([])
    expect(extractModelIds({ data: 'not-an-array' })).toEqual([])
  })
})
