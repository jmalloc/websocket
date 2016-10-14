import {EventEmitter} from 'events'

import OverpassFailure from './failure'

export default class OverpassSession extends EventEmitter {
  constructor ({id, connection, setTimeout, clearTimeout, log}) {
    super()

    this._id = id
    this._connection = connection
    this._setTimeout = setTimeout
    this._clearTimeout = clearTimeout
    this._log = log

    this._destroyError = null
    this._callSeq = 0
    this._calls = {}
  }

  destroy () {
    if (this._log) this._log('Destroying session.')

    this._connection._send({type: 'session.destroy', session: this._id})
    this._destroy(new Error('Session destroyed locally.'))
  }

  send (namespace, command, payload) {
    if (this._destroyError) throw this._destroyError

    this._connection._send({
      type: 'command.request',
      session: this._id,
      namespace,
      command,
      payload
    })
  }

  call (namespace, command, payload, timeout, callback) {
    if (this._destroyError) {
      callback(this._destroyError)

      return
    }

    const seq = ++this._callSeq
    const timeoutId = this._setTimeout(
      () => {
        delete this._calls[seq]
        callback(new Error(
          "Call to '" + command + "' in namespace '" + namespace +
          "' timed out after " + timeout + 'ms.'
        ))
      },
      timeout
    )
    this._calls[seq] = {callback, timeout: timeoutId}

    this._connection._send({
      type: 'command.request',
      session: this._id,
      namespace,
      command,
      payload,
      seq,
      timeout
    })
  }

  _dispatch (message) {
    switch (message.type) {
      case 'session.destroy': return this._dispatchSessionDestroy(message)
      case 'command.response': return this._dispatchCommandResponse(message)
    }
  }

  _dispatchSessionDestroy () {
    this._destroy(new Error('Session destroyed remotely.'))
  }

  _dispatchCommandResponse (message) {
    const call = this._calls[message.seq]
    if (!call) return

    this._clearTimeout(call.timeout)

    switch (message.responseType) {
      case 'success':
        call.callback(null, message.payload)

        break

      case 'failure':
        call.callback(new OverpassFailure(
          message.payload.type,
          message.payload.message,
          message.payload.data
        ))

        break

      case 'error':
        call.callback(new Error('Server error.'))

        break

      default:
        this._connection._closeError(new Error(
          'Unexpected command response type: ' + message.responseType + '.'
        ))
    }

    delete this._calls[message.seq]
  }

  _destroy (error) {
    this._destroyError = error

    for (let seq in this._calls) {
      const call = this._calls[seq]

      this._clearTimeout(call.timeout)
      call.callback(error)
    }

    this._calls = {}

    this.emit('destroy', error)
  }
}