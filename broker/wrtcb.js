var crypto = require('crypto');

var io = require('socket.io').listen(8080, {
	'log level': 2
});

var jsMime = {
  type: 'application/javascript',
  encoding: 'utf8',
  gzip: true
};

io.static.add('/wrtcp.js', {
	mime: jsMime,
  file: 'client/wrtcp.js'
});

io.static.add('/wrtcp.min.js', {
	mime: jsMime,
	file: 'client/wrtcp.min.js'
});

function mkguid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  }).toUpperCase();
};

var peers = {};
var hosts = {};

var E = {
		OK: 'ok'
	, NOROUTE: 'no such route'
	, ISNOTHOST: 'peer is not a host'
};

function Peer(socket) {
	this.socket = socket;
	this.host = null;
};

function Host(options) {
	this.route = options['route'];
	this.url = options['url'];
	this.listed = (undefined !== options['listed']) ? options['listed'] : false;
	this.metadata = options['metadata'] || {};
	this.ctime = Date.now();
	this.mtime = Date.now();
};
Host.prototype.update = function update(options) {
	this.url = options['url'];
	this.listed = (undefined !== options['listed']) ? options['listed'] : false;
	this.metadata = options['metadata'] || {};
	this.mtime = Date.now();
};

io.of('/peer').on('connection', function(socket) {
	var route = crypto.createHash('md5').update(socket['id']).digest('hex');
	socket.emit('route', route);

	socket.on('disconnect', function() {
		if(hosts[route]) {
			var host = hosts[route];
			changeList('remove', host);
		}
		delete hosts[route];
		delete peers[route];
	});

	socket.on('send', function(message, callback) {
		var to = message['to'];

		if(!peers.hasOwnProperty(to)) {
			callback({'error': E.NOROUTE});
			return;
		}

		var from = route;
		var data = message['data'];
		peers[to].emit('receive', {
			'from': from,
			'data': data
		});
	});

	socket.on('listen', function(options, callback) {
		options['route'] = route;
		if(hosts.hasOwnProperty(route)) {
			hosts[route].update(options);
			changeList('update', hosts[route]);
		} else {
			hosts[route] = new Host(options);
			changeList('append', hosts[route]);
		}

		callback();
	});

	socket.on('ignore', function(message, callback) {
		if(!hosts.hasOwnProperty(route)) {
			callback({'error': E.ISNOTHOST});
			return;
		}

		var host = hosts[route];
		delete hosts[route];

		changeList('remove', host);

		callback();
	});

	peers[route] = socket;
});

function Filter(socket, options) {
	this.options = options || {};
	this.socket = socket;
};
Filter.prototype.test = function test(host) {
	var filter = this.options;
	if(filter['metadata'] && host['metadata']) {
		var metadataFilter = filter['metadata'];
		var metadataHost = host['metadata'];
		if(metadataFilter['name'] && typeof metadataHost['name'] === 'string') {
			var result;
			try {
				result = metadataHost['name'].match(metadataFilter['name']);
			} catch(e) {
				return false;
			}

			if(result)
				return true;
		}
	} else {
		return false;
	}
};

var lists = {};

function changeList(operation, host) {
	var clients = Object.keys(lists);
	clients.forEach(function(client) {
		var filter = lists[client];
		if(!host['listed'])
			return;
		if(filter.test(host)) {
			var data = operation === 'remove' ? host['route'] : host;
			filter.socket.emit(operation, data);
		}
	});
};

io.of('/list').on('connection', function(socket) {
	var id = socket['id'];

	socket.on('disconnect', function() {
		delete lists[id];
	});

	socket.on('list', function(options) {
		var filter = new Filter(socket, options);

		var result = [];

		var hostIds = Object.keys(hosts);
		hostIds.forEach(function(hostId) {
			var host = hosts[hostId];
			if(!host['listed'])
				return;
			if(filter.test(host))
				result.push(host);
		});

		lists[id] = filter;

		socket.emit('truncate', result);
	});
});