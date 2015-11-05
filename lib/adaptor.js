'use strict';

var Cylon = require('cylon'),
    Lang = require('iot-native-lang'),
    _ = require('lodash'),
    os = require('os'),
    uuid = require('node-uuid'),
    validator = require('is-my-json-valid'),
    mqtt = require('mqtt');

var messageSchema = {
  required: ['id', 'sender', 'replyTo', 'threadId'],
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    threadId:  { type: 'string', minLength: 1 },
    payload: {
      oneOf: [
        { type: 'string', minLength: 1},
        { 'type': "object" }
      ]
    },
    replyTo: { type: 'string', minLength: 1 },
    sender: {
      required: ['name', 'host'],
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        host: { type: 'string', minLength: 1 }
      }
    }
  }
};

var Adaptor = module.exports = function Adaptor(_cfg) {
  Adaptor.__super__.constructor.apply(this, arguments);

  var cfg = this.cfg = _.defaults(_cfg || {}, {
    host: 'mqtt://localhost',
    minTokenLength: 4,
    lang: 'en',
    tree: undefined,
    listen: undefined,
    listenDepth: 2,
    pruneInterval: 10000
  });

  this.credentials = {
    name: this.robot.name,
    host: os.hostname()
  };

  this.lang = new Lang({
    lang: cfg.lang,
    listen: cfg.tree,
    minTokenLength: cfg.minTokenLength
  });

  this.prevMessages = {};
  this.validate = validator(messageSchema);

};

Cylon.Utils.subclass(Adaptor, Cylon.Adaptor);

Adaptor.prototype.connect = function (callback) {

  var client = this.client = mqtt.connect(this.cfg.host);

  var listen = this.getListenChannels();
  client.subscribe(listen);
  client.on('message', this.emitIncomigMessage.bind(this));
  setInterval(this.pruneReceived.bind(this), this.cfg.pruneInterval);

  this.robot.log('Listen on channels: ' + listen);
  callback();
};

Adaptor.prototype.disconnect = function (callback) {
  this.client.end(callback);
};

// return array of channels to listen (directly specified in cfg.listen or from syntax tree)
Adaptor.prototype.getListenChannels = function () {

  var cfg = this.cfg, extractTokens = this.lang.extractTokens.bind(this.lang);
  if(cfg.listen instanceof Array) {
    return cfg.listen;
  }
  if(typeof cfg.listen === 'string') {
    return extractTokens(cfg.listen, cfg.minTokenLength);
  }
  if(cfg.tree) {
    var str = '', getKeys = function (tree, currentDepth) {
      if(currentDepth >= cfg.listenDepth) { return; }
      for(var key in tree) {
        str += ' ' + key;
        getKeys(tree[key], currentDepth + 1);
      }
    };
    getKeys(cfg.tree, 0);
    return extractTokens(str, cfg.minTokenLength);
  }
  return [];
};

Adaptor.prototype.emitIncomigMessage = function (topic, message) {
  try {
    message = this.parseIncomingMessage(message);
  } catch (err) {
    console.error(err);
    return; //message is not from other cylon - just ignore it
  }
  if(!this.alreadyReceived(message)) {
    this.emit('message', message.payload, message, topic);
  }

};

Adaptor.prototype.parseIncomingMessage = function (message) {
  try {
    message = JSON.parse(message);
  } catch (err) {
    throw new Error('unable to parse incoming message: ' + message.toString());
  }
  if(!this.validate(message)) {
    throw new Error(this.validate.errors);
  }
  return message;
};

Adaptor.prototype.prepareOutgoingMessage = function (msg) {
  var message = {
    id: uuid.v4(),
    threadId: uuid.v4(),
    sender: this.credentials,
    replyTo: this.name,
    payload: msg
  };
  if(!this.validate(message)) {
    throw new Error(this.validate.errors);
  }
  return new Buffer(JSON.stringify(message));
};

Adaptor.prototype.pruneReceived = function () {
  var messages = this.prevMessages,
      till = Date.now() - this.cfg.pruneInterval;
  for(var id in messages) {
    if(till > messages[id]) {
      delete messages[id];
    }
  }
};

Adaptor.prototype.alreadyReceived = function (msg) {
  if(this.prevMessages[msg.id]) { return true; }
  this.prevMessages[msg.id] = Date.now();
  return false;
};

Adaptor.prototype.send = function (channels, message) {
  message = this.prepareOutgoingMessage(message);
  var isArray = channels instanceof Array;
  if(!isArray) { channels = [ channels ]; }

  channels.forEach(function (channel) {
    this.client.publish(channel, message);
  }.bind(this));
  return message;
};

Adaptor.prototype.reply = function (source, response) {
  // FIXME: implement ttl or something against loops
  if(!source.replyTo || !source.threadId) {
    return false;
  }
  response = this.prepareOutgoingMessage(response);
  response.threadId = source.threadId;
  this.client.publish(source.replyTo, response);
  return response;
};
