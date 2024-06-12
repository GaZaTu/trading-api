import { appdataDir } from "./appinfo.ts"
import * as jwt from "./deps/djwt.ts"
import { exists } from "./deps/std-fs.ts"
import { dirname } from "./deps/std-path.ts"

const generateCachedCryptoKey = async (keyPathWithoutExtname: string, algorithm: AesKeyGenParams | HmacKeyGenParams, extractable: boolean, keyUsages: KeyUsage[]): Promise<CryptoKey> => {
  const keySettings = [algorithm, extractable, keyUsages] as const
  const keyFormat = "jwk"
  const keyPath = `${keyPathWithoutExtname}.${keyFormat}`

  if (await exists(keyPath)) {
    const keyAsString = await Deno.readTextFile(keyPath)
    const keyAsJWK = JSON.parse(keyAsString) as JsonWebKey

    const key = await crypto.subtle.importKey(keyFormat, keyAsJWK, ...keySettings)
    return key
  } else {
    const key = await crypto.subtle.generateKey(...keySettings) as CryptoKey

    const keyAsJWK = await crypto.subtle.exportKey(keyFormat, key)
    await Deno.mkdir(dirname(keyPath), { recursive: true })
    await Deno.writeTextFile(keyPath, JSON.stringify(keyAsJWK))

    return key
  }
}

const key = await generateCachedCryptoKey(`${appdataDir}/jwt-key`, { name: "HMAC", hash: "SHA-512" }, true, ["sign", "verify"])

export const createJWT = async <P extends Record<string, any>>(data: P) => {
  const token = await jwt.create({ alg: "HS512" }, data, key)
  return token
}

export const verifyJWT = async <P extends Record<string, any>>(token: string) => {
  const payload = await jwt.verify(token, key, {})
  return payload as P
}
