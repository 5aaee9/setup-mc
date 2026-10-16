import * as core from '@actions/core'
import { HttpClient } from '@actions/http-client'
import * as tc from '@actions/tool-cache'
import * as io from '@actions/io'
import * as path from 'path'
import * as os from 'os'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'

const repository = 'pgsty/mc'
const toolName = 'pgsty-mc'

interface ReleaseAsset {
  name: string
  browser_download_url: string
  digest?: string
}

interface Release {
  tag_name: string
  assets: ReleaseAsset[]
}

const archMap: Record<string, string> = {
  x64: 'amd64',
  arm64: 'arm64',
}

const osMap: Record<string, string> = {
  win32: 'windows',
  darwin: 'darwin',
  linux: 'linux',
}

async function getReleaseResponse(url: string, headers: Record<string, string>) {
  const client = new HttpClient('setup-mc', [], { allowRetries: true, maxRetries: 2 })
  try {
    const response = await client.get(url, headers)
    return { status: response.message.statusCode, body: await response.readBody() }
  } finally {
    client.dispose()
  }
}

async function main() {
  const arch = archMap[os.arch()]
  const system = osMap[process.platform]
  if (!arch || !system) {
    throw new Error(`Unsupported platform: ${process.platform}/${os.arch()}; PGSTY publishes amd64 and arm64 builds for Linux, macOS and Windows`)
  }

  const version = core.getInput('version') || 'latest'
  const tag = version.startsWith('RELEASE.') ? version : `RELEASE.${version}`
  if (version !== 'latest' && !/^RELEASE\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(tag)) {
    throw new Error('version must be latest or a PGSTY release timestamp, optionally prefixed with RELEASE.')
  }

  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  const token = core.getInput('github-token') || process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  const endpoint = version === 'latest' ? 'latest' : `tags/${encodeURIComponent(tag)}`
  const url = `https://api.github.com/repos/${repository}/releases/${endpoint}`
  let response = await getReleaseResponse(url, headers)
  if (response.status === 401 && token) {
    core.info('GitHub rejected the supplied token; retrying public release lookup without authentication')
    delete headers.Authorization
    response = await getReleaseResponse(url, headers)
  }
  if (response.status !== 200) {
    const hint = response.status === 404
      ? `Check that the version exists in https://github.com/${repository}/releases`
      : response.status === 401
        ? 'GitHub API authentication failed'
        : response.status === 403 || response.status === 429
          ? 'GitHub API access was denied or rate limited; provide a valid github-token with access to public repositories'
          : 'GitHub API request failed; try again later'
    throw new Error(`Unable to resolve ${repository} release ${version}: HTTP ${response.status}. ${hint}`)
  }
  const release = JSON.parse(response.body) as Release
  const match = /^RELEASE\.(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/.exec(release.tag_name)
  if (!match) throw new Error(`Unsupported release tag: ${release.tag_name}`)
  // The tool cache requires a concrete semver, not "latest" or a RELEASE timestamp.
  const cacheVersion = `${match.slice(1).join('')}.0.0`
  const suffix = `_${system}_${arch}.tar.gz`
  const asset = release.assets.find(asset => /^(mcli|mc)_/.test(asset.name) && asset.name.endsWith(suffix))
  if (!asset) throw new Error(`Release ${release.tag_name} has no archive for ${system}/${arch}`)

  let dir = tc.find(toolName, cacheVersion, arch)
  const fileSuffix = system === 'windows' ? '.exe' : ''
  if (!dir) {
    core.info(`Installing ${repository} ${release.tag_name} (${asset.name})`)
    const archive = await tc.downloadTool(asset.browser_download_url)
    let expectedHash = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]
    if (!expectedHash) {
      const checksumName = asset.name.slice(0, -suffix.length) + '_checksums.txt'
      const checksums = release.assets.find(asset => asset.name === checksumName)
      if (!checksums) throw new Error(`No SHA-256 checksum available for ${asset.name}`)
      const checksumFile = await tc.downloadTool(checksums.browser_download_url)
      const entry = (await fs.readFile(checksumFile, 'utf8')).split(/\r?\n/)
        .map(line => line.trim().split(/\s+/))
        .find(parts => parts[1]?.replace(/^\*/, '') === asset.name)
      if (!entry || !/^[a-f0-9]{64}$/i.test(entry[0])) {
        throw new Error(`Missing SHA-256 checksum for ${asset.name}`)
      }
      expectedHash = entry[0]
    }
    const actualHash = createHash('sha256').update(await fs.readFile(archive)).digest('hex')
    if (actualHash !== expectedHash.toLowerCase()) throw new Error(`SHA-256 checksum mismatch for ${asset.name}`)

    const extracted = await tc.extractTar(archive)
    const binaryName = asset.name.startsWith('mcli_') ? 'mcli' : 'mc'
    const binary = path.join(extracted, `${binaryName}${fileSuffix}`)
    // Preserve the existing action interface while also exposing PGSTY's mcli name.
    const binDir = path.join(extracted, 'bin')
    await io.mkdirP(binDir)
    for (const name of ['mc', 'mcli']) {
      const target = path.join(binDir, `${name}${fileSuffix}`)
      await io.cp(binary, target)
      await fs.chmod(target, 0o755)
    }
    dir = await tc.cacheDir(binDir, toolName, cacheVersion, arch)
  }

  core.addPath(dir)
  core.info(`Using ${repository} ${release.tag_name}`)
}

main().catch(error => core.setFailed(error instanceof Error ? error.message : String(error)))
