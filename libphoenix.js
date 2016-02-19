"use strict";

var _createClass = (function () { function defineProperties(target, props) { for (var key in props) { var prop = props[key]; prop.configurable = true; if (prop.value) prop.writable = true; } Object.defineProperties(target, props); } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _classCallCheck = function (instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } };

Object.defineProperty(exports, "__esModule", {
  value: true
});
// Phoenix Channels JavaScript client
//
// ## Socket Connection
//
// A single connection is established to the server and
// channels are mulitplexed over the connection.
// Connect to the server using the `Socket` class:
//
//     let socket = new Socket("/ws", {params: {userToken: "123"}})
//     socket.connect()
//
// The `Socket` constructor takes the mount point of the socket,
// the authentication params, as well as options that can be found in
// the Socket docs, such as configuring the `LongPoll` transport, and
// heartbeat.
//
// ## Channels
//
// Channels are isolated, concurrent processes on the server that
// subscribe to topics and broker events between the client and server.
// To join a channel, you must provide the topic, and channel params for
// authorization. Here's an example chat room example where `"new_msg"`
// events are listened for, messages are pushed to the server, and
// the channel is joined with ok/error/timeout matches:
//
//     let channel = socket.channel("rooms:123", {token: roomToken})
//     channel.on("new_msg", msg => console.log("Got message", msg) )
//     $input.onEnter( e => {
//       channel.push("new_msg", {body: e.target.val}, 10000)
//        .receive("ok", (msg) => console.log("created message", msg) )
//        .receive("error", (reasons) => console.log("create failed", reasons) )
//        .receive("timeout", () => console.log("Networking issue...") )
//     })
//     channel.join()
//       .receive("ok", ({messages}) => console.log("catching up", messages) )
//       .receive("error", ({reason}) => console.log("failed join", reason) )
//       .receive("timeout", () => console.log("Networking issue. Still waiting...") )
//
//
// ## Joining
//
// Joining a channel with `channel.join(topic, params)`, binds the params to
// `channel.params`. Subsequent rejoins will send up the modified params for
// updating authorization params, or passing up last_message_id information.
// Successful joins receive an "ok" status, while unsuccessful joins
// receive "error".
//
//
// ## Pushing Messages
//
// From the previous example, we can see that pushing messages to the server
// can be done with `channel.push(eventName, payload)` and we can optionally
// receive responses from the push. Additionally, we can use
// `receive("timeout", callback)` to abort waiting for our other `receive` hooks
//  and take action after some period of waiting.
//
//
// ## Socket Hooks
//
// Lifecycle events of the multiplexed connection can be hooked into via
// `socket.onError()` and `socket.onClose()` events, ie:
//
//     socket.onError( () => console.log("there was an error with the connection!") )
//     socket.onClose( () => console.log("the connection dropped") )
//
//
// ## Channel Hooks
//
// For each joined channel, you can bind to `onError` and `onClose` events
// to monitor the channel lifecycle, ie:
//
//     channel.onError( () => console.log("there was an error!") )
//     channel.onClose( () => console.log("the channel has gone away gracefully") )
//
// ### onError hooks
//
// `onError` hooks are invoked if the socket connection drops, or the channel
// crashes on the server. In either case, a channel rejoin is attemtped
// automatically in an exponential backoff manner.
//
// ### onClose hooks
//
// `onClose` hooks are invoked only in two cases. 1) the channel explicitly
// closed on the server, or 2). The client explicitly closed, by calling
// `channel.leave()`
//

var VSN = "1.0.0";
var SOCKET_STATES = { connecting: 0, open: 1, closing: 2, closed: 3 };
var DEFAULT_TIMEOUT = 10000;
var CHANNEL_STATES = {
  closed: "closed",
  errored: "errored",
  joined: "joined",
  joining: "joining" };
var CHANNEL_EVENTS = {
  close: "phx_close",
  error: "phx_error",
  join: "phx_join",
  reply: "phx_reply",
  leave: "phx_leave"
};
var TRANSPORTS = {
  longpoll: "longpoll",
  websocket: "websocket"
};

var Push = (function () {

  // Initializes the Push
  //
  // channel - The Channel
  // event - The event, for example `"phx_join"`
  // payload - The payload, for example `{user_id: 123}`
  // timeout - The push timeout in milliseconds
  //

  function Push(channel, event, payload, timeout) {
    _classCallCheck(this, Push);

    this.channel = channel;
    this.event = event;
    this.payload = payload || {};
    this.receivedResp = null;
    this.timeout = timeout;
    this.timeoutTimer = null;
    this.recHooks = [];
    this.sent = false;
  }

  _createClass(Push, {
    resend: {
      value: function resend(timeout) {
        this.timeout = timeout;
        this.cancelRefEvent();
        this.ref = null;
        this.refEvent = null;
        this.receivedResp = null;
        this.sent = false;
        this.send();
      }
    },
    send: {
      value: function send() {
        if (this.hasReceived("timeout")) {
          return;
        }
        this.startTimeout();
        this.sent = true;
        this.channel.socket.push({
          topic: this.channel.topic,
          event: this.event,
          payload: this.payload,
          ref: this.ref
        });
      }
    },
    receive: {
      value: function receive(status, callback) {
        if (this.hasReceived(status)) {
          callback(this.receivedResp.response);
        }

        this.recHooks.push({ status: status, callback: callback });
        return this;
      }
    },
    matchReceive: {

      // private

      value: function matchReceive(_ref) {
        var status = _ref.status;
        var response = _ref.response;
        var ref = _ref.ref;

        this.recHooks.filter(function (h) {
          return h.status === status;
        }).forEach(function (h) {
          return h.callback(response);
        });
      }
    },
    cancelRefEvent: {
      value: function cancelRefEvent() {
        if (!this.refEvent) {
          return;
        }
        this.channel.off(this.refEvent);
      }
    },
    cancelTimeout: {
      value: function cancelTimeout() {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = null;
      }
    },
    startTimeout: {
      value: function startTimeout() {
        var _this = this;

        if (this.timeoutTimer) {
          return;
        }
        this.ref = this.channel.socket.makeRef();
        this.refEvent = this.channel.replyEventName(this.ref);

        this.channel.on(this.refEvent, function (payload) {
          _this.cancelRefEvent();
          _this.cancelTimeout();
          _this.receivedResp = payload;
          _this.matchReceive(payload);
        });

        this.timeoutTimer = setTimeout(function () {
          _this.trigger("timeout", {});
        }, this.timeout);
      }
    },
    hasReceived: {
      value: function hasReceived(status) {
        return this.receivedResp && this.receivedResp.status === status;
      }
    },
    trigger: {
      value: function trigger(status, response) {
        this.channel.trigger(this.refEvent, { status: status, response: response });
      }
    }
  });

  return Push;
})();

var Channel = exports.Channel = (function () {
  function Channel(topic, params, socket) {
    var _this = this;

    _classCallCheck(this, Channel);

    this.state = CHANNEL_STATES.closed;
    this.topic = topic;
    this.params = params || {};
    this.socket = socket;
    this.bindings = [];
    this.timeout = this.socket.timeout;
    this.joinedOnce = false;
    this.joinPush = new Push(this, CHANNEL_EVENTS.join, this.params, this.timeout);
    this.pushBuffer = [];
    this.rejoinTimer = new Timer(function () {
      return _this.rejoinUntilConnected();
    }, this.socket.reconnectAfterMs);
    this.joinPush.receive("ok", function () {
      _this.state = CHANNEL_STATES.joined;
      _this.rejoinTimer.reset();
      _this.pushBuffer.forEach(function (pushEvent) {
        return pushEvent.send();
      });
      _this.pushBuffer = [];
    });
    this.onClose(function () {
      _this.socket.log("channel", "close " + _this.topic);
      _this.state = CHANNEL_STATES.closed;
      _this.socket.remove(_this);
    });
    this.onError(function (reason) {
      _this.socket.log("channel", "error " + _this.topic, reason);
      _this.state = CHANNEL_STATES.errored;
      _this.rejoinTimer.setTimeout();
    });
    this.joinPush.receive("timeout", function () {
      if (_this.state !== CHANNEL_STATES.joining) {
        return;
      }

      _this.socket.log("channel", "timeout " + _this.topic, _this.joinPush.timeout);
      _this.state = CHANNEL_STATES.errored;
      _this.rejoinTimer.setTimeout();
    });
    this.on(CHANNEL_EVENTS.reply, function (payload, ref) {
      _this.trigger(_this.replyEventName(ref), payload);
    });
  }

  _createClass(Channel, {
    rejoinUntilConnected: {
      value: function rejoinUntilConnected() {
        this.rejoinTimer.setTimeout();
        if (this.socket.isConnected()) {
          this.rejoin();
        }
      }
    },
    join: {
      value: function join() {
        var timeout = arguments[0] === undefined ? this.timeout : arguments[0];

        if (this.joinedOnce) {
          throw "tried to join multiple times. 'join' can only be called a single time per channel instance";
        } else {
          this.joinedOnce = true;
        }
        this.rejoin(timeout);
        return this.joinPush;
      }
    },
    onClose: {
      value: function onClose(callback) {
        this.on(CHANNEL_EVENTS.close, callback);
      }
    },
    onError: {
      value: function onError(callback) {
        this.on(CHANNEL_EVENTS.error, function (reason) {
          return callback(reason);
        });
      }
    },
    on: {
      value: function on(event, callback) {
        this.bindings.push({ event: event, callback: callback });
      }
    },
    off: {
      value: function off(event) {
        this.bindings = this.bindings.filter(function (bind) {
          return bind.event !== event;
        });
      }
    },
    canPush: {
      value: function canPush() {
        return this.socket.isConnected() && this.state === CHANNEL_STATES.joined;
      }
    },
    push: {
      value: function push(event, payload) {
        var timeout = arguments[2] === undefined ? this.timeout : arguments[2];

        if (!this.joinedOnce) {
          throw "tried to push '" + event + "' to '" + this.topic + "' before joining. Use channel.join() before pushing events";
        }
        var pushEvent = new Push(this, event, payload, timeout);
        if (this.canPush()) {
          pushEvent.send();
        } else {
          pushEvent.startTimeout();
          this.pushBuffer.push(pushEvent);
        }

        return pushEvent;
      }
    },
    leave: {

      // Leaves the channel
      //
      // Unsubscribes from server events, and
      // instructs channel to terminate on server
      //
      // Triggers onClose() hooks
      //
      // To receive leave acknowledgements, use the a `receive`
      // hook to bind to the server ack, ie:
      //
      //     channel.leave().receive("ok", () => alert("left!") )
      //

      value: function leave() {
        var _this = this;

        var timeout = arguments[0] === undefined ? this.timeout : arguments[0];

        var onClose = function () {
          _this.socket.log("channel", "leave " + _this.topic);
          _this.trigger(CHANNEL_EVENTS.close, "leave");
        };
        var leavePush = new Push(this, CHANNEL_EVENTS.leave, {}, timeout);
        leavePush.receive("ok", function () {
          return onClose();
        }).receive("timeout", function () {
          return onClose();
        });
        leavePush.send();
        if (!this.canPush()) {
          leavePush.trigger("ok", {});
        }

        return leavePush;
      }
    },
    onMessage: {

      // Overridable message hook
      //
      // Receives all events for specialized message handling

      value: function onMessage(event, payload, ref) {}
    },
    isMember: {

      // private

      value: function isMember(topic) {
        return this.topic === topic;
      }
    },
    sendJoin: {
      value: function sendJoin(timeout) {
        this.state = CHANNEL_STATES.joining;
        this.joinPush.resend(timeout);
      }
    },
    rejoin: {
      value: function rejoin() {
        var timeout = arguments[0] === undefined ? this.timeout : arguments[0];
        this.sendJoin(timeout);
      }
    },
    trigger: {
      value: function trigger(triggerEvent, payload, ref) {
        this.onMessage(triggerEvent, payload, ref);
        this.bindings.filter(function (bind) {
          return bind.event === triggerEvent;
        }).map(function (bind) {
          return bind.callback(payload, ref);
        });
      }
    },
    replyEventName: {
      value: function replyEventName(ref) {
        return "chan_reply_" + ref;
      }
    }
  });

  return Channel;
})();

var Socket = exports.Socket = (function () {

  // Initializes the Socket
  //
  // endPoint - The string WebSocket endpoint, ie, "ws://example.com/ws",
  //                                               "wss://example.com"
  //                                               "/ws" (inherited host & protocol)
  // opts - Optional configuration
  //   transport - The Websocket Transport, for example WebSocket or Phoenix.LongPoll.
  //               Defaults to WebSocket with automatic LongPoll fallback.
  //   timeout - The default timeout in milliseconds to trigger push timeouts.
  //             Defaults `DEFAULT_TIMEOUT`
  //   heartbeatIntervalMs - The millisec interval to send a heartbeat message
  //   reconnectAfterMs - The optional function that returns the millsec
  //                      reconnect interval. Defaults to stepped backoff of:
  //
  //     function(tries){
  //       return [1000, 5000, 10000][tries - 1] || 10000
  //     }
  //
  //   logger - The optional function for specialized logging, ie:
  //     `logger: (kind, msg, data) => { console.log(`${kind}: ${msg}`, data) }
  //
  //   longpollerTimeout - The maximum timeout of a long poll AJAX request.
  //                        Defaults to 20s (double the server long poll timer).
  //
  //   params - The optional params to pass when connecting
  //
  // For IE8 support use an ES5-shim (https://github.com/es-shims/es5-shim)
  //

  function Socket(endPoint) {
    var _this = this;

    var opts = arguments[1] === undefined ? {} : arguments[1];

    _classCallCheck(this, Socket);

    this.stateChangeCallbacks = { open: [], close: [], error: [], message: [] };
    this.channels = [];
    this.sendBuffer = [];
    this.ref = 0;
    this.timeout = opts.timeout || DEFAULT_TIMEOUT;
    this.transport = opts.transport || window.WebSocket || LongPoll;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs || 30000;
    this.reconnectAfterMs = opts.reconnectAfterMs || function (tries) {
      return [1000, 2000, 5000, 10000][tries - 1] || 10000;
    };
    this.logger = opts.logger || function () {}; // noop
    this.longpollerTimeout = opts.longpollerTimeout || 20000;
    this.params = opts.params || {};
    this.endPoint = "" + endPoint + "/" + TRANSPORTS.websocket;
    this.reconnectTimer = new Timer(function () {
      _this.disconnect(function () {
        return _this.connect();
      });
    }, this.reconnectAfterMs);
  }

  _createClass(Socket, {
    protocol: {
      value: function protocol() {
        return location.protocol.match(/^https/) ? "wss" : "ws";
      }
    },
    endPointURL: {
      value: function endPointURL() {
        var uri = Ajax.appendParams(Ajax.appendParams(this.endPoint, this.params), { vsn: VSN });
        if (uri.charAt(0) !== "/") {
          return uri;
        }
        if (uri.charAt(1) === "/") {
          return "" + this.protocol() + ":" + uri;
        }

        return "" + this.protocol() + "://" + location.host + "" + uri;
      }
    },
    disconnect: {
      value: function disconnect(callback, code, reason) {
        if (this.conn) {
          this.conn.onclose = function () {}; // noop
          if (code) {
            this.conn.close(code, reason || "");
          } else {
            this.conn.close();
          }
          this.conn = null;
        }
        callback && callback();
      }
    },
    connect: {

      // params - The params to send when connecting, for example `{user_id: userToken}`

      value: function connect(params) {
        var _this = this;

        if (params) {
          console && console.log("passing params to connect is deprecated. Instead pass :params to the Socket constructor");
          this.params = params;
        }
        if (this.conn) {
          return;
        }

        this.conn = new this.transport(this.endPointURL());
        this.conn.timeout = this.longpollerTimeout;
        this.conn.onopen = function () {
          return _this.onConnOpen();
        };
        this.conn.onerror = function (error) {
          return _this.onConnError(error);
        };
        this.conn.onmessage = function (event) {
          return _this.onConnMessage(event);
        };
        this.conn.onclose = function (event) {
          return _this.onConnClose(event);
        };
      }
    },
    log: {

      // Logs the message. Override `this.logger` for specialized logging. noops by default

      value: function log(kind, msg, data) {
        this.logger(kind, msg, data);
      }
    },
    onOpen: {

      // Registers callbacks for connection state change events
      //
      // Examples
      //
      //    socket.onError(function(error){ alert("An error occurred") })
      //

      value: function onOpen(callback) {
        this.stateChangeCallbacks.open.push(callback);
      }
    },
    onClose: {
      value: function onClose(callback) {
        this.stateChangeCallbacks.close.push(callback);
      }
    },
    onError: {
      value: function onError(callback) {
        this.stateChangeCallbacks.error.push(callback);
      }
    },
    onMessage: {
      value: function onMessage(callback) {
        this.stateChangeCallbacks.message.push(callback);
      }
    },
    onConnOpen: {
      value: function onConnOpen() {
        var _this = this;

        this.log("transport", "connected to " + this.endPointURL(), this.transport.prototype);
        this.flushSendBuffer();
        this.reconnectTimer.reset();
        if (!this.conn.skipHeartbeat) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = setInterval(function () {
            return _this.sendHeartbeat();
          }, this.heartbeatIntervalMs);
        }
        this.stateChangeCallbacks.open.forEach(function (callback) {
          return callback();
        });
      }
    },
    onConnClose: {
      value: function onConnClose(event) {
        this.log("transport", "close", event);
        this.triggerChanError();
        clearInterval(this.heartbeatTimer);
        this.reconnectTimer.setTimeout();
        this.stateChangeCallbacks.close.forEach(function (callback) {
          return callback(event);
        });
      }
    },
    onConnError: {
      value: function onConnError(error) {
        this.log("transport", error);
        this.triggerChanError();
        this.stateChangeCallbacks.error.forEach(function (callback) {
          return callback(error);
        });
      }
    },
    triggerChanError: {
      value: function triggerChanError() {
        this.channels.forEach(function (channel) {
          return channel.trigger(CHANNEL_EVENTS.error);
        });
      }
    },
    connectionState: {
      value: function connectionState() {
        switch (this.conn && this.conn.readyState) {
          case SOCKET_STATES.connecting:
            return "connecting";
          case SOCKET_STATES.open:
            return "open";
          case SOCKET_STATES.closing:
            return "closing";
          default:
            return "closed";
        }
      }
    },
    isConnected: {
      value: function isConnected() {
        return this.connectionState() === "open";
      }
    },
    remove: {
      value: function remove(channel) {
        this.channels = this.channels.filter(function (c) {
          return !c.isMember(channel.topic);
        });
      }
    },
    channel: {
      value: function channel(topic) {
        var chanParams = arguments[1] === undefined ? {} : arguments[1];

        var chan = new Channel(topic, chanParams, this);
        this.channels.push(chan);
        return chan;
      }
    },
    push: {
      value: function push(data) {
        var _this = this;

        var topic = data.topic;
        var event = data.event;
        var payload = data.payload;
        var ref = data.ref;

        var callback = function () {
          return _this.conn.send(JSON.stringify(data));
        };
        this.log("push", "" + topic + " " + event + " (" + ref + ")", payload);
        if (this.isConnected()) {
          callback();
        } else {
          this.sendBuffer.push(callback);
        }
      }
    },
    makeRef: {

      // Return the next message ref, accounting for overflows

      value: function makeRef() {
        var newRef = this.ref + 1;
        if (newRef === this.ref) {
          this.ref = 0;
        } else {
          this.ref = newRef;
        }

        return this.ref.toString();
      }
    },
    sendHeartbeat: {
      value: function sendHeartbeat() {
        if (!this.isConnected()) {
          return;
        }
        this.push({ topic: "phoenix", event: "heartbeat", payload: {}, ref: this.makeRef() });
      }
    },
    flushSendBuffer: {
      value: function flushSendBuffer() {
        if (this.isConnected() && this.sendBuffer.length > 0) {
          this.sendBuffer.forEach(function (callback) {
            return callback();
          });
          this.sendBuffer = [];
        }
      }
    },
    onConnMessage: {
      value: function onConnMessage(rawMessage) {
        var msg = JSON.parse(rawMessage.data);
        var topic = msg.topic;
        var event = msg.event;
        var payload = msg.payload;
        var ref = msg.ref;

        this.log("receive", "" + (payload.status || "") + " " + topic + " " + event + " " + (ref && "(" + ref + ")" || ""), payload);
        this.channels.filter(function (channel) {
          return channel.isMember(topic);
        }).forEach(function (channel) {
          return channel.trigger(event, payload, ref);
        });
        this.stateChangeCallbacks.message.forEach(function (callback) {
          return callback(msg);
        });
      }
    }
  });

  return Socket;
})();

