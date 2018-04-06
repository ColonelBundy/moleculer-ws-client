/**
 * Moleculer-ws-client
 * Copyright (c) 2018 ColonelBundy (https://github.com/colonelbundy/moleculer-ws-client)
 * MIT Licensed
 */
import { EventEmitter2 } from 'eventemitter2';
import * as Errors from './errors';
export { Errors };

let ws,
  Browser = false;

if (typeof window === 'undefined') {
  ws = require('ws');
} else {
  ws = global['WebSocket'] || global['MozWebSocket'];
  Browser = true;
}

export enum PacketType {
  EVENT,
  ACTION,
  RESPONSE,
  SYNC
}

export interface Packet {
  ack?: number; // Should be set by client if he wants a response
  type: PacketType;
  payload: ActionPacket | EventPacket | ResponsePacket | syncPacket;
}

export interface syncPacket {
  props: object;
  authorized: boolean;
}

export interface ActionPacket {
  name: string;
  action: string;
  data: any;
}

export interface EventPacket {
  event: string;
  data: any;
}

export interface ResponsePacket {
  id: number;
  data: any;
}

export type encryption = (
  packet: Packet
) => Promise<ArrayBuffer | string | any>;
export type decryption = (
  message: ArrayBuffer | string | any
) => Promise<Packet>;

export interface Options {
  reconnect?: {
    interval: 5000;
    retries: 0;
  };
  responseTimeout?: number;
  eventEmitter?: {
    wildcard: boolean;
    maxListeners: number;
  };
  ws?: any; // Websocket options goes here (@TODO interface for it)
  secure: boolean;
  encryption?: encryption | 'Binary' | 'JSON';
  decryption?: decryption;
}

// Helper instead of lodash, Thanks icebob
function isFunction(x) {
  return Object.prototype.toString.call(x) == '[object Function]';
}

export class Client {
  private readonly Emitter: EventEmitter2;
  private socket: WebSocket;
  private logger: Console = console;

  public id: string;
  public props: object;
  public authorized: boolean = false;
  public on: EventEmitter2['on'];
  public once: EventEmitter2['once'];
  public onAny: EventEmitter2['onAny'];
  public many: EventEmitter2['many'];
  public addListener: EventEmitter2['addListener'];
  public removeListener: EventEmitter2['removeListener'];
  public removeAllListeners: EventEmitter2['removeAllListeners'];
  public setMaxListeners: EventEmitter2['setMaxListeners'];
  private reconnect_tries: number = 0;
  private ack: number = 0;
  private host: string;
  private options: Options = {
    // Defaults
    responseTimeout: 30000,
    eventEmitter: {
      wildcard: true,
      maxListeners: 50
    },
    secure: false,
    encryption: 'Binary'
  };

  constructor(host: string, options?: Options) {
    this.options = { ...this.options, ...options };
    this.host = host;

    this.Emitter = new EventEmitter2({
      newListener: false, // Prevent wildcard catching this.
      ...this.options.eventEmitter
    });

    this.on = this.Emitter.on.bind(this.Emitter);
    this.once = this.Emitter.once.bind(this.Emitter);
    this.onAny = this.Emitter.onAny.bind(this.Emitter);
    this.many = this.Emitter.many.bind(this.Emitter);
    this.addListener = this.Emitter.addListener.bind(this.Emitter);
    this.removeListener = this.Emitter.removeListener.bind(this.Emitter);
    this.removeAllListeners = this.Emitter.removeAllListeners.bind(
      this.Emitter
    );
    this.setMaxListeners = this.Emitter.setMaxListeners.bind(this.Emitter);

    if (this.host.match('wss://')) {
      this.options.secure = true;
    } else if (this.host.match('ws://')) {
      this.options.secure = false;
    } else {
      if (this.options.secure) {
        this.host = `wss://${this.host}`;
      } else {
        this.host = `ws://${this.host}`;
      }
    }

    this.Setup();
  }

