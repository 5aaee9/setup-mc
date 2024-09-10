import * as core from "@actions/core";
import * as tc from '@actions/tool-cache'
import * as io from '@actions/io'
import * as path from 'path'
import { promises as fs } from 'fs'

import { ok } from 'assert'
import { v4 } from 'uuid'

const baseMinioDownloadUrl = "https://dl.min.io/client/mc/release"
const toolName = "minio-client"

function _getTempDirectory(): string {
  const tempDirectory = process.env['RUNNER_TEMP'] || ''
  ok(tempDirectory, 'Expected RUNNER_TEMP to be defined')
  return tempDirectory
}

async function main() {
  const version = core.getInput("version")

  let dir = tc.find(toolName, version)

  if (!dir) {
    const cacheDir = path.join(_getTempDirectory(), v4())
    await io.mkdirP(cacheDir)
    let versionFileName = ""
    if (version === "latest") {
      versionFileName = "mc"
    } else {
      versionFileName = `mc.RELEASE.${version}`
    }

    // TODO: support other arch and os
    const dst = await tc.downloadTool(`${baseMinioDownloadUrl}/linux-amd64/${versionFileName}`)

    await io.cp(dst, path.join(cacheDir, "mc"))
    dir = await tc.cacheDir(cacheDir, toolName, version)
    await fs.chmod(path.join(dir, "mc"), "755")
  }

  core.addPath(dir)
}

main()