var LongPoll = exports.LongPoll = (function () {
  function LongPoll(endPoint) {
    _classCallCheck(this, LongPoll);

    this.endPoint = null;
    this.token = null;
    this.skipHeartbeat = true;
    this.onopen = function () {}; // noop
    this.onerror = function () {}; // noop
    this.onmessage = function () {}; // noop
    this.onclose = function () {}; // noop
    this.pollEndpoint = this.normalizeEndpoint(endPoint);
    this.readyState = SOCKET_STATES.connecting;

    this.poll();
  }

  _createClass(LongPoll, {
    normalizeEndpoint: {
      value: function normalizeEndpoint(endPoint) {
        return endPoint.replace("ws://", "http://").replace("wss://", "https://").replace(new RegExp("(.*)/" + TRANSPORTS.websocket), "$1/" + TRANSPORTS.longpoll);
      }
    },
    endpointURL: {
      value: function endpointURL() {
        return Ajax.appendParams(this.pollEndpoint, { token: this.token });
      }
    },
    closeAndRetry: {
      value: function closeAndRetry() {
        this.close();
        this.readyState = SOCKET_STATES.connecting;
      }
    },
    ontimeout: {
      value: function ontimeout() {
        this.onerror("timeout");
        this.closeAndRetry();
      }
    },
    poll: {
      value: function poll() {
        var _this = this;

        if (!(this.readyState === SOCKET_STATES.open || this.readyState === SOCKET_STATES.connecting)) {
          return;
        }

        Ajax.request("GET", this.endpointURL(), "application/json", null, this.timeout, this.ontimeout.bind(this), function (resp) {
          if (resp) {
            var status = resp.status;
            var token = resp.token;
            var messages = resp.messages;

            _this.token = token;
          } else {
            var status = 0;
          }

          switch (status) {
            case 200:
              messages.forEach(function (msg) {
                return _this.onmessage({ data: JSON.stringify(msg) });
              });
              _this.poll();
              break;
            case 204:
              _this.poll();
              break;
            case 410:
              _this.readyState = SOCKET_STATES.open;
              _this.onopen();
              _this.poll();
              break;
            case 0:
            case 500:
              _this.onerror();
              _this.closeAndRetry();
              break;
            default:
              throw "unhandled poll status " + status;
          }
        });
      }
    },
    send: {
      value: function send(body) {
        var _this = this;

        Ajax.request("POST", this.endpointURL(), "application/json", body, this.timeout, this.onerror.bind(this, "timeout"), function (resp) {
          if (!resp || resp.status !== 200) {
            _this.onerror(status);
            _this.closeAndRetry();
          }
        });
      }
    },
    close: {
      value: function close(code, reason) {
        this.readyState = SOCKET_STATES.closed;
        this.onclose();
      }
    }
  });

  return LongPoll;
})();

