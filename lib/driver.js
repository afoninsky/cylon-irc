'use strict';

var Cylon = require('cylon'),
    _ = require('lodash'),
    os = require('os'),
    uuid = require('node-uuid'),
    validator = require('is-my-json-valid');

var defaultConfig = {
  listen: undefined,
  treeListenDepth: 0,
  transport: undefined,
  language: undefined,
  pruneInterval: 10000
};

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

var Driver = module.exports = function Driver(_cfg) {

  Driver.__super__.constructor.apply(this, arguments);
  var cfg = this.cfg = _.defaults(_.pick(_cfg, _.keys(defaultConfig)), defaultConfig);

  this.transport = this.connection;
  this.language = this.robot.connections[cfg.language];

  this.credentials = {
    name: this.robot.name,
    host: os.hostname()
  };

  this.privateTopic = this.robot.name;

  this.prevMessages = {};
  this.validate = validator(messageSchema);

};

Cylon.Utils.subclass(Driver, Cylon.Driver);

Driver.prototype.start = function(callback) {
  var listen = this.getListenChannels(),
    transport = this.transport;

  transport.on('message', this.emitIncomigMessage.bind(this));
  this.pruneHandler = setInterval(this.pruneReceived.bind(this), this.cfg.pruneInterval);

  listen.push(this.privateTopic);
  this.robot.log('Listen on channels: ' + listen);
  transport.subscribe(listen);
  callback();
};

Driver.prototype.halt = function(callback) {
  clearInterval(this.pruneHandler);
  this.transport.client.end(callback);
};

// return array of channels to listen (directly specified in cfg.listen or from syntax tree)
Driver.prototype.getListenChannels = function () {

  var cfg = this.cfg, listen = [], listenFromTree = [],
    extractTokens = this.language.extractTokens.bind(this.language),
    minTokenLength = this.language.cfg.minTokenLength;

  if(cfg.listen instanceof Array) {
    listen = cfg.listen;
  } else if(typeof cfg.listen === 'string') {
    listen = extractTokens(cfg.listen, minTokenLength);
  }
  if(cfg.treeListenDepth) {
    var str = '', tree = this.language.getSyntaxTree(),
      getKeys = function (tree, currentDepth) {
        if(currentDepth >= cfg.treeListenDepth) { return; }
        for(var key in tree) {
          str += ' ' + key;
          getKeys(tree[key], currentDepth + 1);
        }
      };
    getKeys(tree, 0);
    listenFromTree = extractTokens(str, minTokenLength);
  }
  return _.union(listen, listenFromTree);
};


Driver.prototype.pruneReceived = function () {
  var messages = this.prevMessages,
      till = Date.now() - this.cfg.pruneInterval;
  for(var id in messages) {
    if(till > messages[id]) {
      delete messages[id];
    }
  }
};

Driver.prototype.alreadyReceived = function (msg) {
  if(this.prevMessages[msg.id]) { return true; }
  this.prevMessages[msg.id] = Date.now();
  return false;
};


Driver.prototype.emitIncomigMessage = function (topic, message) {
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
    replyTo: this.privateTopic,
    payload: msg
  };
  if(!this.validate(message)) {
    throw new Error(this.validate.errors);
  }
  return new Buffer(JSON.stringify(message));
};

Driver.prototype.send = function (channels, message) {
  message = this.prepareOutgoingMessage(message);
  var isArray = channels instanceof Array;
  if(!isArray) { channels = [ channels ]; }

  channels.forEach(function (channel) {
    this.transport.publish(channel, message);
  }.bind(this));
  return message;
};

Driver.prototype.reply = function (source, response) {
  // FIXME: implement ttl or something against loops
  if(!source.replyTo || !source.threadId) {
    return false;
  }
  response = this.prepareOutgoingMessage(response);
  response.threadId = source.threadId;
  this.transport.publish(source.replyTo, response);
  return response;
};
