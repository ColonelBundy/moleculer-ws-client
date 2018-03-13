/**
 * Moleculer-ws-client
 * Copyright (c) 2018 ColonelBundy (https://github.com/colonelbundy/moleculer-ws-client)
 * MIT Licensed
 */

export class EncodeError extends Error {
  constructor(message?) {
    super('Unable to encode packet' + (message ? ' - ' + message : ''))
  }
}

export class DecodeError extends Error {
  constructor(message?) {
    super('Unable to decode packet' + (message ? ' - ' + message : ''))
  }
}

export class ResponseTimeout extends Error {
  constructor(message = 'Server failed to respond within the alloted time.') {
    super(message)
  }
}

export class ClientError {
  constructor(error) {
    return {
      error
    }
  }
}
