import { basename, dirname, fromFileUrl, normalize, resolve } from "./deps/std-path.ts"
import * as jsonc from "./deps/std-jsonc.ts"

if (Deno.mainModule) {
  Deno.env.set("DENO_MAINMODULE", Deno.mainModule)
}

const execPath = Deno.execPath()
const execName = basename(execPath)

export const isCompiled = (() => {
  if (execName.length <= 4) {
    return execName !== "deno"
  } else {
    return !execName.startsWith("deno.")
  }
})()

export const appDir = (() => {
  if (isCompiled) {
    return normalize(dirname(execPath))
  } else {
    let mainDirectory = dirname(fromFileUrl(Deno.env.get("DENO_MAINMODULE")!))
    if (mainDirectory.endsWith("src")) {
      mainDirectory = resolve(mainDirectory, "..")
    }
    return normalize(mainDirectory)
  }
})()

export const appdataDir = Deno.env.get("APPDATA_OVERRIDE") ?? resolve(appDir, "data")
await Deno.mkdir(appdataDir, { recursive: true })

const replaceVariablesInConfig = (config: any) => {
  for (const [key, value] of Object.entries(config)) {
    switch (typeof value) {
    case "string":
      config[key] = value
        .replaceAll("$APPDATA", appdataDir)
        .replaceAll("$APP", appDir)
      break

    case "object":
      replaceVariablesInConfig(value ?? {})
      break
    }
  }
}

export const readConfigFile = <T extends Record<string, any>>(): Partial<T> => {
  try {
    const configJson = Deno.readTextFileSync(`${appdataDir}/config.jsonc`)
    const config = jsonc.parse(configJson) as Record<string, any>

    replaceVariablesInConfig(config)

    return config as Partial<T>
  } catch {
    return {}
  }
}
