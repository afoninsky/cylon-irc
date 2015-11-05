'use strict';
var Cylon = require('cylon');

var syntaxTree = {
  "кухня": {
    "свет": {
      "включить": "on",
      "выключить": "off"
    }
  },
};

Cylon.robot({
  name: 'Vasya',
  connections: {
    lang: { adaptor: 'natural', lang: 'ru', tree: syntaxTree }
  },
  work: function (my) {
    // console.log(my.connections.lang.test);
  }
});

Cylon.start();
