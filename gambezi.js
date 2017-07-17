function Gambezi(host_address) {
	// Constructor
	var object = this;
	var websocket = new WebSocket("ws://" + host_address, "gambezi-protocol");
	websocket.binaryType = 'arraybuffer';

	var keys = [];
	var queueID = [];
	var root_node = new Node("");

	// Recieving data from server
	websocket.onmessage = function(event) {
		var data = new Uint8Array(event.data);
		switch(data[0]) {
			// ID request response from server
			case 0:
				// Extract binary key
				var binaryKey = new Array(+data[1]);
				for(var i = 0;i < binaryKey.length;i++) {
					binaryKey[i] = data[i + 2];
				}

				// Extract name
				var name = "";
				for(var i = 0;i < +data[binaryKey.length + 2];i++) {
					name += String.fromCharCode(data[binaryKey.length + 3 + i]);
				}

				// Get the matching node and set the ID
				var node = root_node;
				for(var i = 0;i < binaryKey.length - 1;i++) {
					node = node.getChildWithID(binaryKey[i]);
				}
				node = node.getChildWithName(name);
				node.setID(binaryKey[binaryKey.length - 1]);

				// Get the next queued ID request
				getQueueID();

				break;
		}
	}

	function getID(parentKey, name) {
		// Check if ID already assigned
		var node = root_node;
		for(var i = 0;i < parentKey.length;i++) {
			node = node.getChildWithID(parentKey[i]);
		}
		node = node.getChildWithName(name);

		// Bail if the node already has an ID
		if(node.getID() >= 0) {
			return;
		}

		// Request ID from server
		var buffer = new ArrayBuffer(parentKey.length + name.length + 3);
		var view = new Uint8Array(buffer);
		view[0] = 0x00;
		view[1] = parentKey.length;
		for(var i = 0;i < parentKey.length;i++) {
			view[i + 2] = parentKey[i];
		}
		view[2 + parentKey.length] = name.length;
		for(var j = 0;j < name.length;j++) {
			view[j + 3 + parentKey.length] = name.charCodeAt(j);
		}
		websocket.send(buffer);
	}

	function addQueueID(stringKey) {
		// Check if an ID is already present
		var node = root_node;
		for(var i = 0;i < stringKey.length;i++) {
			node = node.getChildWithName(stringKey[i]);
		}

		// Queue up ID request if needed
		if(node.getID() < 0) {
			queueID.push(stringKey);
		}
	}

	function getQueueID() {
		// Bail if there are no more queued ID requests
		if(queueID.length <= 0) {
			return;
		}

		// Build the parent key
		var stringKey = queueID.shift();
		var parentKey = [];
		var node = root_node;
		for(var i = 0;i < stringKey.length - 1;i++) {
			node = node.getChildWithName(stringKey[i]);
			parentKey.push(node.getID());
		}

		// Request the ID
		var name = stringKey[stringKey.length - 1];
		getID(parentKey, name);
	}

	function registerKey(stringKey) {
		// Get the node
		var node = root_node;
		for(var i = 0;i < stringKey.length;i++) {
			node = node.getChildWithName(stringKey[i]);
		}

		// Queue up the ID requests
		for(var i = 0;i < stringKey.length;i++) {
			addQueueID(stringKey.slice(0, i + 1));
		}
		getQueueID();

		return node;
	}
	this.registerKey = registerKey;

}

function Node(new_name) {
	var name = new_name;
	var id = -1;
	var children = [];

	this.setID = function(new_id) {
		id = new_id;
	}

	this.getID = function() {
		return id;
	}

	this.getName = function() {
		return name;
	}

	this.getChildWithName = function(name) {
		// See if child already exists
		for(var i = 0;i < children.length;i++) {
			if(children[i].getName() == name) {
				return children[i];
			}
		}

		// Create child
		child = new Node(name);
		children.push(child);
		return child;
	}

	this.getChildWithID = function(id) {
		// See if child already exists
		for(var i = 0;i < children.length;i++) {
			if(children[i].getID() == id) {
				return children[i];
			}
		}

		// None found
		return null;
	}
}

function arrayCompare(a, b) {
	if(a.length != b.length) return false;
	for(var i = 0;i < a.length;i++)
		if(a[i] != b[i]) return false;
	return true;
}

gambezi = new Gambezi("127.0.0.1:7685");
