/**
 * Moleculer-ws-client
 * Copyright (c) 2018 ColonelBundy (https://github.com/colonelbundy/moleculer-ws-client)
 * MIT Licensed
 */
import toBuffer = require('blob-to-buffer');
import { Buffer } from 'buffer';
import { EventEmitter2 } from 'eventemitter2';
import * as Errors from './errors';

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
  RESPONSE
}

export interface Packet {
  ack?: number; // Should be set by client if he wants a response
  type: PacketType;
  payload: ActionPacket | EventPacket | ResponsePacket;
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

export type encryption = (packet: Packet) => Promise<Buffer | string | any>;
export type decryption = (message: Buffer | string | any) => Promise<Packet>;

export interface Options {
  responseTimeout?: number;
  eventEmitter?: {
    wildcard: boolean;
    maxListeners: number;
  };
  ws?: {
    perMessageDeflate: boolean;
  };
  secure: boolean;
  encryption?: encryption | 'Binary' | 'JSON';
  decryption?: decryption;
}

// Helper instead of lodash
function isFunction(x) {
  return Object.prototype.toString.call(x) == '[object Function]';
}

export class Client {
  private readonly Emitter: EventEmitter2;
  private socket: WebSocket;
  private logger: Console = console;

  public id: string;
  public props: object;
  public on: EventEmitter2['on'];
  public once: EventEmitter2['once'];
  public onAny: EventEmitter2['onAny'];
  public many: EventEmitter2['many'];
  public addListener: EventEmitter2['addListener'];
  public removeListener: EventEmitter2['removeListener'];
  public removeAllListeners: EventEmitter2['removeAllListeners'];
  public setMaxListeners: EventEmitter2['setMaxListeners'];
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

    this.Setup();
  }

  /**
   * Setup socket
   *
   * @private
   * @memberof Client
   */
  private Setup() {
    this.socket = new ws(
      `${this.options.secure ? 'wss' : 'ws'}://${this.host}`,
      this.options.ws
    );
    this.socket.onopen = this.connectionHandler.bind(this);
    this.socket.onmessage = this.messageHandler.bind(this);
    this.socket.onerror = this.errorHandler.bind(this);
    this.socket.onclose = this.disconnectHandler.bind(this);
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

  private disconnectHandler(e: CloseEvent): void {
    this.Emitter.emit('disconnected', e.reason);
  }

  private connectionHandler(e: Event): void {
    this.Emitter.emit('connected', this);
  }

  private messageHandler(e: MessageEvent): void {
    this.DecodePacket(e.data)
      .then(packet => {
        switch (packet.type) {
          case PacketType.RESPONSE:
            const response = <ResponsePacket>packet.payload;
            this.emitAck(response.id, response.data);
            break;

          default:
          case PacketType.EVENT:
            const event = <EventPacket>packet.payload;
            this.Emitter.emit(event.event, event.data);
            break;
        }
      })
      .catch(e => this.logger.error(e));
  }

  private errorHandler(e: Event): void {
    this.Emitter.emit('error', e);
  }

  private EncodePacket(packet: Packet): Promise<Buffer | string> {
    return new Promise((resolve, reject) => {
      try {
        if (isFunction(this.options.encryption)) {
          const encrypt = <encryption>this.options.encryption; // typescript fix....

          encrypt(packet)
            .then(resolve)
            .catch(err => new Error(err));
        } else {
          switch (this.options.encryption) {
            case 'JSON':
              resolve(JSON.stringify(packet));
              break;

            default:
            case 'Binary':
              resolve(Buffer.from(JSON.stringify(packet)));
              break;
          }
        }
      } catch (e) {
        return reject(new Errors.EncodeError(e));
      }
    });
  }

  private DecodePacket(message: Buffer | string | any): Promise<Packet> {
    return new Promise((resolve, reject) => {
      try {
        if (
          isFunction(this.options.encryption) &&
          isFunction(this.options.decryption)
        ) {
          this.options
            .decryption(message)
            .then(resolve)
            .catch(err => new Error(err));
        } else {
          switch (this.options.encryption) {
            case 'JSON':
              resolve(JSON.parse(message));
              break;

            default:
            case 'Binary':
              if (Browser && message instanceof Blob) {
                return toBuffer(message, (err, bufferedMessage) => {
                  if (err) throw err;

                  resolve(
                    JSON.parse(
                      Buffer.from(bufferedMessage, 'binary').toString('utf8')
                    )
                  );
                });
              }

              resolve(
                JSON.parse(Buffer.from(message, 'binary').toString('utf8'))
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
