////////////////////////////////////////////////////////////////////////////////
/**
 * Represents a connection to a gambezi server
 */

/**
 * Constructs a gambezi instance with the given target host
 */
function Gambezi(host_address, reconnect=false, reconnect_interval=5) {
	// Callbacks
	this.on_ready = null;
	this.on_error = null;
	this.on_close = null;

	// Variables
	this.__key_request_queue = null;
	this.__root_node         = null;
	this.__refresh_rate      = 0;
	this.__host_address      = null;
	this.__ready             = false;
	this.__websocket         = null;

	// Init
	this.__root_node = new Node("", null, this);
	this.__refresh_rate = 100;
	this.__host_address = host_address;

	this.open_connection();

	if(reconnect) {
		setInterval(function() {
			this.open_connection();
		}.bind(this), reconnect_interval * 1000);
	}
}

/**
 * Connects this gambezi instance to the server
 */
Gambezi.prototype.open_connection = function() {
	// Bail if the connection is still open
	if(this.__ready) {
		return 1;
	}

	// Clear queue
	this.__key_request_queue = [];

	// Set flags
	this.__ready = false;

	// Mark all nodes as not ready to communicate
	this.__unready_nodes(this.__root_node);

	// Websocket init
	this.__websocket = new WebSocket("ws://" + this.__host_address, "gambezi-protocol");
	this.__websocket.binaryType = 'arraybuffer';
	this.__websocket.onmessage = this.__on_message.bind(this);
	this.__websocket.onerror = this.__on_error.bind(this);
	this.__websocket.onopen = this.__on_open.bind(this);
	this.__websocket.onclose = this.__on_close.bind(this);

	// Success
	return 0;
}

/**
 * Callback when there is a websocket error 
 */
Gambezi.prototype.__on_error = function(event) {
	if(this.on_error != null) {
		this.on_error(event);
	}
}

/**
 * Callback when the websocket gets initialized
 */
Gambezi.prototype.__on_open = function(event) {
	// Set is ready state
	this.__ready = true;

	// Set refresh rate
	this.set_refresh_rate(this.__refresh_rate);

	// Queue all IDs for all ndoes
	this.__queue_id_requests(this.__root_node, null);

	// Get the next queued ID request
	this.__process_key_request_queue();

	// Set root node
	this.__root_node._set_ready(true);

	// Notify of ready state
	if(this.on_ready != null) {
		this.on_ready(event);
	}
}

/**
 * Recursive method to fetch all IDs for all nodes
 */
Gambezi.prototype.__queue_id_requests = function(node, parent_string_key) {
	// Normal node
	if(parent_string_key != null) {
		var string_key = Array.from(parent_string_key);
		string_key.push(node.get_name());
		this.__key_request_queue.push(string_key);
	}
	// Root node
	else {
		var string_key = [];
	}

	// Process children
	for(let child of node.get_children()) {
		this.__queue_id_requests(child, string_key);
	}
}

/**
 * Recursive method to set all child nodes to not ready
 */
Gambezi.prototype.__unready_nodes = function(node) {
	// Set node state
	node._set_ready(false);

	// Process children
	for(let child of node.get_children()) {
		this.__unready_nodes(child);
	}
}

/**
 * Callback when the websocket closes
 */
Gambezi.prototype.__on_close = function(event) {
	this.__ready = false;

	// Mark all nodes as not ready to communicate
	this.__unready_nodes(this.__root_node);

	// Notify of closed state
	if(this.on_close != null) {
		this.on_close(event);
	}
}

/**
 * Callback when the client recieves a packet from the server
 */
