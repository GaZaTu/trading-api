import { listen } from "gazatu-api-lib/http-server.ts"
import { Router } from "oak"
import config from "./config.ts"

const proxyRouter = new Router()

proxyRouter.get("/", async ctx => {
  const client = ctx.upgrade()

  const targetUrl = await new Promise<string>((resolve, reject) => {
    client.onerror = reject
    client.onclose = reject

    let clientDidAuth = false
    client.onmessage = message => {
      if (!clientDidAuth) {
        const auth = String(message.data).replace("AUTH ", "")
        if (auth === config.authorization) {
          clientDidAuth = true
        } else {
          client.close(4401, "KEK")
          reject()
        }
        return
      }

      const connect = String(message.data).replace("CONN ", "")
      resolve(connect)
    }
  })

  const target = new WebSocket(targetUrl)
  target.onopen = ev => client.send("REDY")

  target.onerror = ev => client.close(4400, (ev as ErrorEvent).message ?? String(ev))
  client.onerror = ev => target.close()

  target.onclose = ev => client.close(ev.code, ev.reason)
  client.onclose = ev => target.close()

  target.onmessage = msg => client.send(msg.data)
  client.onmessage = msg => target.send(msg.data)
})

const app = await listen(config, [
  proxyRouter,
])
console.log(`listening on ${app.url}`)
