////////////////////////////////////////////////////////////////////////////////
/**
 * Constructs a gambezi instance and connects to a server at the given address
 * Visibility: Public
 */
function Gambezi(host_address) {
	/**
	 * Constructor
	 */
	var m_object = this;
	var m_websocket = new WebSocket("ws://" + host_address, "gambezi-protocol");
	m_websocket.binaryType = 'arraybuffer';
	var m_key_request_queue = [];
	var m_root_node = new Node("", null, m_object);
	var m_ready = false;
	// End constructor

	/**
	 * Callback when there is a websocket error 
	 */
	m_websocket.onerror = function(event) {
		if(m_object.on_error) {
			m_object.on_error(event);
		}
	}

	/**
	 * Callback when the websocket gets initialized
	 */
	m_websocket.onopen = function(event) {
		m_ready = true;
		if(m_object.on_ready) {
			m_object.on_ready(event);
		}
	}

	/**
	 * Callback when the client recieves a packet from the server
	 */
	m_websocket.onmessage = function(event) {
		var buffer = new Uint8Array(event.data);
		switch(buffer[0]) {
			////////////////////////////////////////
			// ID response from server
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
				var node = node_traverse(binary_key, true);
				// Bail if the key is bad
				if(node == null) {
					break;
				}
				node = node.get_child_with_name(name);
				node.set_key(binary_key);

				// Get the next queued ID request
				var code = 1;
				while(code > 0) {
					code = process_key_request_queue();
					// Error when processing IDs
					if(code) {
						if(m_object.on_error) {
							m_object.on_error("Error processing ID queue");
						}
					}
				}
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
				var node = node_traverse(binary_key);
				// Bail if the key is bad
				if(node == null) {
					break;
				}
				node.set_data(data);

				// Callback if present
				if(node.on_data_recieved) {
					node.on_data_recieved(node);
				}
				break;

			////////////////////////////////////////
			// Error message from server
			case 2:
				// Extract message
				var message = "";
				for(var i = 0;i < buffer[1];i++) {
					message += String.fromCharCode(buffer[2 + i]);
				}
				// Use the message
				if(m_object.on_error) {
					m_object.on_error(message);
				}
				break;
		}
	}

	/**
	 * This callback is called when this gambezi instance has an error
	 *
	 * Visibility: Public
	 */
	this.on_error = null;
	
	/**
	 * This callback is called when this gambezi instance is ready
	 *
	 * Visibility: Public
	 */
	this.on_ready = null;

	/**
	 * Returns whether this gambezi instance is ready to communicate
	 *
	 * Visibility: Public
	 */
	this.is_ready = function() {
		return m_ready;
	}

	/**
	 * Requests the ID of a node for a given parent key and name
	 *
	 * Visibility: Private
	 */
	function request_id(parent_key, name) {
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
		if(m_ready) {
			m_websocket.send(buffer_raw);
			return 0;
		}
		else {
			return 1;
		}
	}

	/**
	 * Queues up a string key and all of its ancestors so their IDs
	 * can be requested from the server
	 *
	 * Returns the node that is identified by the string key
	 * This node may or may not be ready for interaction yet
	 *
	 * Visibility: Private
	 */
	function add_key_to_request_queue(string_key) {
		var node = m_root_node;
		for(var i = 0;i < string_key.length;i++) {
			// Go down one level
			node = node.get_child_with_name(string_key[i]);

			// Queue up ID request if needed
			if(node.get_id() < 0) {
				m_key_request_queue.push(string_key.slice(0, i + 1));
			}
		}

		// Return the node identified by the string key
		return node;
	}

	/**
	 * Processes a string key request in the queue
	 * 
	 * Visibility: Private
	 */
	function process_key_request_queue() {
		// Bail if there are no more queued ID requests
		if(m_key_request_queue.length <= 0) {
			return 0;
		}

		// Build the binary parent key
		var string_key = m_key_request_queue.shift();
		var parent_binary_key = new Array(string_key.length - 1);
		var node = m_root_node;
		for(var i = 0;i < string_key.length - 1;i++) {
			node = node.get_child_with_name(string_key[i]);
			var id = node.get_id();
			// Bail if the parent does not have an ID
			if(id < 0) {
				return 1;
			}
			parent_binary_key[i] = id;
		}

		// Request the ID
		var name = string_key[string_key.length - 1];
		request_id(parent_binary_key, name);

		// Success
		return 0;
	}

	/**
	 * Registers a string key and gets the corresponding node
	 * 
	 * Visibility: Public
	 */
	this.register_key = function(string_key) {
		// Queue up the ID requests and get the node
		var node = add_key_to_request_queue(string_key);
		// Get an IDs necessary
		var code = 1;
		while(code > 0) {
			code = process_key_request_queue();
			// Error when processing IDs
			if(code) {
				if(m_object.on_error) {
					m_object.on_error("Error processing ID queue");
				}
			}
		}
		// Return
		return node;
	}

	/**
	 * Sets the refresh rate of this client in milliseconds
	 * 
	 * Visibility: Public
	 */
	this.set_refresh_rate = function(refresh_rate) {
		// Create buffer
		var buffer = new ArrayBuffer(3);
		var view = new Uint8Array(buffer);

		// Header
		view[0] = 0x02;

		// Length
		view[1] = (refresh_rate >> 8) & 0xFF
		view[2] = (refresh_rate) & 0xFF

		// Send packet
		if(m_ready) {
			m_websocket.send(buffer);
			return 0;
		}
		else {
			return 1;
		}
	}

	/**
	 * Sets the value of a node with a byte buffer
	 * 
	 * Visibility: Package
	 */
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
		if(m_ready) {
			m_websocket.send(buffer);
			return 0;
		}
		else {
			return 1;
		}
	}

	/**
	 * Requests the value of a node
	 * 
	 * get_children determines if all descendent keys will
	 * be retrieved
	 * 
	 * Visibilty: Package
	 */
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
		if(m_ready) {
			m_websocket.send(buffer);
			return 0;
		}
		else {
			return 1;
		}
	}

	/**
	 * Updates the subscription for a paticular key
	 *
	 * set_children determines if all descendent keys will
	 * be retrieved
	 *
	 * Values for refresh_skip
	 * 0x0000 - get node value updates as soon as they arrive
	 * 0xFFFF - unsubscribe from this key
	 * Any other value of refresh skip indicates that this node
	 * will be retrieved every n client updates
	 *
	 * Visibility: Package
	 */
	this.update_subscription = function(key, refresh_skip, set_children) {
		// Create buffer
		var buffer = new ArrayBuffer(key.length + 5);
		var view = new Uint8Array(buffer);

		// Header
		view[0] = 0x03;
		view[1] = set_children ? 1 : 0;
		view[2] = (refresh_skip >> 8) & 0xFF;
		view[3] = (refresh_skip) & 0xFF;

		// Key
		view[4] = key.length;
		for(var i = 0;i < key.length;i++) {
			view[i + 5] = key[i];
		}

		// Send packet
		if(m_ready) {
			m_websocket.send(buffer);
			return 0;
		}
		else {
			return 1;
		}
	}

	/**
	 * Gets the node for a given binary key
	 *
	 * get_parent determines if the immediate parent of the binary
	 * key will be retrieved instead
	 *
	 * Visibility: Private
	 */
	function node_traverse(binary_key, get_parent) {
		var node = m_root_node;
		for(var i = 0;i < binary_key.length - (!!get_parent ? 1 : 0);i++) {
			node = node.get_child_with_id(binary_key[i]);
			// Bail if the key is bad
			if(node == null) {
				return null;
			}
		}
		return node;
	}
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Constructs a node with a given name, parent key, and gambezi
 * If the parent key is null, the Node is constructed as the root node
 * Visibility: Public
 */