  /**
   * Setup socket
   *
   * @private
   * @memberof Client
   */
  private Setup(): void {
    this.socket = new ws(this.host, this.options.ws);
    this.socket.onopen = this.connectionHandler.bind(this);
    this.socket.onmessage = this.messageHandler.bind(this);
    this.socket.onerror = this.errorHandler.bind(this);
    this.socket.onclose = this.disconnectHandler.bind(this);
    this.socket.binaryType = 'arraybuffer';
  }

  /**
   * Manual disconnect
   *
   * @returns {void}
   * @memberof Client
   */
  public disconnect(reason?: string): void {
    if (this.socket.readyState !== this.socket.OPEN) return;

    this.socket.close(2001, reason); // Indicate normal closure (custom code)
  }

  /**
   * Authenticate
   *
   * @param {object} data
   * @returns
   * @memberof Client
   */
  public authenticate(data: object): Promise<Object> {
    this.send(<Packet>{
      type: PacketType.ACTION,
      ack: this.ack,
      payload: <ActionPacket>{ name: 'internal', action: 'auth', data }
    });
    return this.ExpectResponse();
  }

  /**
   * Deauthenticate
   *
   * @param {object} [data]
   * @returns {Promise<Object>}
   * @memberof Client
   */
  public deauthenticate(data?: object): Promise<Object> {
    this.send(<Packet>{
      type: PacketType.ACTION,
      ack: this.ack,
      payload: <ActionPacket>{ name: 'internal', action: 'deauth', data }
    });
    return this.ExpectResponse();
  }

  /**
   * Emit event
   *
   * @param {string} event
   * @param {object} data
   * @memberof Client
   */
  public emitEvent(event: string, data: object): void {
    this.send(<Packet>{
      type: PacketType.EVENT,
      payload: <EventPacket>{ event, data }
    });
  }

  /**
   * Call event
   *
   * @param {string} event
   * @param {object} data
   * @returns
   * @memberof Client
   */
  public callEvent(event: string, data: object): Promise<object> {
    this.send(<Packet>{
      type: PacketType.EVENT,
      ack: this.ack,
      payload: <EventPacket>{ event, data }
    });
    return this.ExpectResponse();
  }

  /**
   * Emit action
   *
   * @param {string} name
   * @param {string} action
   * @param {object} data
   * @memberof Client
   */
  public emit(name: string, action: string, data: object): void {
    this.send(<Packet>{
      type: PacketType.ACTION,
      payload: <ActionPacket>{ name, action, data }
    });
  }

  /**
   * Call action
   *
   * @param {string} name
   * @param {string} action
   * @param {object} data
   * @returns
   * @memberof Client
   */
  public call(name: string, action: string, data: object): Promise<object> {
    this.send(<Packet>{
      type: PacketType.ACTION,
      ack: this.ack,
      payload: <ActionPacket>{ name, action, data }
    });
    return this.ExpectResponse();
  }

  /**
   * Helper function
   *
   * @private
   * @param {Packet} packet
   * @returns
   * @memberof Client
   */
  private send(packet: Packet): void {
    if (this.socket.readyState !== this.socket.OPEN) return;

    this.EncodePacket(packet)
      .then(d => {
        this.socket.send(d);
      })
      .catch(e => this.logger.error(e));
  }

  /**
   * Helper function
   *
   * @private
   * @returns
   * @memberof Client
   */
  private ExpectResponse(): Promise<object> {
    return new Promise((resolve, reject) => {
      const event = `_ack_${this.ack}`;
      this.ack++;

      // Only to remove event listener, if for some reason we don't get a response
      const timeout = setTimeout(() => {
        this.Emitter.removeListener(event, () =>
          reject(new Errors.ResponseTimeout())
        );
      }, this.options.responseTimeout | 30000); // 30 seconds default

      this.Emitter.once(event, (data: object) => {
        clearTimeout(timeout);

        if (data.hasOwnProperty('error')) {
          // Catch any errors and reject.
          return reject(data['error']);
        }

        return resolve(data);
      });
    });
  }

  /**
   * Helper function
   *
   * @private
   * @param {Packet} packet
   * @returns
   * @memberof Client
   */
  private emitAck(id: number, data: any): void {
    this.Emitter.emit(`_ack_${id}`, data);
  }

