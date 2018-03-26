const WebSocketServer = require('ws').Server,
Server = new WebSocketServer({port: 3000})

Server.on('connection', function (ws) {
  ws.on('message', function (message) {
    console.log('received: %s', message)
  })
})