function Node(name, parent_key, parent_gambezi) {
	/**
	 * Constructor
	 */
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
	var m_ready = false;
	// End constructor

	/**
	 * Gets the ID of this node
	 * -1 indicates no ID assigned yet
	 *
	 * Visibility: Public
	 */
	this.get_id = function() {
		return m_key[m_key.length - 1];
	}

	/**
	 * Gets the name of this node
	 *
	 * Visibility: Public
	 */
	this.get_name = function() {
		return m_name;
	}

	/**
	 * Sets the binary key of this node
	 *
	 * Visibility: Package
	 */
	this.set_key = function(key) {
		m_key = key;
		m_ready = true;
		if(m_object.on_ready) {
			m_object.on_ready();
		}
	}

	/**
	 * Gets the binary key of this node
	 *
	 * Visibility: Public
	 */
	this.get_key = function() {
		return m_key;
	}

	/**
	 * Sets the data of this node
	 *
	 * Visibility: Package
	 */
	this.set_data = function(data) {
		m_data = data;
	}

	/**
	 * Gets the data of this node
	 *
	 * Visibility: Public
	 */
	this.get_data = function() {
		return m_data;
	}

	/**
	 * Returns if this node is ready to communicate
	 *
	 * Visibility: Public
	 */
	this.is_ready = function() {
		return m_ready;
	}

	/**
	 * This callback is called when this node is ready to communicate
	 *
	 * Visibility: Public
	 */
	this.on_ready = null;

	/**
	 * This callback is called when this node's value is updated by the server
	 *
	 * Visibility: Public
	 */
	this.on_data_recieved = null;

	/**
	 * Gets the child node with the specified name
	 * Creates a new child with the name if there is no existing child
	 *
	 * Visibility: Package
	 */
	this.get_child_with_name = function(name) {
		// See if child already exists
		for(var i = 0;i < m_children.length;i++) {
			if(m_children[i].get_name() == name) {
				return m_children[i];
			}
		}

		// Create child if nonexistent
		child = new Node(name, m_key, m_gambezi);
		m_children.push(child);
		return child;
	}

	/**
	 * Gets the child node with the specified ID
	 * Returns null if the id is not found
	 *
	 * Visibility: Package
	 */
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

	/**
	 * Sets the value of a node with a byte buffer
	 * 
	 * Visibility: Package
	 */
	this.set_data_raw = function(data, offset, length) {
		m_gambezi.set_data_raw(m_object.get_key(), data, offset, length);
	}

	/**
	 * Requests the value of a node
	 * 
	 * get_children determines if all descendent keys will
	 * be retrieved
	 * 
	 * Visibilty: Package
	 */
	this.request_data = function(get_children) {
		m_gambezi.request_data(m_object.get_key(), get_children);
	}

	/**
	 * Updates the subscription for a paticular key
	 *
	 * set_children determines if all descendent keys will
	 * be retrieved
	 *
	 * Values for refresh_skip
	 * 0x0000 - get node value updates as soon as they arrive
	 * 0xFFFF - unsubscribe from this key
	 * Any other value of refresh skip indicates that this node
	 * will be retrieved every n client updates
	 *
	 * Visibility: Package
	 */
	this.update_subscription = function(refresh_skip, set_children) {
		m_gambezi.update_subscription(m_object.get_key(), refresh_skip, set_children);
	}
}

////////////////////////////////////////////////////////////////////////////////
data = new ArrayBuffer(5)
dataView = new Uint8Array(data)
for(var i = 0;i < 5;i++) { dataView[i] = i; }

gambezi = new Gambezi("localhost:7709");
gambezi.on_ready = function() {
	gambezi.on_error = console.log;
	var node = gambezi.register_key(['speed test']);
	node.on_ready = function() {
		gambezi.set_refresh_rate(10);
		node.update_subscription(0);
		node.update_subscription(1);
		console.log("Running speed test");
		var count = 0;
		var limit = 1000;
		node.on_data_recieved = function(node) {
			count++;
			if(count < limit) {
				//node.request_data();
			}
			else {
				//console.log((window.performance.now() - time) / limit * 1000 + " micro seconds per read (round trip)");
			}
			if(count == limit) {
				console.log((window.performance.now() - time) / limit * 1000 + " micro seconds per read (round trip)");
			}
		}
		var time = window.performance.now();
		//node.request_data();
	};

	/*
	node = gambezi.register_key(['data transfer']);
	node.on_data_recieved = function(node) {
		console.log(new Uint8Array(node.get_data()));
	};
	*/
};