  /**
   * Disconnect handler, also handles reconnects
   *
   * @private
   * @param {CloseEvent} e
   * @memberof Client
   */
  private disconnectHandler(e: CloseEvent): void {
    this.props = {}; // reset
    this.authorized = false;

    if (e.code === 2001) {
      this.Emitter.emit('disconnected', e.reason);
      return;
    }

    // Only reconnect only if it's unexpected
    if (
      this.options.reconnect &&
      this.options.reconnect.retries > 0 &&
      this.options.reconnect.retries >= this.reconnect_tries
    ) {
      setTimeout(() => {
        this.reconnect_tries++;
        this.Setup();
        this.Emitter.emit('reconnect', this.reconnect_tries);
      }, Math.random() * (this.options.reconnect.interval - this.options.reconnect.interval / 2) + this.options.reconnect.interval / 2); // Random interval between (interval/2) and your interval
    }

    if (this.reconnect_tries === 0) {
      this.Emitter.emit('disconnected', e.reason);
    }
  }

  /**
   * Connection handler
   *
   * @private
   * @param {Event} e
   * @memberof Client
   */
  private connectionHandler(e: Event): void {
    this.reconnect_tries = 0;
    this.Emitter.emit('connected', this);
  }

  /**
   * Handle incoming messages
   *
   * @private
   * @param {MessageEvent} e
   * @memberof Client
   */
  private messageHandler(e: MessageEvent): void {
    this.DecodePacket(e.data)
      .then(packet => {
        switch (packet.type) {
          case PacketType.SYNC: // sync properties
            const sync = <syncPacket>packet.payload;
            this.props = sync.props;
            this.authorized = sync.authorized;
            break;

          case PacketType.RESPONSE: // Response from server
            const response = <ResponsePacket>packet.payload;
            this.emitAck(response.id, response.data);
            break;

          default:
          case PacketType.EVENT: // Event
            const event = <EventPacket>packet.payload;
            this.Emitter.emit(event.event, event.data);
            break;
        }
      })
      .catch(e => this.logger.error(e));
  }

  /**
   * ErrorHandler
   *
   * @private
   * @param {Event} e
   * @memberof Client
   */
  private errorHandler(e: Event): void {
    this.Emitter.emit('error', e);
  }

  /**
   * Encode packet
   *
   * @private
   * @param {Packet} packet
   * @returns {(Promise<ArrayBuffer | string>)}
   * @memberof Client
   */
  private EncodePacket(packet: Packet): Promise<ArrayBuffer | string> {
    return new Promise((resolve, reject) => {
      try {
        if (isFunction(this.options.encryption)) {
          const encrypt = <encryption>this.options.encryption; // typescript fix....

          encrypt(packet)
            .then(resolve)
            .catch(err => new Errors.EncodeError(err));
        } else {
          switch (this.options.encryption) {
            case 'JSON':
              resolve(JSON.stringify(packet));
              break;

            default:
            case 'Binary':
              resolve(
                new Uint8Array(
                  JSON.stringify(packet)
                    .split('')
                    .map(c => c.charCodeAt(0))
                ).buffer
              );
              break;
          }
        }
      } catch (e) {
        return reject(new Errors.EncodeError(e));
      }
    });
  }

  /**
   * Decode packet
   *
   * @private
   * @param {(ArrayBuffer | string | any)} message
   * @returns {Promise<Packet>}
   * @memberof Client
   */
  private DecodePacket(message: ArrayBuffer | string | any): Promise<Packet> {
    return new Promise((resolve, reject) => {
      try {
        if (
          isFunction(this.options.encryption) &&
          isFunction(this.options.decryption)
        ) {
          this.options
            .decryption(message)
            .then(resolve)
            .catch(err => new Errors.DecodeError(err));
        } else {
          switch (this.options.encryption) {
            case 'JSON':
              resolve(JSON.parse(message));
              break;

            default:
            case 'Binary': // Convert arraybuffer
              resolve(
                JSON.parse(
                  new Uint8Array(message).reduce(
                    (p, c) => p + String.fromCharCode(c),
                    ''
                  )
                )
              );
              break;
          }
        }
      } catch (e) {
        return reject(new Errors.DecodeError(e));
      }
    });
  }
}
