import { readConfigFile } from "gazatu-api-lib/appinfo.ts"
import type { HttpServerConfig } from "gazatu-api-lib/http-server.ts"

export type AppConfig = HttpServerConfig & {
  development: boolean
  authorization: string
}

const configDefaults: AppConfig = {
  development: true,
  host: "127.0.0.1",
  port: 34666,
  authorization: "test",
}

const config = {
  ...configDefaults,
  ...readConfigFile<AppConfig>(),
}

export default config
