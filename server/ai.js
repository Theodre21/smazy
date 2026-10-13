import Anthropic, { betaRefusalFallbackMiddleware, BetaFallbackState } from '@anthropic-ai/sdk'
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The chat model is chosen with CHAT_PROVIDER in .env:
//   ollama -> a free model running on this computer through Ollama (no key, no cost)
//   claude -> Claude, through ANTHROPIC_API_KEY (Claude API) or AWS credentials (Amazon Bedrock)
//   auto   -> (default) Claude if credentials exist, otherwise Ollama if it's running
const hasAwsCredentials = () =>
  Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE) ||
  ['credentials', 'config'].some((name) => existsSync(path.join(os.homedir(), '.aws', name)))

const ollamaUrl = () => (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
let ollamaCheck = { at: 0, models: [] }
async function ollamaModels() {
  if (Date.now() - ollamaCheck.at < 10_000) return ollamaCheck.models
  let models = []
  try {
    const response = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(1500) })
    models = (await response.json()).models?.map((m) => m.name) || []
  } catch { /* Ollama isn't running */ }
  ollamaCheck = { at: Date.now(), models }
  return models
}

function claudeProvider() {
  if (process.env.ANTHROPIC_API_KEY) return { name: 'Claude API', label: 'Claude', kind: 'anthropic', model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5' }
  if (hasAwsCredentials()) return { name: 'Amazon Bedrock', label: 'Claude', kind: 'bedrock', model: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-opus-5-5' }
  return null
}

async function ollamaProvider() {
  const models = await ollamaModels()
  if (!models.length) return null
  const model = process.env.OLLAMA_MODEL && models.includes(process.env.OLLAMA_MODEL) ? process.env.OLLAMA_MODEL : models[0]
  return { name: 'Ollama on this computer', label: `Free · ${model.split(':')[0]}`, kind: 'ollama', model }
}

export async function provider() {
  const choice = String(process.env.CHAT_PROVIDER || 'auto').toLowerCase()
  if (choice === 'ollama') return ollamaProvider()
  if (choice === 'claude') return claudeProvider()
  return claudeProvider() || ollamaProvider()
}

// ---------- Ollama (free, local) ----------
async function ollamaChat(current, body) {
  const response = await fetch(`${ollamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // think: false gives faster answers; num_ctx leaves room for the slide and lecture text.
    body: JSON.stringify({ model: current.model, think: false, options: { num_ctx: 16384 }, ...body }),
  })
  if (!response.ok) throw Object.assign(new Error(`Ollama error ${response.status}: ${await response.text()}`), { ollama: true })
  return response
}

// Clients are rebuilt when the credentials change, so editing .env doesn't need a server restart.
let cached = { key: '', client: null }
function client(current) {
  const key = `${current.kind}:${process.env.ANTHROPIC_API_KEY || ''}:${process.env.AWS_REGION || ''}`
  if (cached.key !== key) {
    cached = {
      key,
      client: current.kind === 'anthropic'
        ? new Anthropic()
        // On Bedrock, a declined request is retried on Claude Opus 4.8 by the SDK.
        : new AnthropicBedrockMantle({
          awsRegion: process.env.AWS_REGION,
          middleware: [betaRefusalFallbackMiddleware([{ model: process.env.BEDROCK_FALLBACK_MODEL_ID || 'anthropic.claude-opus-4-8' }])],
        }),
    }
  }
  return cached.client
}

// On the Claude API, a declined request is re-run on a fallback model server-side.
function request(current, params) {
  return current.kind === 'anthropic'
    ? { params: { ...params, model: current.model, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, options: {} }
    : { params: { ...params, model: current.model }, options: { fallbackState: new BetaFallbackState() } }
}

// One JSON answer, shaped by a JSON schema (used for sorting files and picking the first lecture).
export async function askJson({ system, prompt, schema }) {
  const current = await provider()
  if (!current) throw new Error('No chat model configured')
  if (current.kind === 'ollama') {
    const response = await ollamaChat(current, { stream: false, format: schema, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] })
    return JSON.parse((await response.json()).message.content)
  }
  const { params, options } = request(current, {
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  const response = await client(current).beta.messages.create(params, options)
  if (response.stop_reason === 'refusal') throw new Error('Model declined the request')
  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
  return JSON.parse(text)
}

// Streams a chat reply, calling onText for every chunk of text as it arrives.
export async function streamChat({ system, messages, onText }) {
  const current = await provider()
  if (!current) throw new Error('No chat model configured')
  if (current.kind === 'ollama') {
    const response = await ollamaChat(current, { stream: true, messages: [{ role: 'system', content: system }, ...messages] })
    // Ollama streams one JSON object per line.
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        const data = JSON.parse(line)
        if (data.error) throw Object.assign(new Error(data.error), { ollama: true })
        if (data.message?.content) onText(data.message.content)
      }
    }
    return
  }
  const { params, options } = request(current, { max_tokens: 64000, output_config: { effort: 'medium' }, system, messages })
  const stream = client(current).beta.messages.stream(params, options)
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text)
  }
  const final = await stream.finalMessage()
  if (final.stop_reason === 'refusal') onText('\n\nSorry, I can’t help with that one.')
}

// A friendly explanation for the chat when Claude can't be reached.
export function describeError(error) {
  if (error?.ollama || /fetch failed|ECONNREFUSED/i.test(error?.message || '') && !(error instanceof Anthropic.APIError)) return 'Smazy couldn’t reach the free model. Make sure the Ollama app is open, then try again.'
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return 'Claude rejected the credentials. Check the key in `smazy/.env`.'
  if (error instanceof Anthropic.RateLimitError) return 'Claude is busy right now (rate limit). Try again in a moment.'
  if (error instanceof Anthropic.APIConnectionError) return 'Smazy couldn’t connect to Claude. Check your internet connection or AWS sign-in.'
  const detail = error?.error?.error?.message
  if (/credit balance/i.test(detail || '')) return 'Your Anthropic account has no credit left, so Claude can’t reply yet. Add credit at console.anthropic.com → Plans & Billing, then send your message again.'
  if (error instanceof Anthropic.APIError) return `Claude returned an error (${error.status ?? 'unknown'})${detail ? `: ${detail}` : ''}`
  return 'Smazy couldn’t reach Claude just now. Please try again.'
}
