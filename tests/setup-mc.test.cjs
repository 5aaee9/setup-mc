const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createHash } = require('node:crypto')
const ts = require('typescript')

const code = ts.transpileModule(fs.readFileSync('src/setup-mc.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const tag = 'RELEASE.2026-09-16T00-00-00Z'
const archive = Buffer.from('downloaded archive')
const hash = createHash('sha256').update(archive).digest('hex')

async function run(options = {}) {
  const calls = { downloads: [], copies: [], cache: [], paths: [], errors: [], urls: [] }
  const platform = options.platform || 'linux'
  const arch = options.arch || 'x64'
  const system = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform]
  const assetName = `mcli_20260916000000.0.0_${system}_${arch === 'x64' ? 'amd64' : arch}.tar.gz`
  const release = { tag_name: tag, assets: [
    { name: assetName, browser_download_url: 'https://example.test/archive', digest: options.manifest ? undefined : `sha256:${options.badHash ? '0'.repeat(64) : hash}` },
    { name: 'mcli_20260916000000.0.0_checksums.txt', browser_download_url: 'https://example.test/checksums' },
  ] }
  let extracted = false
  const mocks = {
    '@actions/core': {
      getInput: name => name === 'version' ? (options.version || 'latest') : 'test-token',
      info() {}, addPath: value => calls.paths.push(value), setFailed: value => calls.errors.push(value),
    },
    '@actions/tool-cache': {
      find: (...args) => { calls.cache.push(args); return options.cached ? '/cached' : '' },
      downloadTool: async url => { calls.downloads.push(url); return url.endsWith('checksums') ? '/checksums' : '/archive' },
      extractTar: async () => { extracted = true; return '/extracted' },
      cacheDir: async (...args) => { calls.cache.push(args); return '/cached' },
    },
    '@actions/io': { mkdirP: async () => {}, cp: async (...args) => calls.copies.push(args) },
    os: { arch: () => arch },
    fs: { promises: {
      readFile: async file => file === '/archive' ? archive : `${hash}  ${assetName}\n`,
      chmod: async () => {},
    } },
  }
  const context = {
    exports: {}, process: { platform, env: {} },
    require: name => mocks[name] || require(name),
    fetch: async (url, init) => {
      calls.urls.push(url)
      assert.equal(init.headers.Authorization, 'Bearer test-token')
      return { ok: !options.notFound, status: options.notFound ? 404 : 200, json: async () => release }
    },
  }
  // Await main() and its error handler, which is the entry point's final expression.
  await vm.runInNewContext(code, context)
  return { ...calls, extracted }
}

for (const platform of ['linux', 'darwin', 'win32']) {
  for (const arch of ['x64', 'arm64']) {
    test(`installs and exposes mc/mcli on ${platform}/${arch}`, async () => {
      const result = await run({ platform, arch })
      assert.deepEqual(result.errors, [])
      assert.equal(result.copies.length, 2)
      const suffix = platform === 'win32' ? '.exe' : ''
      assert.ok(result.copies[0][0].endsWith(`/mcli${suffix}`))
      assert.ok(result.copies[0][1].endsWith(`/mc${suffix}`))
      assert.ok(result.copies[1][1].endsWith(`/mcli${suffix}`))
      assert.equal(result.cache[0][1], '20260916000000.0.0')
      assert.deepEqual(result.paths, ['/cached'])
    })
  }
}

test('resolves both pinned version formats', async () => {
  for (const version of [tag, tag.slice(8)]) {
    const result = await run({ version })
    assert.ok(result.urls[0].endsWith(`/tags/${tag}`))
    assert.deepEqual(result.errors, [])
  }
})

test('cached installation skips downloads', async () => {
  const result = await run({ cached: true })
  assert.deepEqual(result.downloads, [])
  assert.deepEqual(result.paths, ['/cached'])
})

test('falls back to the published checksum manifest', async () => {
  const result = await run({ manifest: true })
  assert.equal(result.downloads.length, 2)
  assert.deepEqual(result.errors, [])
  assert.equal(result.extracted, true)
})

test('rejects corrupted archives before extracting or caching', async () => {
  const result = await run({ badHash: true })
  assert.match(result.errors[0], /checksum mismatch/)
  assert.equal(result.extracted, false)
  assert.deepEqual(result.paths, [])
  assert.equal(result.cache.length, 1)
})

test('reports unavailable releases', async () => {
  const result = await run({ notFound: true })
  assert.match(result.errors[0], /HTTP 404/)
  assert.deepEqual(result.downloads, [])
})

test('rejects unsupported architectures before network access', async () => {
  const result = await run({ arch: 'arm' })
  assert.match(result.errors[0], /Unsupported platform/)
  assert.deepEqual(result.urls, [])
})

test('rejects malformed versions before network access', async () => {
  const result = await run({ version: '../invalid' })
  assert.match(result.errors[0], /version must be/)
  assert.deepEqual(result.urls, [])
})