var Ajax = exports.Ajax = (function () {
  function Ajax() {
    _classCallCheck(this, Ajax);
  }

  _createClass(Ajax, null, {
    request: {
      value: function request(method, endPoint, accept, body, timeout, ontimeout, callback) {
        if (window.XDomainRequest) {
          var req = new XDomainRequest(); // IE8, IE9
          this.xdomainRequest(req, method, endPoint, body, timeout, ontimeout, callback);
        } else {
          var req = window.XMLHttpRequest ? new XMLHttpRequest() : // IE7+, Firefox, Chrome, Opera, Safari
          new ActiveXObject("Microsoft.XMLHTTP"); // IE6, IE5
          this.xhrRequest(req, method, endPoint, accept, body, timeout, ontimeout, callback);
        }
      }
    },
    xdomainRequest: {
      value: function xdomainRequest(req, method, endPoint, body, timeout, ontimeout, callback) {
        var _this = this;

        req.timeout = timeout;
        req.open(method, endPoint);
        req.onload = function () {
          var response = _this.parseJSON(req.responseText);
          callback && callback(response);
        };
        if (ontimeout) {
          req.ontimeout = ontimeout;
        }

        // Work around bug in IE9 that requires an attached onprogress handler
        req.onprogress = function () {};

        req.send(body);
      }
    },
    xhrRequest: {
      value: function xhrRequest(req, method, endPoint, accept, body, timeout, ontimeout, callback) {
        var _this = this;

        req.timeout = timeout;
        req.open(method, endPoint, true);
        req.setRequestHeader("Content-Type", accept);
        req.onerror = function () {
          callback && callback(null);
        };
        req.onreadystatechange = function () {
          if (req.readyState === _this.states.complete && callback) {
            var response = _this.parseJSON(req.responseText);
            callback(response);
          }
        };
        if (ontimeout) {
          req.ontimeout = ontimeout;
        }

        req.send(body);
      }
    },
    parseJSON: {
      value: function parseJSON(resp) {
        return resp && resp !== "" ? JSON.parse(resp) : null;
      }
    },
    serialize: {
      value: function serialize(obj, parentKey) {
        var queryStr = [];
        for (var key in obj) {
          if (!obj.hasOwnProperty(key)) {
            continue;
          }
          var paramKey = parentKey ? "" + parentKey + "[" + key + "]" : key;
          var paramVal = obj[key];
          if (typeof paramVal === "object") {
            queryStr.push(this.serialize(paramVal, paramKey));
          } else {
            queryStr.push(encodeURIComponent(paramKey) + "=" + encodeURIComponent(paramVal));
          }
        }
        return queryStr.join("&");
      }
    },
    appendParams: {
      value: function appendParams(url, params) {
        if (Object.keys(params).length === 0) {
          return url;
        }

        var prefix = url.match(/\?/) ? "&" : "?";
        return "" + url + "" + prefix + "" + this.serialize(params);
      }
    }
  });

  return Ajax;
})();

