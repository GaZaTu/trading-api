import { oakCors } from "./deps/cors.ts"
import { Application, Middleware, Router, send } from "./deps/oak.ts"
import { exists, existsSync } from "./deps/std-fs.ts"
import { join } from "./deps/std-path.ts"
import { oakJsonError, oakLoadCounter, oakLogger, oakResponseTime } from "./oak-helpers.ts"

export type HttpServerConfig = {
  development?: boolean
  host: string
  port: number
  behindProxy?: boolean
  https?: {
    key: string
    cert: string
  }
  staticDir?: string
  static404File?: string
  staticVolatileFilesMap?: Record<string, boolean>
}

const httpsConfig = (config: HttpServerConfig) => {
  if (!config.https) {
    return undefined
  }

  const httpsConfig = {
    key: Deno.readTextFileSync(config.https.key),
    cert: Deno.readTextFileSync(config.https.cert),
  }

  return httpsConfig
}

export const createApplication = (config: HttpServerConfig, middlewares: (Router | Middleware | undefined)[]) => {
  const app = new Application({
    proxy: config.behindProxy ?? false,
    logErrors: false,
  })

  app.use(oakLoadCounter())

  if (config.development) {
    app.use(oakLogger())
    app.use(oakResponseTime())
  }

  app.use(oakCors({
    origin: "*",
    allowedHeaders: ["Content-Type", "Authorization"],
  }))

  app.use(oakJsonError({
    pretty: config.development,
    stacktrace: config.development,
  }))

  if (config.behindProxy) {
    app.use(async (ctx, next) => {
      ctx.response.headers.set("Keep-Alive", "timeout=60")

      await next()
    })
  } else {
    app.use(async (ctx, next) => {
      // form-action 'self';
      ctx.response.headers.set("Content-Security-Policy", "script-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; worker-src 'self' blob:; trusted-types *;")

      ctx.response.headers.set("X-Frame-Options", "SAMEORIGIN")
      ctx.response.headers.set("X-Content-Type-Options", "nosniff")
      ctx.response.headers.set("X-XSS-Protection", "1; mode=block;")
      ctx.response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains;")
      ctx.response.headers.set("Referrer-Policy", "no-referrer")

      await next()
    })
  }

  for (const middleware of middlewares) {
    if (!middleware) {
      continue
    }

    if (middleware instanceof Router) {
      app.use(middleware.routes())
      app.use(middleware.allowedMethods())
    } else {
      app.use(middleware)
    }
  }

  if (config.staticDir && existsSync(config.staticDir)) {
    app.use(async ctx => {
      let path = ctx.request.url.pathname
      if (path.endsWith("/")) {
        path = config.static404File ?? ""
      }
      if (!await exists(join(config.staticDir!, path))) {
        path = config.static404File ?? ""
      }

      await send(ctx, path, {
        root: config.staticDir!,
        immutable: !(config.staticVolatileFilesMap?.[path]),
      })
    })
  }

  return app
}

export const createHttpRedirectServer = (config: { host: string, port: number }) => {
  return new Promise(resolve => {
    Deno.serve({
      hostname: config.host,
      port: 80,
      handler: request => {
        const redirectUrl = new URL(request.url)
        redirectUrl.protocol = "https:"
        redirectUrl.port = String(config.port)

        const response = Response.redirect(redirectUrl, 301)
        return response
      },
      onListen: resolve,
    })
  })
}

export const listen = async (config: HttpServerConfig, middlewares: (Router | Middleware | undefined)[]) => {
  const app = createApplication(config, middlewares)
  app.listen({
    hostname: config.host,
    port: config.port,
    ...httpsConfig(config),
  })

  await new Promise(r => app.addEventListener("listen", r))

  if (config.https && !config.behindProxy && config.port === 443) {
    await createHttpRedirectServer(config)
  }

  return Object.assign(app, {
    url: new URL(`${config.https ? "https" : "http"}://${config.host}:${config.port}`),
    host: config.host,
    port: config.port,
  })
}
