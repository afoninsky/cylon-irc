'use strict';

var Cylon = require('cylon');

var Driver = module.exports = function Driver(cfg) {
  Driver.__super__.constructor.apply(this, arguments);

  // cfg.listen
  // console.log(this.connection.subscribe);
  console.log(this);
  // var qwe = [1]
  // console.log(qwe instanceof Array)
};

Cylon.Utils.subclass(Driver, Cylon.Driver);

Driver.prototype.start = function(callback) {
  callback();
};

Driver.prototype.halt = function(callback) {
  callback();
};

Driver.prototype.test = function () {
  console.log(this.connection.parse);
};
