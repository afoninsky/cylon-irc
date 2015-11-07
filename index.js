'use strict';

var Driver = require('./lib/driver');

module.exports = {
  drivers: ['irc'],
  driver: function(opts) {
    return new Driver(opts);
  }
};