Gambezi.prototype.__on_message = function(event) {
	var buf = new Uint8Array(event.data);

	////////////////////////////////////////
	// ID response from server
	if(buf[0] == 0) {
		// Extract binary key
		var binary_key = new Array(buf[1]);
		for(var i = 0;i < binary_key.length;i++) {
			binary_key[i] = buf[i + 2];
		}

		// Extract name
		var name = "";
		for(var i = 0;i < buf[binary_key.length + 2];i++) {
			name += String.fromCharCode(buf[binary_key.length + 3 + i]);
		}
		name = utf8to16(name);

		// Bail if the root node got requested
		if(binary_key.length == 0) {
			// Get the next queued ID request
			this.__process_key_request_queue();
			return;
		}

		// Get the matching node and set the ID
		var node = this.__node_traverse(binary_key, true);
		// No error
		if(node != null) {
			node = node.get_child_with_name(name, true);
			node._set_key(binary_key);

			// Get the next queued ID request
			this.__process_key_request_queue();
		}
	}

	////////////////////////////////////////
	// Value update from server
	else if(buf[0] == 1) {
		// Extract binary key
		var binary_key = new Array(buf[1]);
		for(var i = 0;i < binary_key.length;i++) {
			binary_key[i] = buf[i + 2];
		}

		// Extract data
		var data_length = (buf[binary_key.length + 2] << 8) | (buf[binary_key.length + 3]);
		var data_raw = new ArrayBuffer(data_length);
		var data = new Uint8Array(data_raw);
		for(var i = 0;i < data_length;i++) {
			data[i] = buf[binary_key.length + 4 + i];
		}

		// Get the matching node and set the data
		var node = this.__node_traverse(binary_key, false);
		// No error
		if(node != null) {
			node._set_data(data_raw);

			// Callback if present
			if(node.on_update != null) {
				node.on_update(node);
			}
		}
	}

	////////////////////////////////////////
	// Error message from server
	else if(buf[0] == 2) {
		// Extract message
		var message = "";
		for(var i = 0;i < buf[1];i++) {
			message += String.fromCharCode(buf[2 + i]);
		}
		message = utf8to16(message);
		// Use the message
		if(this.on_error != null) {
			this.on_error(message);
		}
	}
}

/**
 * Returns whether this gambezi instance is ready to communicate
 */
Gambezi.prototype.is_ready = function() {
	return this.__ready;
}

/**
 * Closes this gambezi connection
 */
Gambezi.prototype.close_connection = function() {
	if(this.__websocket != null) {
		this.__websocket.close();
	}
}

/**
 * Requests the ID of a node for a given parent key and name
 *
 * get_children determines if all descendent keys will
 * be retrieved
 *
 * get_children_all determines if all descendent keys will be
 * retrieved recursively
 */
Gambezi.prototype._request_id = function(parent_key, name, get_children=false, get_children_all=false) {
	// This method is always guarded when called, so no need to check readiness
	name_bytes = utf16to8(name);

	// Create buffer
	var buf_raw = new ArrayBuffer(parent_key.length + name_bytes.length + 4);
	var buf = new Uint8Array(buf_raw);

	// Header
	buf[0] = 0x00;
	buf[1] = (get_children_all ? 2 : 0) | (get_children ? 1 : 0);

	// Parent key
	buf[2] = parent_key.length;
	for(var i = 0;i < parent_key.length;i++) {
		buf[i + 3] = parent_key[i];
	}

	// Name
	buf[3 + parent_key.length] = name_bytes.length;
	for(var i = 0;i < name_bytes.length;i++) {
		buf[i + 4 + parent_key.length] = name_bytes.charCodeAt(i);
	}

	// Send data
	this.__websocket.send(buf_raw);
}

/**
 * Processes string key requests in the queue until one succeeds
 */
Gambezi.prototype.__process_key_request_queue = function() {
	// This method is always guarded when called, so no need to check readiness
	
	// Process entires until one succeeds without an error
	while(this.__key_request_queue.length > 0) {
		var code = 0;

		// Build the binary parent key
		var string_key = this.__key_request_queue.shift();
		var parent_binary_key = new Array(string_key.length - 1);
		var node = this.__root_node;
		for(var i = 0;i < string_key.length - 1;i++) {
			node = node.get_child_with_name(string_key[i], true);
			var ident = node.get_id();
			// Bail if the parent does not have an ID
			if(ident < 0) {
				code = 1;
				break;
			}
			parent_binary_key[i] = ident;
		}

		// Error when building binary key
		if(code > 0) {
			if(this.on_error != null) {
				this.on_error("Error processing ID queue");
			}
		}
		// No error
		else {
			// Request the ID
			var name = string_key[string_key.length - 1];
			this._request_id(parent_binary_key, name, false, false);
			break;
		}
	}
}

