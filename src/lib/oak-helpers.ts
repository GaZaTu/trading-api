import Cron from "./deps/croner.ts"
import type { Middleware } from "./deps/oak.ts"
import { cyan, green, red, yellow } from "./deps/std-fmt.ts"

const X_RESPONSE_TIME = "X-Response-Time"

const getColorForHttpStatus = (status: number) => {
  if (status >= 500) {
    return red
  }
  if (status >= 400) {
    return yellow
  }
  if (status >= 300) {
    return cyan
  }
  if (status >= 200) {
    return green
  }
  return red
}

export const oakLogger = (): Middleware => {
  return async (ctx, next) => {
    let status = undefined as number | undefined
    try {
      await next()
    } catch (error: any) {
      status = error.status ?? undefined
      throw error
    } finally {
      status = status ?? ctx.response.status

      const date = new Date().toISOString()
      const { ip, method, url } = ctx.request
      const responseTime = ctx.response.headers.get(X_RESPONSE_TIME)

      const logString = `[${date} oak] ${ip} "${method} ${url.pathname}" ${status} ${responseTime}`
      const color = getColorForHttpStatus(status)

      console.log(color(logString))
    }
  }
}

export const oakResponseTime = (): Middleware => {
  return async (ctx, next) => {
    const start = Date.now()
    try {
      await next()
    } finally {
      const ms = Date.now() - start
      ctx.response.headers.set(X_RESPONSE_TIME, `${ms}ms`)
    }
  }
}

export const oakJsonError = (options?: { pretty?: boolean, stacktrace?: boolean }): Middleware => {
  return async (ctx, next) => {
    try {
      await next()

      if (!ctx.response.status || (ctx.response.status === 404 && !ctx.response.body)) {
        ctx.throw(404)
      }
    } catch (error: any) {
      ctx.response.status = error.status ?? 500
      ctx.response.type = "application/json"
      ctx.response.body = JSON.stringify({
        errors: [{
          name: error.name,
          message: error.message,
          status: error.status,
          stack: options?.stacktrace ? error.stack : undefined,
        }],
      }, undefined, options?.pretty ? "  " : undefined)

      if (ctx.response.status === 500) {
        console.error(error)
      }
    }
  }
}

const requestsThisDay = new Map<number, Map<number, { count: number, msSpent: number, load: number }>>()
new Cron("0 0 * * *", () => {
  requestsThisDay.clear()
})

export const oakLoadCounter = (): Middleware => {
  return async (ctx, next) => {
    const start = new Date()
    try {
      await next()
    } finally {
      const msSpent = Date.now() - start.getTime()

      const hour = start.getUTCHours()
      const minute = start.getUTCMinutes()

      const requestsThisHour = requestsThisDay.get(hour) ?? new Map<number, { count: number, msSpent: number, load: number }>()
      requestsThisDay.set(hour, requestsThisHour)

      const requestsThisMinute = requestsThisHour.get(minute) ?? { count: 0, msSpent: 0, load: 0 }
      requestsThisHour.set(minute, {
        count: requestsThisMinute.count + 1,
        msSpent: requestsThisMinute.msSpent + msSpent,
        load: requestsThisMinute.load + (Deno.loadavg()[0] ?? 0),
      })
    }
  }
}

const serverStartDate = new Date()
const serverStartYear = serverStartDate.getUTCFullYear()
const serverStartMonth = serverStartDate.getUTCMonth()
const serverStartDay = serverStartDate.getUTCDate()
const serverStartHour = serverStartDate.getUTCHours()
const serverStartMinute = serverStartDate.getUTCMinutes()

export const getOakServerLoad = () => {
  const result = [] as { timestamp: string, requestsPerMinute: number, averageResponseTimeInMs: number, averageSystemLoad: number }[]

  const currentDate = new Date()
  const currentYear = currentDate.getUTCFullYear()
  const currentMonth = currentDate.getUTCMonth()
  const currentDay = currentDate.getUTCDate()
  const currentHour = currentDate.getUTCHours()
  const currentMinute = currentDate.getUTCMinutes()

  const serverStartedToday = (currentYear === serverStartYear && currentMonth === serverStartMonth && currentDay === serverStartDay)

  for (let hour = 0; hour < 24; hour++) {
    let minutes = 0
    let requests = 0
    let responseTimeInMs = 0
    let systemLoad = 0

    const requestsThisHour = requestsThisDay.get(hour)
    if (requestsThisHour) {
      for (let minute = 0; minute < 60; minute++) {
        if (serverStartedToday) {
          if (hour <= serverStartHour && minute < serverStartMinute) {
            continue
          }
        }
        if (hour >= currentHour && minute > currentMinute) {
          break
        }

        const requestsThisMinute = requestsThisHour.get(minute)
        if (requestsThisMinute) {
          const { count, msSpent, load } = requestsThisMinute

          requests += count
          responseTimeInMs += msSpent
          systemLoad += load
        }

        minutes += 1
      }
    }

    const timestamp = new Date()
    timestamp.setUTCHours(hour)
    timestamp.setUTCMinutes(0)
    timestamp.setUTCSeconds(0)
    timestamp.setUTCMilliseconds(0)

    result.push({
      timestamp: timestamp.toISOString(),
      requestsPerMinute: (requests / Math.max(minutes, 1)),
      averageResponseTimeInMs: (responseTimeInMs / Math.max(requests, 1)),
      averageSystemLoad: (systemLoad / Math.max(requests, 1)) / navigator.hardwareConcurrency,
    })
  }

  return result
}
