import { describe, expect, it } from 'vitest'

import { extractModelIds, extractModelList } from './model-fetcher'

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

describe('extractModelList', () => {
  it('reads DeepSeek context_window', () => {
    expect(
      extractModelList({
        object: 'list',
        data: [
          { id: 'deepseek-v4-pro', context_window: 1_048_576 },
          { id: 'deepseek-v4-flash', context_window: '1048576' }
        ]
      })
    ).toEqual({
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      contextWindows: {
        'deepseek-v4-flash': 1_048_576,
        'deepseek-v4-pro': 1_048_576
      }
    })
  })

  it('reads Kimi context_length and OpenRouter top_provider', () => {
    expect(
      extractModelList({
        data: [
          { id: 'kimi-k3.1-pro', context_length: 262_144 },
          { id: 'openrouter/model', context_length: 200_000, top_provider: { context_length: 128_000 } }
        ]
      }).contextWindows
    ).toEqual({
      'kimi-k3.1-pro': 262_144,
      'openrouter/model': 200_000
    })
  })

  it('reads nested DashScope / llama.cpp / Gemini fields', () => {
    expect(
      extractModelList({
        models: [
          { name: 'models/qwen3.8-max', model_info: { context_window: 131_072 } },
          { name: 'models/llama-local', meta: { n_ctx_train: 32_768 } },
          { name: 'models/gemini-3-pro', inputTokenLimit: 1_048_576 }
        ]
      }).contextWindows
    ).toEqual({
      'qwen3.8-max': 131_072,
      'llama-local': 32_768,
      'gemini-3-pro': 1_048_576
    })
  })

  it('ignores missing, non-numeric and out-of-range values', () => {
    const result = extractModelList({
      data: [
        { id: 'plain' },
        { id: 'text', context_window: 'very-large' },
        { id: 'tiny', context_window: 128 },
        { id: 'huge', context_window: 20_000_000 },
        { id: 'fractional', context_window: 131_072.5 }
      ]
    })
    expect(result.models).toEqual(['fractional', 'huge', 'plain', 'text', 'tiny'])
    expect(result.contextWindows).toEqual({})
  })

  it('prefers total context over max input when both exist', () => {
    expect(
      extractModelList({
        data: [{ id: 'model', max_input_tokens: 120_000, context_window: 131_072 }]
      }).contextWindows
    ).toEqual({ model: 131_072 })
  })
})