/**
 * Registers a string key and gets the corresponding node
 */
Gambezi.prototype.register_key = function(string_key) {
	// Queue up the ID requests and get the node
	var node = this.__root_node;
	for(var i = 0;i < string_key.length;i++) {
		// Go down one level
		node = node.get_child_with_name(string_key[i], true);

		// Queue up ID request if needed and already connected
		if(this.__ready) {
			if(node.get_id() < 0) {
				this.__key_request_queue.push(string_key.slice(0, i+1));
			}
		}
	}

	// Get any IDs necessary if already connected
	if(this.__ready) {
		this.__process_key_request_queue();
	}

	// Return
	return node;
}

/**
 * Sets the refresh rate of this client in milliseconds
 */
Gambezi.prototype.set_refresh_rate = function(refresh_rate) {
	// Save for later usage
	this.__refresh_rate = refresh_rate;

	if(this.__ready) {
		// Create buffer
		var buf_raw = new ArrayBuffer(3);
		var buf = new Uint8Array(buf_raw);

		// Header
		buf[0] = 0x02;

		// Length
		buf[1] = (refresh_rate >> 8) & 0xFF;
		buf[2] = (refresh_rate) & 0xFF;

		// Send packet
		this.__websocket.send(buf_raw);
		return 0;
	}
	else {
		return 1;
	}
}

/**
 * Gets the refresh rate of this client in milliseconds
 */
Gambezi.prototype.get_refresh_rate = function() {
	return this.__refresh_rate;
}

/**
 * Sets the value of a node with a byte buffer
 */
Gambezi.prototype._set_data_raw = function(key, data_raw, offset, length) {
	// This method is always guarded when called, so no need to check readiness

	// Create buffer
	var buf_raw = new ArrayBuffer(key.length + length + 4);
	var buf = new Uint8Array(buf_raw);
	var data = new Uint8Array(data_raw);

	// Header
	buf[0] = 0x01;

	// Key
	buf[1] = key.length;
	for(var i = 0;i < key.length;i++) {
		buf[i + 2] = key[i];
	}

	// Length
	buf[2 + key.length] = (length >> 8) & 0xFF;
	buf[3 + key.length] = (length) & 0xFF;

	// Value
	for(var i = 0;i < length;i++) {
		buf[i + 4 + key.length] = data[i + offset];
	}

	// Send packet
	this.__websocket.send(buf_raw);
}

/**
 * Requests the value of a node
 * 
 * get_children determines if all descendent keys will
 * be retrieved
 */
