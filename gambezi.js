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

	var m_send_queue = [];
	var m_key_request_queue = [];
	var m_root_node = new Node("", null, m_object);
	var m_ready = false;

	var m_websocket = new WebSocket("ws://" + host_address, "gambezi-protocol");
	m_websocket.binaryType = 'arraybuffer';
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
		// Notify of ready state
		m_ready = true;
		if(m_object.on_ready) {
			m_object.on_ready(event);
		}

		// Send queued packets
		while(m_send_queue.length > 0) {
			(m_send_queue.shift())();
		}

		// Get the next queued ID request
		process_key_request_queue();
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
				name = utf8to16(name);

				// Get the matching node and set the ID
				var node = node_traverse(binary_key, true);
				// No error
				if(node != null) {
					node = node.get_child_with_name(name);
					node.set_key(binary_key);

					// Get the next queued ID request
					process_key_request_queue();
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
				var node = node_traverse(binary_key, false);
				// No error
				if(node != null) {
					node.set_data(data_raw);

					// Callback if present
					if(node.on_data_recieved) {
						node.on_data_recieved(node);
					}
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
				message = utf8to16(message);
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
	 * get_children determines if all descendent keys will
	 * be retrieved
	 *
	 * Visibility: Package
	 */
	this.request_id = function(parent_key, name, get_children) {
		// This method is always guarded when called, so no need to check readiness
		name = utf16to8(name);

		// Create buffer
		var buffer_raw = new ArrayBuffer(parent_key.length + name.length + 4);
		var buffer = new Uint8Array(buffer_raw);

		// Header
		buffer[0] = 0x00;
		buffer[1] = get_children ? 1 : 0;

		// Parent key
		buffer[2] = parent_key.length;
		for(var i = 0;i < parent_key.length;i++) {
			buffer[i + 3] = parent_key[i];
		}

		// Name
		buffer[3 + parent_key.length] = name.length;
		for(var j = 0;j < name.length;j++) {
			buffer[j + 4 + parent_key.length] = name.charCodeAt(j);
		}

		// Send data
		m_websocket.send(buffer_raw);
	}

	/**
	 * Processes string key requests in the queue until one succeeds
	 * 
	 * Visibility: Private
	 */
	function process_key_request_queue() {
		// This method is always guarded when called, so no need to check readiness
		
		// Process entires until one succeeds without an error
		while(m_key_request_queue.length > 0) {
			var code = 0;

			// Build the binary parent key
			var string_key = m_key_request_queue.shift();
			var parent_binary_key = new Array(string_key.length - 1);
			var node = m_root_node;
			for(var i = 0;i < string_key.length - 1;i++) {
				node = node.get_child_with_name(string_key[i]);
				var id = node.get_id();
				// Bail if the parent does not have an ID
				if(id < 0) {
					code = 1;
					break;
				}
				parent_binary_key[i] = id;
			}

			// Error when building binary key
			if(code > 0) {
				if(m_object.on_error) {
					m_object.on_error("Error processing ID queue");
				}
			}
			// No error
			else {
				// Request the ID
				var name = string_key[string_key.length - 1];
				m_object.request_id(parent_binary_key, name, false);
				break;
			}
		}
	}

	/**
	 * Registers a string key and gets the corresponding node
	 * 
	 * Visibility: Public
	 */
	this.register_key = function(string_key) {
		// Queue up the ID requests and get the node
		var node = m_root_node;
		for(var i = 0;i < string_key.length;i++) {
			// Go down one level
			node = node.get_child_with_name(string_key[i]);

			// Queue up ID request if needed
			if(node.get_id() < 0) {
				m_key_request_queue.push(string_key.slice(0, i + 1));
			}
		}

		// Get any IDs necessary
		if(m_ready) {
			process_key_request_queue();
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
		if(m_ready) {
			// Create buffer
			var buffer = new ArrayBuffer(3);
			var view = new Uint8Array(buffer);

			// Header
			view[0] = 0x02;

			// Length
			view[1] = (refresh_rate >> 8) & 0xFF
			view[2] = (refresh_rate) & 0xFF

			// Send packet
			m_websocket.send(buffer);
			return 0;
		}
		else {
			m_send_queue.push(function() {
				m_object.set_refresh_rate(refresh_rate);
			});
			return 1;
		}
	}

	/**
	 * Sets the value of a node with a byte buffer
	 * 
	 * Visibility: Package
	 */
	this.set_data_raw = function(key, data, offset, length) {
		// This method is always guarded when called, so no need to check readiness

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

	/**
	 * Requests the value of a node
	 * 
	 * get_children determines if all descendent keys will
	 * be retrieved
	 * 
	 * Visibilty: Package
	 */
	this.request_data = function(key, get_children) {
		// This method is always guarded when called, so no need to check readiness

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
		// This method is always guarded when called, so no need to check readiness

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
		m_websocket.send(buffer);
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
		for(var i = 0;i < binary_key.length - (get_parent ? 1 : 0);i++) {
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
	var m_send_queue = [];
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
	 * Gets all children currently visible to this node
	 *
	 * Visibility: Public
	 */
	this.get_children = function() {
		return m_children;
	}

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
		// Notify ready
		m_key = key;
		m_ready = true;
		if(m_object.on_ready) {
			m_object.on_ready();
		}

		// Handle queued actions
		while(m_send_queue.length > 0) {
			(m_send_queue.shift())();
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
	 * Visibility: Public
	 */
	this.get_child_with_name = function(name) {
		// See if child already exists
		for(var child of m_children) {
			if(child.get_name() == name) {
				return child;
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
		for(var child of m_children) {
			if(child.get_id() == id) {
				return child;
			}
		}

		// None found
		return null;
	}

	/**
	 * Sets the value of a node with a byte buffer
	 * 
	 * Visibility: Public
	 */
	this.set_data_raw = function(data, offset, length) {
		if(m_ready) {
			m_gambezi.set_data_raw(m_key, data, offset, length);
			return 0;
		}
		else {
			m_send_queue.push(function() {
				m_object.set_data_raw(data, offset, length);
			});
			return 1;
		}
	}

	/**
	 * Requests the value of a node
	 * 
	 * get_children determines if all descendent keys will
	 * be retrieved
	 * 
	 * Visibilty: Public
	 */
	this.request_data = function(get_children) {
		if(m_ready) {
			m_gambezi.request_data(m_key, get_children);
			return 0;
		}
		else {
			m_send_queue.push(function() {
				m_object.request_data(get_children);
			});
			return 1;
		}
	}

	/**
	 * Updates the subscription for this node
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
	 * Visibility: Public
	 */
	this.update_subscription = function(refresh_skip, set_children) {
		if(m_ready) {
			m_gambezi.update_subscription(m_key, refresh_skip, set_children);
			return 0;
		}
		else {
			m_send_queue.push(function() {
				m_object.update_subscription(refresh_skip, set_children);
			});
			return 1;
		}
	}

	/**
	 * Retrieves all children of this node from the server
	 *
	 * Visibility: Public
	 */
	this.retrieve_children = function() {
		if(m_ready) {
			m_gambezi.request_id(m_key.slice(0, -1) , m_name, true);
			return 0;
		}
		else {
			m_send_queue.push(function() {
				m_object.retrieve_children();
			});
			return 1;
		}
	}

	/**
	 * Sets the value of the node as a 32 bit float
	 *
	 * Visibility: Public
	 */
	this.set_float = function(value) {
		var length = 4;
		var buffer = new ArrayBuffer(length);
		new DataView(buffer).setFloat32(0, value, false);
		return m_object.set_data_raw(buffer, 0, length);
	}

	/**
	 * Gets the value of this node as a 32 bit float
	 * Returns NaN as the default if the format does not match
	 *
	 * Visibility: Public
	 */
	this.get_float = function() {
		var length = 4;
		// Bail if the size is incorrect
		if(m_data.byteLength != length) {
			return NaN;
		}
		return new DataView(m_data).getFloat32(0, false);
	}

	/**
	 * Sets the value of the node as a boolean
	 *
	 * Visibility: Public
	 */
	this.set_boolean = function(value) {
		var length = 1;
		var buffer = new ArrayBuffer(length);
		new Uint8Array(buffer)[0] = value ? 0x01 : 0x00;
		return m_object.set_data_raw(buffer, 0, length);
	}

	/**
	 * Gets the value of this node as a boolean
	 * Returns false as the default if the format does not match
	 *
	 * Visibility: Public
	 */
	this.get_boolean = function() {
		var length = 1;
		// Bail if the size is incorrect
		if(m_data.byteLength != length) {
			return false;
		}
		return new Uint8Array(m_data)[0] != 0x00;
	}

	/**
	 * Sets the value of the node as a string
	 *
	 * Visibility: Public
	 */
	this.set_string = function(value) {
		value = utf16to8(value);

		var buffer = new ArrayBuffer(value.length);
		var byte_view = new Uint8Array(buffer);
		for(var i = 0;i < value.length;i++) {
			byte_view[i] = value.charCodeAt(i);
		}
		return m_object.set_data_raw(buffer, 0, value.length);
	}

	/**
	 * Gets the value of this node as a string
	 *
	 * Visibility: Public
	 */
	this.get_string = function() {
		var output = "";
		var buffer = new Uint8Array(m_data);
		for(var i = 0;i < m_data.byteLength;i++) {
			output += String.fromCharCode(buffer[i]);
		}
		output = utf8to16(output);
		return output;
	}
}

// Library included because javascript doesn't include UTF8 encoding things
// by default -_-
////////////////////////////////////////////////////////////////////////////////
/* utf.js - UTF-8 <=> UTF-16 convertion
 *
 * Copyright (C) 1999 Masanao Izumo <iz@onicos.co.jp>
 * Version: 1.0
 * LastModified: Dec 25 1999
 * This library is free.  You can redistribute it and/or modify it.
 */

function utf16to8(str) {
	var out, i, len, c;

	out = "";
	len = str.length;
	for(i = 0; i < len; i++) {
		c = str.charCodeAt(i);
		if ((c >= 0x0001) && (c <= 0x007F)) {
			out += str.charAt(i);
		} else if (c > 0x07FF) {
			out += String.fromCharCode(0xE0 | ((c >> 12) & 0x0F));
			out += String.fromCharCode(0x80 | ((c >>  6) & 0x3F));
			out += String.fromCharCode(0x80 | ((c >>  0) & 0x3F));
		} else {
			out += String.fromCharCode(0xC0 | ((c >>  6) & 0x1F));
			out += String.fromCharCode(0x80 | ((c >>  0) & 0x3F));
		}
	}
	return out;
}

function utf8to16(str) {
	var out, i, len, c;
	var char2, char3;

	out = "";
	len = str.length;
	i = 0;
	while(i < len) {
		c = str.charCodeAt(i++);
		switch(c >> 4) {
			case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
				// 0xxxxxxx
				out += str.charAt(i-1);
				break;
			case 12: case 13:
				// 110x xxxx   10xx xxxx
				char2 = str.charCodeAt(i++);
				out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
				break;
			case 14:
				// 1110 xxxx  10xx xxxx  10xx xxxx
				char2 = str.charCodeAt(i++);
				char3 = str.charCodeAt(i++);
				out += String.fromCharCode(((c & 0x0F) << 12) |
							   ((char2 & 0x3F) << 6) |
							   ((char3 & 0x3F) << 0));
				break;
		}
	}
	return out;
}
