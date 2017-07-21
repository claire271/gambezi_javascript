////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
// External API
function Gambezi(host_address) {
	// Constructor
	var m_object = this;
	var m_websocket = new WebSocket("ws://" + host_address, "gambezi-protocol");
	m_websocket.binaryType = 'arraybuffer';
	var m_key_request_queue = [];
	var m_root_node = new Node("", null, m_object);

	////////////////////////////////////////////////////////////////////////////////
	// Recieving data from server
	m_websocket.onmessage = function(event) {
		var buffer = new Uint8Array(event.data);
		switch(buffer[0]) {

			////////////////////////////////////////
			// ID request response from server
			case 0:
				// Extract binary key
				var binary_key = new Array(buffer[1]);
				for(var i = 0;i < binary_key.length;i++) {
					binary_key[i] = buffer[i + 2];
				}

				// Extract name
				var name = "";
				for(var i = 0;i < buffer[binary_key.length + 2];i++) {
					name += String.fromCharCode(buffer[binary_key.length + 3 + i]);
				}

				// Get the matching node and set the ID
				var node = m_object.node_traverse(binary_key, true);
				node = node.get_child_with_name(name);
				node.set_key(binary_key);

				// Get the next queued ID request
				m_object.process_key_request_queue();
				break;

			////////////////////////////////////////
			// Value update from server
			case 1:
				// Extract binary key
				var binary_key = new Array(buffer[1]);
				for(var i = 0;i < binary_key.length;i++) {
					binary_key[i] = buffer[i + 2];
				}

				// Extract data
				var data_length = (buffer[binary_key.length + 2] << 8) | (buffer[binary_key.length + 3]);
				var data_raw = new ArrayBuffer(data_length);
				var data = new Uint8Array(data_raw);
				for(var i = 0;i < data_length;i++) {
					data[i] = buffer[binary_key.length + 4 + i];
				}

				// Get the matching node and set the data
				var node = m_object.node_traverse(binary_key);
				node.set_data(data);

				// Callback if present
				if(node.on_data_recieved) {
					node.on_data_recieved(node);
				}
				break;
		}
	}

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.request_id = function(parent_key, name) {
		// Create buffer
		var buffer_raw = new ArrayBuffer(parent_key.length + name.length + 3);
		var buffer = new Uint8Array(buffer_raw);

		// Header
		buffer[0] = 0x00;

		// Parent key
		buffer[1] = parent_key.length;
		for(var i = 0;i < parent_key.length;i++) {
			buffer[i + 2] = parent_key[i];
		}

		// Name
		buffer[2 + parent_key.length] = name.length;
		for(var j = 0;j < name.length;j++) {
			buffer[j + 3 + parent_key.length] = name.charCodeAt(j);
		}

		// Send packet
		m_websocket.send(buffer_raw);
	}

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.add_key_to_request_queue = function(string_key) {
		// Traverse up to final node
		var node = m_root_node;
		for(var i = 0;i < string_key.length;i++) {
			// Go down one level
			node = node.get_child_with_name(string_key[i]);

			// Queue up ID request if needed
			if(node.get_id() < 0) {
				m_key_request_queue.push(string_key.slice(0, i + 1));
			}
		}

		return node;
	}

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.process_key_request_queue = function() {
		// Bail if there are no more queued ID requests
		if(m_key_request_queue.length <= 0) {
			return;
		}

		// Build the parent key
		var string_key = m_key_request_queue.shift();
		var parent_binary_key = new Array(string_key.length - 1);
		var node = m_root_node;
		for(var i = 0;i < string_key.length - 1;i++) {
			node = node.get_child_with_name(string_key[i]);
			parent_binary_key[i] = node.get_id();
		}

		// Request the ID
		var name = string_key[string_key.length - 1];
		m_object.request_id(parent_binary_key, name);
	}

	////////////////////////////////////////////////////////////////////////////////
	// External API
	this.register_key = function(string_key) {
		// Queue up the ID requests and get the node
		var node = m_object.add_key_to_request_queue(string_key);
		// Get an IDs necessary
		m_object.process_key_request_queue();
		// Return
		return node;
	}

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.set_data_raw = function(key, data, offset, length) {
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

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.request_data = function(key, get_children) {
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

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.node_traverse = function(binary_key, get_parent) {
		var node = m_root_node;
		for(var i = 0;i < binary_key.length - (!!get_parent ? 1 : 0);i++) {
			node = node.get_child_with_id(binary_key[i]);
		}
		return node;
	}

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.node_traverse_by_name = function(string_key, get_parent) {
		var node = m_root_node;
		for(var i = 0;i < string_key.length - (!!get_parent ? 1 : 0);i++) {
			node = node.get_child_with_name(string_key[i]);
		}
		return node;
	}
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
// External API
function Node(name, parent_key, parent_gambezi) {

	////////////////////////////////////////////////////////////////////////////////
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

	////////////////////////////////////////////////////////////////////////////////
	// External API
	this.get_id = function() {
		return m_key[m_key.length - 1];
	}

	////////////////////////////////////////////////////////////////////////////////
	// External API
	this.get_name = function() {
		return m_name;
	}

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.set_key = function(key) {
		m_key = key;
	}

	////////////////////////////////////////////////////////////////////////////////
	// External API
	this.get_key = function() {
		return m_key;
	}

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.set_data = function(data) {
		m_data = data;
	}

	////////////////////////////////////////////////////////////////////////////////
	// External API
	this.get_data = function() {
		return m_data;
	}

	////////////////////////////////////////////////////////////////////////////////
	// External API
	this.on_data_recieved = null;

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.get_child_with_name = function(name) {
		// See if child already exists
		for(var i = 0;i < m_children.length;i++) {
			if(m_children[i].get_name() == name) {
				return m_children[i];
			}
		}

		// Create child
		child = new Node(name, m_key, m_gambezi);
		m_children.push(child);
		return child;
	}

	////////////////////////////////////////////////////////////////////////////////
	// Internal use only
	this.get_child_with_id = function(id) {
		// See if child already exists
		for(var i = 0;i < m_children.length;i++) {
			if(m_children[i].get_id() == id) {
				return m_children[i];
			}
		}

		// None found
		return null;
	}

	////////////////////////////////////////////////////////////////////////////////
	// External API
	this.set_data_raw = function(data, offset, length) {
		m_gambezi.set_data_raw(m_object.get_key(), data, offset, length);
	}

	////////////////////////////////////////////////////////////////////////////////
	// External API
	this.request_data = function(get_children) {
		m_gambezi.request_data(m_object.get_key(), get_children);
	}
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
gambezi = new Gambezi("127.0.0.1:7686");
data = new ArrayBuffer(5)
dataView = new Uint8Array(data)
for(var i = 0;i < 5;i++) { dataView[i] = i; }
