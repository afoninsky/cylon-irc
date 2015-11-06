'use strict';

var Driver = require('./lib/driver');

module.exports = {
  drivers: ['natural'],
  driver: function(opts) {
    return new Driver(opts);
  }
};
