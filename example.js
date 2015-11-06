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
  name: 'Василий',
  connections: {
    natural: { adaptor: 'natural', lang: 'ru', tree: syntaxTree },
    mqtt: { adaptor: 'mqtt', host: 'mqtt://localhost' }
  },
  devices: {
    test: { driver: 'natural', language: 'natural', connection: 'mqtt', listen: ['test'], treeListenDepth: 3 }
  },
  work: function (my) {
    // 2do: export methods from driver
    // and test send-receive
  }
});

Cylon.start();
