import { appDir, appdataDir } from "./appinfo.ts"
import { exists, walk } from "./deps/std-fs.ts"
import { fromFileUrl } from "./deps/std-path.ts"

class Bundle {
  private static readonly files = new Map<string, { size: number, load: () => Promise<Uint8Array> }>([
    /* BUNDLED_FILES */
  ])

  public static async initialize() {
    if (Bundle.files.size) {
      return
    }

    const bundleDir = `${appDir}/src/bundle`
    if (!await exists(bundleDir)) {
      return
    }

    for await (const walkEntry of walk(bundleDir)) {
      if (walkEntry.isDirectory) {
        continue
      }

      const path = walkEntry.path.replace(bundleDir, "")
      const size = (await Deno.stat(walkEntry.path)).size
      const load = () => {
        return Deno.readFile(walkEntry.path)
      }

      Bundle.files.set(path, { size, load })
    }
  }

  /**
   * executes `deno task compile`
   */
  static async package() {
    const bundleDir = `${appdataDir}/bundle`
    await Deno.mkdir(bundleDir, { recursive: true })

    const getBundledFilePath = (file: string) => {
      return `${bundleDir}/${file.replaceAll(/[/.]/g, "_")}.js`
    }

    for (const [file, { load }] of Bundle.files.entries()) {
      await Deno.writeTextFile(getBundledFilePath(file), `export const bytes = new Uint8Array(${JSON.stringify([...await load()])})`)
    }

    const bundleTSPath = fromFileUrl(import.meta.url)
    const bundleTSOriginal = await Deno.readTextFile(bundleTSPath)
    const bundleTSAltered = bundleTSOriginal.replace(`/* ${"BUNDLED_FILES"} */`,
      Array.from(Bundle.files.entries())
        .map(([file, { size }]) => `[${JSON.stringify(file)}, { size: ${size}, load: () => import(${JSON.stringify(getBundledFilePath(file))}).then(f => f.bytes) }],`)
        .join("\n    ")
    )

    await Deno.writeTextFile(bundleTSPath, bundleTSAltered)
    try {
      const compile = new Deno.Command(Deno.execPath(), {
        args: ["task", "compile"],
      })

      await compile.spawn().output()
    } finally {
      await Deno.writeTextFile(bundleTSPath, bundleTSOriginal)
      await Deno.remove(bundleDir, { recursive: true })
    }
  }

  static readonly existsSync = function (path: string) {
    const exists = Bundle.files.has(path)
    return exists
  }

  static readonly statSync = function (path: string) {
    const file = Bundle.files.get(path)
    if (!file) {
      throw new Error(`bundled file "${path}" not found`)
    }

    return {
      size: file.size,
    }
  }

  static readonly readFile = async function (path: string) {
    const file = Bundle.files.get(path)
    if (!file) {
      throw new Error(`bundled file "${path}" not found`)
    }

    const bytes = await file.load()
    return bytes
  }

  static readonly readTextFile = async function (path: string) {
    const bytes = await Bundle.readFile(path)

    const text = new TextDecoder().decode(bytes)
    return text
  }

  static readonly readDirSync = function* (path: string, {}: { filesOnly: true }) {
    if (!path.endsWith("/")) {
      path += "/"
    }

    for (const bundledPath of Bundle.files.keys()) {
      if (bundledPath.startsWith(path)) {
        const fileName = bundledPath.replace(path, "")

        if (!fileName.includes("/")) {
          yield {
            name: fileName,
            path: bundledPath,
          }
        }
      }
    }
  }
}

export default Bundle
await Bundle.initialize()
