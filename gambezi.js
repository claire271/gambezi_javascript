function Gambezi(host_address) {
	// Constructor
	var m_object = this;
	var m_websocket = new WebSocket("ws://" + host_address, "gambezi-protocol");
	m_websocket.binaryType = 'arraybuffer';

	var m_queued_ids = [];
	var m_root_node = new Node("", null, m_object);

	// Recieving data from server
	m_websocket.onmessage = function(event) {
		var data = new Uint8Array(event.data);
		switch(data[0]) {
			// ID request response from server
			case 0:
				// Extract binary key
				var binary_key = new Array(data[1]);
				for(var i = 0;i < binary_key.length;i++) {
					binary_key[i] = data[i + 2];
				}

				// Extract name
				var name = "";
				for(var i = 0;i < data[binary_key.length + 2];i++) {
					name += String.fromCharCode(data[binary_key.length + 3 + i]);
				}

				// Get the matching node and set the ID
				var node = m_root_node;
				for(var i = 0;i < binary_key.length - 1;i++) {
					node = node.getChildWithID(binary_key[i]);
				}
				node = node.getChildWithName(name);
				node.setKey(binary_key);

				// Get the next queued ID request
				m_object.getQueueID();

				break;

			// Value update from server
			case 1:
				// Extract binary key
				var binary_key = new Array(data[1]);
				for(var i = 0;i < binary_key.length;i++) {
					binary_key[i] = data[i + 2];
				}

				// Extract data length
				var data_length = (data[binary_key.length + 2] << 8) | (data[binary_key.length + 3]);

				// Extract data
				var value = new ArrayBuffer(data_length);
				var value_view = new Uint8Array(value);
				for(var i = 0;i < data_length;i++) {
					value_view[i] = data[binary_key.length + 4 + i];
				}

				// Get the matching node and set the data
				var node = m_root_node;
				for(var i = 0;i < binary_key.length;i++) {
					node = node.getChildWithID(binary_key[i]);
				}
				node.setData(value_view);
				if(node.onDataRecieved) {
					node.onDataRecieved(node);
				}

				break;
		}
	}

	this.getID = function(parentKey, name) {
		// Check if ID already assigned
		var node = m_root_node;
		for(var i = 0;i < parentKey.length;i++) {
			node = node.getChildWithID(parentKey[i]);
		}
		node = node.getChildWithName(name);

		// Bail if the node already has an ID
		if(node.getID() >= 0) {
			return;
		}

		// Create buffer
		var buffer = new ArrayBuffer(parentKey.length + name.length + 3);
		var view = new Uint8Array(buffer);

		// Header
		view[0] = 0x00;

		// Parent key
		view[1] = parentKey.length;
		for(var i = 0;i < parentKey.length;i++) {
			view[i + 2] = parentKey[i];
		}

		// Name
		view[2 + parentKey.length] = name.length;
		for(var j = 0;j < name.length;j++) {
			view[j + 3 + parentKey.length] = name.charCodeAt(j);
		}

		// Send packet
		m_websocket.send(buffer);
	}

	this.addQueueID = function(stringKey) {
		// Check if an ID is already present
		var node = m_root_node;
		for(var i = 0;i < stringKey.length;i++) {
			node = node.getChildWithName(stringKey[i]);
		}

		// Queue up ID request if needed
		if(node.getID() < 0) {
			m_queued_ids.push(stringKey);
		}
	}

	this.getQueueID = function() {
		// Bail if there are no more queued ID requests
		if(m_queued_ids.length <= 0) {
			return;
		}

		// Build the parent key
		var stringKey = m_queued_ids.shift();
		var parentKey = [];
		var node = m_root_node;
		for(var i = 0;i < stringKey.length - 1;i++) {
			node = node.getChildWithName(stringKey[i]);
			parentKey.push(node.getID());
		}

		// Request the ID
		var name = stringKey[stringKey.length - 1];
		m_object.getID(parentKey, name);
	}

	this.registerKey = function(stringKey) {
		// Get the node
		var node = m_root_node;
		for(var i = 0;i < stringKey.length;i++) {
			node = node.getChildWithName(stringKey[i]);
		}

		// Queue up the ID requests
		for(var i = 0;i < stringKey.length;i++) {
			m_object.addQueueID(stringKey.slice(0, i + 1));
		}
		m_object.getQueueID();

		return node;
	}

	this.setValueRaw = function(key, data, offset, length) {
		// Create buffer
		var buffer = new ArrayBuffer(key.length + length + 4);
		var view = new Uint8Array(buffer);
		var dataView = new Uint8Array(data);

		// Header
		view[0] = 0x01;

		// Key
		view[1] = key.length;
		for(var i = 0;i < key.length;i++) {
			view[i + 2] = key[i];
		}

		// Length
		view[2 + key.length] = (length >> 8) & 0xFF
		view[3 + key.length] = (length) & 0xFF

		// Value
		for(var j = 0;j < length;j++) {
			view[j + 4 + key.length] = dataView[j + offset];
		}

		// Send packet
		m_websocket.send(buffer);
	}

	this.requestValue = function(key, get_children) {
		// Create buffer
		var buffer = new ArrayBuffer(key.length + 3);
		var view = new Uint8Array(buffer);

		// Header
		view[0] = 0x04;
		view[1] = get_children ? 1 : 0;

		// Key
		view[2] = key.length;
		for(var i = 0;i < key.length;i++) {
			view[i + 3] = key[i];
		}

		// Send packet
		m_websocket.send(buffer);
	}

}

function Node(name, parent_key, parent_gambezi) {
	// Constructor
	var m_object = this;
	var m_name = name;
	var m_children = [];
	var m_gambezi = parent_gambezi;
	var m_key = [];
	var m_data = new ArrayBuffer(0);
	if(parent_key !== null) {
		for(var i = 0;i < parent_key.length;i++) {
			m_key.push(parent_key[i]);
		}
		m_key.push(-1);
	}

	this.getID = function() {
		return m_key[m_key.length - 1];
	}

	this.getName = function() {
		return m_name;
	}

	this.setKey = function(key) {
		m_key = key;
	}

	this.getKey = function() {
		return m_key;
	}

	this.setData = function(data) {
		m_data = data;
	}

	this.getData = function() {
		return m_data;
	}

	this.onDataRecieved = null;

	this.getChildWithName = function(name) {
		// See if child already exists
		for(var i = 0;i < m_children.length;i++) {
			if(m_children[i].getName() == name) {
				return m_children[i];
			}
		}

		// Create child
		child = new Node(name, m_key, m_gambezi);
		m_children.push(child);
		return child;
	}

	this.getChildWithID = function(id) {
		// See if child already exists
		for(var i = 0;i < m_children.length;i++) {
			if(m_children[i].getID() == id) {
				return m_children[i];
			}
		}

		// None found
		return null;
	}

	this.setValueRaw = function(data, offset, length) {
		m_gambezi.setValueRaw(m_object.getKey(), data, offset, length);
	}

	this.requestValue = function(get_children) {
		m_gambezi.requestValue(m_object.getKey(), get_children);
	}
}

function arrayCompare(a, b) {
	if(a.length != b.length) return false;
	for(var i = 0;i < a.length;i++)
		if(a[i] != b[i]) return false;
	return true;
}

gambezi = new Gambezi("127.0.0.1:7685");
data = new ArrayBuffer(5)
dataView = new Uint8Array(data)
for(var i = 0;i < 5;i++) { dataView[i] = i; }
//node = gambezi.registerKey(['hi'])