Ajax.states = { complete: 4 };

// Creates a timer that accepts a `timerCalc` function to perform
// calculated timeout retries, such as exponential backoff.
//
// ## Examples
//
//    let reconnectTimer = new Timer(() => this.connect(), function(tries){
//      return [1000, 5000, 10000][tries - 1] || 10000
//    })
//    reconnectTimer.setTimeout() // fires after 1000
//    reconnectTimer.setTimeout() // fires after 5000
//    reconnectTimer.reset()
//    reconnectTimer.setTimeout() // fires after 1000
//

var Timer = (function () {
  function Timer(callback, timerCalc) {
    _classCallCheck(this, Timer);

    this.callback = callback;
    this.timerCalc = timerCalc;
    this.timer = null;
    this.tries = 0;
  }

  _createClass(Timer, {
    reset: {
      value: function reset() {
        this.tries = 0;
        clearTimeout(this.timer);
      }
    },
    setTimeout: {

      // Cancels any previous setTimeout and schedules callback

      value: (function (_setTimeout) {
        var _setTimeoutWrapper = function setTimeout() {
          return _setTimeout.apply(this, arguments);
        };

        _setTimeoutWrapper.toString = function () {
          return _setTimeout.toString();
        };

        return _setTimeoutWrapper;
      })(function () {
        var _this = this;

        clearTimeout(this.timer);

        this.timer = setTimeout(function () {
          _this.tries = _this.tries + 1;
          _this.callback();
        }, this.timerCalc(this.tries + 1));
      })
    }
  });

  return Timer;
})();