Gambezi.prototype._request_data = function(key, get_children=false) {
	// This method is always guarded when called, so no need to check readiness

	// Create buffer
	var buf_raw = new ArrayBuffer(key.length + 3);
	var buf = new Uint8Array(buf_raw);

	// Header
	buf[0] = 0x04;
	buf[1] = get_children ? 1 : 0;

	// Key
	buf[2] = key.length;
	for(var i = 0;i < key.length;i++) {
		buf[i + 3] = key[i];
	}

	// Send packet
	this.__websocket.send(buf_raw);
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
 */
Gambezi.prototype._update_subscription = function(key, refresh_skip, set_children=false) {
	// This method is always guarded when called, so no need to check readiness

	// Create buffer
	var buf_raw = new ArrayBuffer(key.length + 5);
	var buf = new Uint8Array(buf_raw);

	// Header
	buf[0] = 0x03;
	buf[1] = set_children ? 1 : 0;
	buf[2] = (refresh_skip >> 8) & 0xFF;
	buf[3] = (refresh_skip) & 0xFF;

	// Key
	buf[4] = key.length;
	for(var i = 0;i < key.length;i++) {
		buf[i + 5] = key[i];
	}

	// Send packet
	this.__websocket.send(buf_raw);
}

/**
 * Gets the node for a given binary key
 *
 * get_parent determines if the immediate parent of the binary
 * key will be retrieved instead
 */
Gambezi.prototype.__node_traverse = function(binary_key, get_parent=false) {
	var node = this.__root_node;
	for(var i = 0;i < binary_key.length - (get_parent ? 1 : 0);i++) {
		node = node._get_child_with_id(binary_key[i]);
		// Bail if the key is bad
		if(node == null) {
			return null;
		}
	}
	return node;
}

////////////////////////////////////////////////////////////////////////////////
/**
 * Represents a node in the Gambezi Tree
 */

/**
 * Constructs a node with a given name, parent key, and gambezi
 * If the parent key is null, the Node is constructed as the root node
 */
function Node(name, parent_key, parent_gambezi) {
	// Callbacks
	this.on_ready = null;
	this.on_update = null;

	// Variables
	this.__name = null;
	this.__gambezi = null;
	this.__children = null;
	this.__send_queue = null;
	this.__refresh_skip = 0xFFFF;
	this.__data = null;
	this.__key = null;
	this.__ready = false;

	// Flags
	this.__ready = false;

	this.__name = name;
	this.__gambezi = parent_gambezi;

	this.__children = [];
	this.__send_queue = [];

	this.__refresh_skip = 0xFFFF;
	this.__data = new ArrayBuffer(0);

	// Init key
	this.__key = [];
	if(parent_key != null) {
		this.__key = Array.from(parent_key);
		this.__key.push(-1);
	}
}
	
/**
 * Gets all children currently visible to this node
 */
Node.prototype.get_children = function() {
	return this.__children;
}

/**
 * Gets the ID of this node
 * (-1) indicates no ID assigned yet
 */
Node.prototype.get_id = function() {
	return this.__key[this.__key.length - 1];
}

/**
 * Gets the name of this node
 */
Node.prototype.get_name = function() {
	return this.__name;
}

/**
 * Sets the binary key of this node
 */
Node.prototype._set_key = function(key) {
	// Notify ready
	this.__key = key;
	this._set_ready(true);

	// Handle queued actions
	while(this.__send_queue.length > 0) {
		(this.__send_queue.shift())();
	}
}

/**
 * Gets the binary key of this node
 */
Node.prototype.get_key = function() {
	return this.__key;
}

/**
 * Sets the data of this node
 */
Node.prototype._set_data = function(data) {
	this.__data = data;
}

/**
 * Gets the data of this node
 */
Node.prototype.get_data = function() {
	return this.__data;
}

/**
 * Sets the ready state of this node
 */
Node.prototype._set_ready = function(ready) {
	// Save state
	this.__ready = ready;

	// Notify ready
	if(ready) {
		// Set refresh skip
		this.update_subscription(this.__refresh_skip);

		if(this.on_ready != null) {
			this.on_ready();
		}
	}
}

/**
 * Returns if this node is ready to communicate
 */
Node.prototype.is_ready = function() {
	return this.__ready;
}

/**
 * Gets the child node with the specified name
 * Creates a new child with the name if there is no existing child
 */
Node.prototype.get_child_with_name = function(name, create=false) {
	// See if child already exists
	for(var child of this.__children) {
		if(child.get_name() == name) {
			return child;
		}
	}
	
	// Bail if requested not to create
	if(!create) {
		return null;
	}

	// Create child if nonexistent
	child = new Node(name, this.__key, this.__gambezi);
	this.__children.push(child);
	return child;
}

/**
 * Gets the child node with the specified ID
 * Returns null if the id is not found
 */
Node.prototype._get_child_with_id = function(ident) {
	// See if child already exists
	for(var child of this.__children) {
		if(child.get_id() == ident) {
			return child;
		}
	}

	// None found
	return null;
}

/**
 * Sets the value of a node with a byte buffer
 */
Node.prototype.set_data_raw = function(data, offset, length) {
	if(this.__ready) {
		this.__gambezi._set_data_raw(this.__key, data, offset, length);
		return 0;
	}
	else {
		this.__send_queue.push(function() {
			this.set_data_raw(data, offset, length);
		}.bind(this));
		return 1;
	}
}

/**
 * Requests the value of a node
 * 
 * get_children determines if all descendent keys will
 * be retrieved
 */
Node.prototype.request_data = function(get_children=false) {
	if(this.__ready) {
		this.__gambezi._request_data(this.__key, get_children);
		return 0;
	}
	else {
		this.__send_queue.push(function() {
			this.request_data(get_children);
		}.bind(this));
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
 */
Node.prototype.update_subscription = function(refresh_skip, set_children=false) {
	// Save for later usage
	this.__refresh_skip = refresh_skip;

	if(this.__ready) {
		this.__gambezi._update_subscription(this.__key, refresh_skip, set_children);
		return 0;
	}
	else {
		return 1;
	}
}

/**
 * Retrieves all immediate children of this node from the server
 */
Node.prototype.retrieve_children = function() {
	if(this.__ready) {
		this.__gambezi._request_id(this.__key , "", true, false);
		return 0;
	}
	else {
		this.__send_queue.push(function() {
			this.retrieve_children();
		}.bind(this));
		return 1;
	}
}

/**
 * Retrieves all children of this node recursively from the server
 */
Node.prototype.retrieve_children_all = function() {
	if(this.__ready) {
		this.__gambezi._request_id(this.__key , "", true, true);
		return 0;
	}
	else {
		this.__send_queue.push(function() {
			this.retrieve_children_all();
		}.bind(this));
		return 1;
	}
}

/**
 * Sets the value of the node as a 32 bit float
 */
Node.prototype.set_float = function(value) {
	var length = 4;
	var buffer = new ArrayBuffer(length);
	new DataView(buffer).setFloat32(0, value, false);
	return this.set_data_raw(buffer, 0, length);
}

/**
 * Gets the value of this node as a 32 bit float
 * Returns NaN as the default if the format does not match
 */
Node.prototype.get_float = function() {
	var length = 4;
	// Bail if the size is incorrect
	if(this.__data.byteLength != length) {
		return NaN;
	}
	return new DataView(this.__data).getFloat32(0, false);
}

/**
 * Sets the value of the node as a boolean
 */
Node.prototype.set_boolean = function(value) {
	var length = 1;
	var buffer = new ArrayBuffer(length);
	new Uint8Array(buffer)[0] = value ? 0x01 : 0x00;
	return this.set_data_raw(buffer, 0, length);
}

/**
 * Gets the value of this node as a boolean
 * Returns false as the default if the format does not match
 */
Node.prototype.get_boolean = function() {
	var length = 1;
	// Bail if the size is incorrect
	if(this.__data.byteLength != length) {
		return false;
	}
	return new Uint8Array(this.__data)[0] != 0x00;
}

/**
 * Sets the value of the node as a string
 */
Node.prototype.set_string = function(value) {
	value = utf16to8(value);

	var buffer = new ArrayBuffer(value.length);
	var byte_view = new Uint8Array(buffer);
	for(var i = 0;i < value.length;i++) {
		byte_view[i] = value.charCodeAt(i);
	}
	return this.set_data_raw(buffer, 0, value.length);
}

/**
 * Gets the value of this node as a string
 */
Node.prototype.get_string = function() {
	var output = "";
	var buffer = new Uint8Array(this.__data);
	for(var i = 0;i < this.__data.byteLength;i++) {
		output += String.fromCharCode(buffer[i]);
	}
	output = utf8to16(output);
	return output;
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
