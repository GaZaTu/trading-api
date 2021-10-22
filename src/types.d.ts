declare module 'koa-path-match' {
  import * as Koa from 'koa'

  interface Middleware extends Koa.Middleware {
    get(handler: Koa.Middleware): Middleware

    post(handler: Koa.Middleware): Middleware

    put(handler: Koa.Middleware): Middleware

    delete(handler: Koa.Middleware): Middleware
  }

  type route = (path: string, handler?: Koa.Middleware) => Middleware

  function KoaPathMatch(options?: any): route

  namespace KoaPathMatch {}

  export = KoaPathMatch
}
