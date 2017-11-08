var EventEmitter = require('events').EventEmitter

var RinqContext = require('./context')

function RinqSessionManager (
  connectionManager,
  setTimeout,
  clearTimeout,
  logger,
  log
) {
  var connection             // the underlying connection
  var debugSymbol            // the Unicode symbol used when logging debug information
  var emit                   // a convenience for this.emit, bound to this
  var sessionManager         // a convenience for this
  var notificationNamespaces // an array of notification namespaces currently being listened on

  EventEmitter.call(this)
  emit = this.emit.bind(this)

  sessionManager = this

  debugSymbol = '\uD83D\uDC1E'
  connection = null
  notificationNamespaces = []

  this.isStarted = false
  this.session = null

  this.start = function start () {
    if (sessionManager.isStarted) return

    if (log && log.debug) {
      logger(
        [
          '%c%s %sStarting.',
          'color: green',
          debugSymbol,
          log.prefix
        ]
      )
    }

    sessionManager.isStarted = true

    connection = connectionManager.connection
    connectionManager.on('connection', onConnection)
    connectionManager.on('error', onError)
    connectionManager.start()

    if (connection) onConnection(connection)
  }

  this.stop = function stop () {
    if (!sessionManager.isStarted) return

    if (log && log.debug) {
      logger(
        [
          '%c%s %sStopping.',
          'color: orange',
          debugSymbol,
          log.prefix
        ]
      )
    }

    connectionManager.removeListener('connection', onConnection)
    connectionManager.removeListener('error', onError)
    if (connection) connection.removeListener('close', onClose)

    sessionManager.isStarted = false

    if (sessionManager.session) {
      sessionManager.session.removeListener('destroy', onDestroy)
      sessionManager.session.destroy()
      sessionManager.session = null
    }
  }

  this.execute = function execute (namespace, command, payload) {
    if (!sessionManager.session) throw new Error('No session available.')

    return sessionManager.session.execute(namespace, command, payload)
  }

  this.call = function call (namespace, command, payload, timeout, callback) {
    if (!sessionManager.session) {
      callback(new Error('No session available.'))

      return
    }

    sessionManager.session.call(namespace, command, payload, timeout, callback)
  }

  this.listen = function listen () {
    for (var namespace of arguments) {
      if (!notificationNamespaces.includes(namespace)) {
        notificationNamespaces.push(namespace)
      }
    }

    var currentSession = sessionManager.session
    if (currentSession) {
      currentSession.listen.apply(currentSession, arguments)
    }
  }

  this.unlisten = function unlisten () {
    var namespaces = Array.prototype.slice.call(arguments)

    notificationNamespaces = notificationNamespaces.filter(function (namespace) {
      return !namespaces.includes(namespace)
    })

    var currentSession = sessionManager.session
    if (currentSession) {
      currentSession.unlisten.apply(currentSession, namespaces)
    }
  }

  this.context = function (options) {
    return new RinqContext(
      sessionManager,
      options && options.initialize,
      setTimeout,
      clearTimeout,
      logger,
      options && options.log
    )
  }

  function onConnection (newConnection) {
    if (log && log.debug) {
      logger(
        [
          '%c%s %sConnected.',
          'color: green',
          debugSymbol,
          log.prefix
        ],
        [[{connection: newConnection}]]
      )
    }

    newConnection.once('close', onClose)
    initialize(newConnection)
  }

  function onError (error) {
    if (log && log.debug) {
      logger(
        [
          '%c%s %sConnection manager error.',
          'color: red',
          debugSymbol,
          log.prefix
        ],
        [[{error: error}]]
      )
    }

    emit('error', error)
  }

  function onClose (error) {
    if (log && log.debug) {
      logger(
        [
          '%c%s %sConnection closed.',
          'color: orange',
          debugSymbol,
          log.prefix
        ],
        [[{error: error}]]
      )
    }

    connection = null

    if (!error) error = new Error('Connection closed unexpectedly.')
    emit('error', error)
  }

  function onNotification (namespace, type, payload) {
    emit('notification', namespace, type, payload)
  }

  function onResponse (error, response, namespace, command) {
    emit('response', error, response, namespace, command)
  }

  function onDestroy (error) {
    if (log && log.debug) {
      logger(
        [
          '%c%s %sSession destroyed.',
          'color: orange',
          debugSymbol,
          log.prefix
        ]
      )
    }

    sessionManager.session.removeListener('notification', onNotification)
    sessionManager.session.removeListener('response', onResponse)
    sessionManager.session = null
    emit('error', error)
  }

  function initialize (newConnection) {
    var options

    if (log) {
      if (log.debug) {
        logger(
          [
            '%c%s %sCreating session.',
            'color: green',
            debugSymbol,
            log.prefix
          ]
        )
      }

      options = {log: log}
    } else {
      options = {}
    }

    sessionManager.session = newConnection.session(options)
    sessionManager.session.on('notification', onNotification)
    sessionManager.listen.apply(sessionManager, notificationNamespaces)
    sessionManager.session.on('response', onResponse)
    sessionManager.session.once('destroy', onDestroy)

    emit('session', sessionManager.session)
  }
}

RinqSessionManager.prototype = Object.create(EventEmitter.prototype)
RinqSessionManager.prototype.constructor = RinqSessionManager

module.exports = RinqSessionManager
