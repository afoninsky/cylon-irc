'use strict';

var Adaptor = require('./lib/adaptor'),
    Driver = require('./lib/driver');

module.exports = {
  adaptors: ['natural'],
  drivers: ['natural'],
  adaptor: function(opts) {
    return new Adaptor(opts);
  },
  driver: function(opts) {
    return new Driver(opts);
  }
};
