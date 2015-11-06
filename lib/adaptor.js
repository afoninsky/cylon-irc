'use strict';

var Cylon = require('cylon'),
    Lang = require('iot-native-lang'),
    _ = require('lodash');

var defaultConfig = {
  minTokenLength: 4,
  lang: 'en',
  tree: undefined
};

var Adaptor = module.exports = function Adaptor(_cfg) {
  
  Adaptor.__super__.constructor.apply(this, arguments);
  var cfg = this.cfg = _.defaults(_.pick(_cfg, _.keys(defaultConfig)), defaultConfig);

  this.lang = new Lang({
    lang: cfg.lang,
    listen: cfg.tree,
    minTokenLength: cfg.minTokenLength
  });
};

Cylon.Utils.subclass(Adaptor, Cylon.Adaptor);

Adaptor.prototype.connect = function (callback) {
  callback();
};

Adaptor.prototype.disconnect = function (callback) {
  callback();
};

Adaptor.prototype.extractTokens = function () {
  return this.lang.extractTokens.apply(this.lang, arguments);
};

Adaptor.prototype.getSyntaxTree = function () {
  return this.cfg.tree;
};
