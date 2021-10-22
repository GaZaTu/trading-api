import * as http from 'http'
import * as http2 from 'http2'
import * as Koa from 'koa'
import * as bodyparser from 'koa-bodyparser'
import * as logger from 'koa-logger'
import * as pathmatch from 'koa-path-match'
import * as error from 'koa-json-error'
import * as cors from '@koa/cors'
import * as config from 'config'
import * as ProxyAgent from 'proxy-agent'
import { readFileSync } from 'fs'
import { TraderepublicWebsocket } from './traderepublic'

const route = pathmatch()

const DEVELOPMENT = process.env.NODE_ENV !== 'production'
const LOGGING = DEVELOPMENT

const HTTP_PROXY = process.env.HTTP_PROXY
const HTTP_PROXY_AGENT = HTTP_PROXY ? new ProxyAgent(HTTP_PROXY) : undefined

const createKoaApp = (middlewares: Koa.Middleware[]) => {
  const app = new Koa()

  if (LOGGING) {
    app.use(logger())
  }

  app.use(error({
    format: (err: any, obj: any) => ({
      name: err.name,
      message: err.message,
      type: err.type,
      status: err.status,
      stack: DEVELOPMENT ? err.stack : undefined,
    }),
  }))

  // app.use(jwt({
  //   secret: () => config.get('jwtSecret'),
  //   isRevoked: async (ctx, decoded: any, token) => {
  //     const user = await getManager().findOne(User, {
  //       where: { id: Equal(decoded.id) },
  //       relations: ['roles'],
  //     })

  //     return !!user
  //   },
  //   key: 'user',
  //   passthrough: true,
  // }))

  app.use(cors({
    origin: '*',
    allowHeaders: ['Authorization', 'Content-Type', 'Content-Length'],
  }))

  app.use(bodyparser({
    enableTypes: ['json'],
  }))

  for (const middleware of middlewares) {
    app.use(middleware)
  }

  return [app, app.callback()] as const
}

const createHttpServer = (callback: (req: http.IncomingMessage | http2.Http2ServerRequest, res: http.ServerResponse | http2.Http2ServerResponse) => void) => {
  let server!: http.Server | http2.Http2SecureServer

  if (config.has('httpsConfig')) {
    const httpsConfigSource = config.get('httpsConfig') as any
    const httpsConfig = {
      allowHTTP1: true,
      key: readFileSync(httpsConfigSource.keyPath),
      cert: readFileSync(httpsConfigSource.certPath),
      ca: [readFileSync(httpsConfigSource.caPath)],
    }

    server = http2.createSecureServer(httpsConfig, callback)
  } else {
    server = http.createServer(callback)
  }

  const listen = () =>
    new Promise<void>(resolve => {
      server.listen(config.get('port'), config.get('host'), resolve)
    })

  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve())
    })

  return [server, listen, close] as const
}

const SOCKET = new TraderepublicWebsocket('DE', {
  agent: HTTP_PROXY_AGENT,
})

const getInstrumentByISIN = async (isin: string) => {
  const instrument = await SOCKET.instrument(isin)
  const ticker = await SOCKET.ticker(instrument).toPromise()

  return {
    shortName: instrument.shortName,
    bidPrice: ticker.bid.price,
  }
}

const ROUTES = [
  route('/instruments').get(async ctx => {
    let q = ctx.query.q as string
    if (!q) {
      ctx.throw(400)
    }

    if (q.length === 12) {
      const instrument = await getInstrumentByISIN(q)

      if (instrument) {
        ctx.response.type = 'application/json'
        ctx.response.body = [instrument]

        return
      }
    }

    const results = await SOCKET.search(q)
    const instruments = await Promise.all(
      results.map(({ isin }) => getInstrumentByISIN(isin))
    )

    ctx.response.type = 'application/json'
    ctx.response.body = instruments
  }),
  route('/instruments/:isin(\\w+)').get(async ctx => {
    let isin = ctx.params.isin as string
    if (isin.length !== 12) {
      ctx.throw(400)
    }

    const instrument = await getInstrumentByISIN(isin)

    ctx.response.type = 'application/json'
    ctx.response.body = instrument
  }),
]

; (async () => {
  const [app, callback] = createKoaApp(ROUTES)
  const [server, listen] = createHttpServer(callback)

  await listen()

  console.log('listening')
})().catch(console.error)
