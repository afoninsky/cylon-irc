'use strict';

var Cylon = require('cylon'),
    _ = require('lodash'),
    os = require('os'),
    uuid = require('node-uuid'),
    Lang = require('iot-native-lang'),
    hash = require('string-hash'),
    validator = require('is-my-json-valid');

var defaultConfig = {
  lang: 'en',
  tree: {},
  listen: undefined,
  private: undefined,
  treeListenDepth: 0,
  minTokenLength: 4,
  pruneInterval: 10000
};

var messageSchema = {
  required: ['id', 'sender', 'payload', 'threadId'],
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
    sender: {
      required: ['name', 'host'],
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        host: { type: 'string', minLength: 1 },
        topic: { type: 'string', minLength: 1 }
      }
    }
  }
};

var Driver = module.exports = function Driver(_cfg) {

  Driver.__super__.constructor.apply(this, arguments);
  var cfg = this.cfg = _.defaults(_.pick(_cfg, _.keys(defaultConfig)), defaultConfig);

  this.lang = new Lang({
    lang: cfg.lang,
    listen: cfg.tree,
    minTokenLength: cfg.minTokenLength
  });

  this.credentials = {
    name: this.robot.name,
    host: os.hostname()
  };

  if(cfg.private) {
    this.privateTopic = this.credentials.topic = (cfg.private === true ? this.robot.name : cfg.private);
  }

  this.receivedMessages = {};
  this.validate = validator(messageSchema);
};

Cylon.Utils.subclass(Driver, Cylon.Driver);

Driver.prototype.start = function(callback) {
  var listen = this.getListenChannels(),
    transport = this.connection;

  transport.on('message', this.emitIncomingMessage.bind(this));
  this.pruneHandler = setInterval(this.pruneReceived.bind(this), this.cfg.pruneInterval);

  transport.subscribe(listen);
  this.robot.log('Listening channels: ' + listen);
  if(this.privateTopic) {
    transport.subscribe(this.privateTopic);
    this.robot.log('Listening private: ' + this.privateTopic);
  }

  callback();
};

Driver.prototype.halt = function(callback) {
  clearInterval(this.pruneHandler);
  this.connection.client.end(callback);
};

// return array of channels to listen (directly specified in cfg.listen or from syntax tree)
Driver.prototype.getListenChannels = function () {

  var cfg = this.cfg, listen = [], listenFromTree = [],
    extractTokens = this.lang.extractTokens.bind(this.lang);

  if(cfg.listen instanceof Array) {
    listen = cfg.listen;
  } else if(typeof cfg.listen === 'string') {
    listen = extractTokens(cfg.listen, cfg.minTokenLength);
  }
  if(cfg.treeListenDepth && cfg.tree) {
    var str = '',
      getKeys = function (tree, currentDepth) {
        if(currentDepth >= cfg.treeListenDepth) { return; }
        for(var key in tree) {
          str += ' ' + key;
          getKeys(tree[key], currentDepth + 1);
        }
      };
    getKeys(cfg.tree, 0);
    listenFromTree = extractTokens(str, cfg.minTokenLength);
  }
  return _.union(listen, listenFromTree);
};


Driver.prototype.pruneReceived = function () {
  var messages = this.receivedMessages,
      till = Date.now() - this.cfg.pruneInterval;
  for(var id in messages) {
    if(till > messages[id]) {
      delete messages[id];
    }
  }
};

Driver.prototype.emitIncomingMessage = function (topic, message) {

  var parsedMessage;
  try {
    parsedMessage = this.parseIncomingMessage(message);
  } catch (err) {
    // message is not from other cylon - emit 'noise' event
    var messageId = hash(message.toString());
    if(!this.receivedMessages[messageId]) {
      this.receivedMessages[messageId] = Date.now();
      this.emit('noise', message.toString(), topic);
    }
    return;
  }
  var payload = parsedMessage.payload;
  if(topic === this.privateTopic) {
    return this.emit('private', payload, parsedMessage, topic);
  }
  if(this.receivedMessages[parsedMessage.id]) { return; } // this message already received on other topic
  this.receivedMessages[parsedMessage.id] = Date.now();

  if(this.cfg.tree && typeof payload === 'string') {
    var command = this.lang.hear(payload);
    if(command.found) {
      this.emit('command', command, parsedMessage, topic);
    } else {
      this.emit('ignored', command, parsedMessage, topic);
    }
    return;
  }
  this.emit('message', message.payload, parsedMessage, topic);
};

Driver.prototype.parseIncomingMessage = function (message) {
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

Driver.prototype.prepareOutgoingMessage = function (msg) {
  var message = {
    id: uuid.v4(),
    threadId: uuid.v4(),
    sender: this.credentials,
    payload: msg
  };
  if(!this.validate(message)) {
    throw new Error(this.validate.errors);
  }
  return new Buffer(JSON.stringify(message));
};

Driver.prototype.sendRaw = function (channels, message) {

  channels = channels instanceof Array ? channels : [ channels ];
  channels.forEach(function (channel) {
    this.connection.publish(channel, message);
  }.bind(this));
};

Driver.prototype.send = function (channels, message) {

  message = this.prepareOutgoingMessage(message);
  this.sendRaw(channels, message);
  return message;
};

Driver.prototype.reply = function (source, response) {
  // FIXME: implement ttl or something against loops
  if(!this.validate(source)) {
    throw new Error('source message is invalid: ' + this.validate.errors);
  }
  var topic = source.sender.topic;
  if(!topic) {
    return false;
  }
  response = this.prepareOutgoingMessage(response);
  response.threadId = source.threadId;
  this.sendRaw(topic, response);
  return response;
};