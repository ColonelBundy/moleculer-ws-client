/**
 * Moleculer-ws-client
 * Copyright (c) 2018 ColonelBundy (https://github.com/colonelbundy/moleculer-ws-client)
 * MIT Licensed
 */

import _ = require('lodash');
import Bluebird = require('bluebird');
import Buffer = require('buffer/');
import { EventEmitter2 } from 'eventemitter2';
import * as Errors from './errors';

let ws, Browser = false;

if (_.isNil(window)) {
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
  ack?: number // Should be set by client if he wants a response
  type: PacketType,
  payload: ActionPacket | EventPacket | ResponsePacket
}

export interface ActionPacket {
  name: string,
  action: string,
  data: any
}

export interface EventPacket {
  event: string,
  data: any
}

export interface ResponsePacket {
  id: number,
  data: any
}


export type encryption = (packet: Packet) => Bluebird<Buffer | string | any>;
export type decryption = (message: Buffer | string | any) => Bluebird<Packet>;

export interface Options {
  responseTimeout?: number,
  eventEmitter?: {
    wildcard: boolean,
    maxListeners: number
  },
  ws?: {
    perMessageDeflate: boolean,
  },
  secure: boolean,
  encryption?: 'Binary' | 'JSON' | encryption,
  decryption?: decryption,
}

export class Client {
  private readonly Emitter: EventEmitter2;
  private options: Options;
  private socket: WebSocket;
  private logger = console;

  public id: string;
  public props: object;
  public on: EventEmitter2['on'] = this.Emitter.on.bind(this.Emitter);
  public once: EventEmitter2['once'] = this.Emitter.on.bind(this.Emitter);
  public onAny: EventEmitter2['onAny'] = this.Emitter.onAny.bind(this.Emitter);
  public many: EventEmitter2['many'] = this.Emitter.many.bind(this.Emitter);
  public addListener: EventEmitter2['addListener'] = this.Emitter.addListener.bind(this.Emitter);
  public removeListener: EventEmitter2['removeListener'] = this.Emitter.removeListener.bind(this.Emitter);
  public removeAllListeners: EventEmitter2['removeAllListeners'] = this.Emitter.removeAllListeners.bind(this.Emitter);
  public setMaxListeners: EventEmitter2['setMaxListeners'] = this.Emitter.setMaxListeners.bind(this.setMaxListeners);
  private ack: 0;

  constructor(host: string, options?: Options) {
    this.socket = new ws(`${options.secure ? 'wss' : 'ws'}://${host}`, options.ws);
    this.options = options;

    this.Emitter = new EventEmitter2(_.extend({ // default settings
      newListener: false, // Prevent wildcard catching this.
      wildcard: true
    }, options.eventEmitter));
    
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
  public authenticate(data: object): Bluebird<Object> {
    this.send(<Packet>{ 
      type: PacketType.ACTION,
      ack: this.ack,
      payload: <ActionPacket>{ name: 'internal', action: 'auth', data }
    })
    return this.ExpectResponse();
  }

  /**
   * Emit event
   * 
   * @param {string} event 
   * @param {object} data 
   * @memberof Client
   */
  public emitEvent(event: string, data: object) : void {
    this.send(<Packet>{ 
      type: PacketType.EVENT,
      payload: <EventPacket>{ event, data }
    })
  }

  /**
   * Call event
   * 
   * @param {string} event 
   * @param {object} data 
   * @returns 
   * @memberof Client
   */
  public callEvent(event: string, data: object) : Bluebird<object> {
    this.send(<Packet>{ 
      type: PacketType.EVENT,
      ack: this.ack,
      payload: <EventPacket>{ event, data }
    })
    return this.ExpectResponse()
  }

   /**
   * Emit action
   * 
   * @param {string} name 
   * @param {string} action 
   * @param {object} data 
   * @memberof Client
   */
  public emit(name: string, action: string, data: object) : void {
    this.send(<Packet>{ 
      type: PacketType.ACTION,
      payload: <ActionPacket>{ name, action, data }
    })
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
  public call(name: string, action: string, data: object) : Bluebird<object> {
    this.send(<Packet>{ 
      type: PacketType.ACTION,
      ack: this.ack,
      payload: <ActionPacket>{ name, action, data }
    })
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
  private send(packet: Packet) : void {
    if (this.socket.readyState !== this.socket.OPEN)
      return;

    this.EncodePacket(packet).then(d => {
      this.socket.send(d);
    }).catch(e => this.logger.error(e));
  }

  /**
   * Helper function
   * 
   * @private
   * @returns 
   * @memberof Client
   */
  private ExpectResponse(dataOnly: boolean = true) : Bluebird<Packet | object> {
    return new Bluebird.Promise((resolve, reject) => {
      this.ack++;
      const event = `_ack_${this.ack}`;

      // Only to remove event listener, if for some reason we don't get a response
      const timeout = setTimeout(() => {
        this.Emitter.removeListener(event, () => reject());
      }, this.options.responseTimeout | 30000); // 30 seconds default

      this.Emitter.once(event, (packet: ResponsePacket) => {
        clearTimeout(timeout);

        if (packet.data.error) { // Catch any errors and reject.
          return reject(new Errors.ClientError(packet.data.error));
        }

        return resolve((dataOnly ? packet.data : packet));
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
  private emitAck(id: number, data: any) : void {
    this.Emitter.emit(`_ack_${id}`, data);
  } 

  private disconnectHandler(e: CloseEvent) : void {
    this.Emitter.emit('disconnect', e.reason);
  }

  private connectionHandler(e: Event) : void {
    this.Emitter.emit('connection', this);
  }

  private messageHandler(e: MessageEvent) : void {
    this.DecodePacket(e.data).then((packet) => {

      switch(packet.type) {
        case PacketType.RESPONSE:
          const response = <ResponsePacket>packet.payload;
          this.emitAck(response.id, response.data)
        break;

        default:
          case PacketType.EVENT:
          const event = <EventPacket>packet.payload;
          this.Emitter.emit(event.event, event.data);
        break;
      }
    }).catch(e => this.logger.error(e));
  }

  private errorHandler(e: Event) : void {
    this.logger.error(<any>e);
  }

  private EncodePacket(packet: Packet): Bluebird<Buffer | string> {
    return new Bluebird.Promise((resolve, reject) => {
      try {
        if(_.isFunction(this.options.encryption)) {
          this.options.encryption(packet).then(resolve).catch(err => new Error(err));
        } else {
          switch (this.options.encryption) {
            case 'JSON':
                resolve(JSON.stringify(packet));
            break;
  
            default:
            case 'Binary':
                resolve(new Buffer(JSON.stringify(packet)));
            break;
          }
        }
      } catch (e) {
        return reject(new Errors.EncodeError(e));
      }
    });
  }

  private DecodePacket(message: Buffer | string | any): Bluebird<Packet> {
    return new Bluebird.Promise((resolve, reject) => {
      try {
        if(_.isFunction(this.options.encryption) && _.isFunction(this.options.decryption)) {
            this.options.decryption(message).then(resolve).catch(err => new Error(err));
        } else {
          switch (this.options.encryption) {
            case 'JSON':
                resolve(JSON.parse(message));
            break;
  
            default:
            case 'Binary':
              resolve(JSON.parse(Buffer.from(message, 'binary').toString('utf8')));
            break;
          }
        }
      } catch (e) {
        return reject(new Errors.DecodeError(e));
      }
    });
  }
}