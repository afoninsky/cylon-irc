'use strict';

var Cylon = require('cylon'),
    _ = require('lodash'),
    os = require('os'),
    uuid = require('node-uuid'),
    Lang = require('iot-native-lang'),
    hash = require('string-hash'),
    validator = require('is-my-json-valid');

var defaultConfig = {
  lang: 'en',           // parse using 'lang' dictionary
  tree: {},             // syntax tree with commands
  listen: undefined,    // listen incoming messages on this channels
                        // array - exact channels, string - parse into syntax tokens
  private: false,       // true - use robot name as private channel, string - private channel name
                        // cast to false - don't use privates
  global: 'network',    // listen global network events
  treeListenDepth: 0,   // extract tokens from 'tree' till desired and start listen on them
  minTokenLength: 4,    // minimum required word length to act as token
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
  if(cfg.global) {
    this.globalTopic = cfg.global;
  }

  this.receivedMessages = {};
  this.validate = validator(messageSchema);
  this.treeIsEmpty = _.isEmpty(cfg.tree);

  this.extractTokens = function (text) {
    return this.lang.extractTokens(text, cfg.minTokenLength);
  };
};

Cylon.Utils.subclass(Driver, Cylon.Driver);

Driver.prototype.start = function(callback) {
  var listen = this.getListenChannels(),
    transport = this.connection;

  transport.on('message', this.emitIncomingMessage.bind(this));
  this.pruneHandler = setInterval(this.pruneReceived.bind(this), this.cfg.pruneInterval);

  if(listen.length) {
    transport.subscribe(listen);
    this.robot.log('Listening channels: ' + listen);
  }

  // include private topic into message headers so other robots can reply to message
  // 'private' event emitted in this case
  if(this.privateTopic) {
    transport.subscribe(this.privateTopic);
    this.robot.log('Listening private: ' + this.privateTopic);
  }

  // subscribe on global channel so robot can receive common instructions, answer to ping etc
  // 'global' event emitted in this case and predefined actions performed sometimes
  if(this.globalTopic) {
    this.robot.log('Subscribed to global events');
    transport.subscribe(this.globalTopic);
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
    extractTokens = this.extractTokens.bind(this);

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
    var defaultIndex = listenFromTree.indexOf(this.lang.defaultToken);
    if(defaultIndex !== -1) {
      listenFromTree.splice(defaultIndex, 1);
    }
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

// events: 'global', 'private', 'noise', 'command', 'message'
// alwaya pass: payload, raw message, topic
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
  if(topic === this.globalTopic) {
    return this.emit('global', payload, parsedMessage, topic);
  }
  if(this.receivedMessages[parsedMessage.id]) { return; } // this message already received on other topic
  this.receivedMessages[parsedMessage.id] = Date.now();
  if(!this.treeIsEmpty && typeof payload === 'string') {
    // try to parse string into understandable command
    // emit event in this case or ignore
    return this.emit(
      'command',
      _.cloneDeep(this.lang.hear(payload)),
      parsedMessage,
      topic
    );
  }
  // none events found, looks like simple message with json payload directly to one of channels
  this.emit('message', payload, parsedMessage, topic);
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

// send raw message directly to network, cylons will not hear it
Driver.prototype.sendRaw = function (channels, message) {

  channels = channels instanceof Array ? channels : [ channels ];
  channels.forEach(function (channel) {
    this.connection.publish(channel, message);
  }.bind(this));
};

// send message to networc, cylons will hear it
// channels can be array or string
// if string specified - it will be parsed into tokens and message will be sent there
Driver.prototype.send = function (channels, message) {
  if(_.isArray(channels)) {
    // do nothing - channels are ok
  } else {
    message = message || channels;
    channels = this.extractTokens(channels);
  }
  message = this.prepareOutgoingMessage(message);
  setImmediate(this.sendRaw, channels, message);
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
