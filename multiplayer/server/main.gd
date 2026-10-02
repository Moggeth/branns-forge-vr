extends Node
## Independent multiplayer proof. No native project resources or save paths.
const MAX_PLAYERS = 32
const MAX_ROOMS = 8
const MAX_CONNECTIONS = 280
const BOUND = 55.0
const COSTS = {"skeleton": 15.0, "raise": 12.0, "grove": 10.0, "starfall": 25.0}
var listener = TCPServer.new()
var crypto = Crypto.new()
var connections: Dictionary = {}
var rooms: Dictionary = {}
var next_connection = 0
var tick = 0
var data_dir = ""
var log_file: FileAccess
var started = Time.get_ticks_msec()

func _ready():
	data_dir = OS.get_environment("WORLD_DATA_DIR")
	if data_dir.is_empty(): data_dir = ProjectSettings.globalize_path("user://worlds")
	DirAccess.make_dir_recursive_absolute(data_dir)
	log_file = FileAccess.open(data_dir.path_join("server.jsonl"), FileAccess.READ_WRITE)
	if log_file == null: log_file = FileAccess.open(data_dir.path_join("server.jsonl"), FileAccess.WRITE)
	if log_file: log_file.seek_end()
	_load_worlds()
	var port = 8081
	if not OS.get_environment("PORT").is_empty(): port = int(OS.get_environment("PORT"))
	var bind_address = OS.get_environment("BIND_ADDRESS")
	if bind_address.is_empty(): bind_address = "127.0.0.1"
	var result = listener.listen(port, bind_address)
	if result != OK:
		_log("listen_failed", {"port": port, "error": result})
		get_tree().quit(1)
		return
	_log("started", {"port": port, "maxRooms": MAX_ROOMS, "maxPlayers": MAX_PLAYERS, "tickHz": 30, "snapshotHz": 10})

func _log(kind: String, metadata: Dictionary = {}):
	var entry = {"event": kind, "at": Time.get_datetime_string_from_system(true), "uptimeMs": Time.get_ticks_msec() - started}
	entry.merge(metadata)
	var line = JSON.stringify(entry)
	print(line)
	if log_file:
		log_file.store_line(line)
		log_file.flush()

func _process(_delta):
	while listener.is_connection_available():
		var stream = listener.take_connection()
		if connections.size() >= MAX_CONNECTIONS:
			stream.disconnect_from_host()
			continue
		var peer = WebSocketPeer.new()
		peer.inbound_buffer_size = 16384
		peer.outbound_buffer_size = 524288
		peer.max_queued_packets = 64
		peer.accept_stream(stream)
		next_connection += 1
		connections[next_connection] = {"peer": peer, "room": "", "player": "", "created": _now(), "budget": 80.0, "rateAt": _now(), "errors": 0}
	for cid in connections.keys():
		var c = connections[cid]
		var peer = c.peer
		peer.poll()
		if peer.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			_disconnect(cid)
			continue
		if c.room == "" and _now() - c.created > 10.0:
			peer.close(1008, "Join timeout")
			continue
		if peer.get_ready_state() != WebSocketPeer.STATE_OPEN: continue
		var packets = 0
		while peer.get_available_packet_count() > 0 and packets < 64:
			packets += 1
			var packet = peer.get_packet()
			if packet.size() > 8192 or not peer.was_string_packet():
				peer.close(1009, "Text messages up to 8192 bytes only")
				break
			c.budget = minf(80.0, c.budget + (_now() - c.rateAt) * 40.0)
			c.rateAt = _now()
			c.budget -= 1.0
			if c.budget < 0:
				peer.close(1008, "Message rate exceeded")
				break
			var message = JSON.parse_string(packet.get_string_from_utf8())
			if not message is Dictionary:
				_error(c, "invalid_message", "Expected a JSON object.")
				continue
			_message(cid, c, message)

func _now() -> float: return Time.get_ticks_msec() / 1000.0
func _random(bytes_count: int) -> String: return crypto.generate_random_bytes(bytes_count).hex_encode()
func _send(c, message):
	if c.peer.get_ready_state() != WebSocketPeer.STATE_OPEN: return
	if c.peer.get_current_outbound_buffered_amount() > 262144:
		c.peer.close(1008, "Slow consumer")
		return
	c.peer.send_text(JSON.stringify(message))
func _error(c, code: String, message: String):
	c.errors += 1
	_send(c, {"type": "error", "code": code, "message": message})
	if c.errors > 100: c.peer.close(1008, "Too many invalid messages")

func _message(cid, c, m):
	var kind = m.get("type", "")
	if kind == "ping":
		var at = m.get("at", 0)
		if not _number(at): at = 0
		_send(c, {"type": "pong", "at": at})
		return
	if kind == "create" or kind == "join":
		_join(cid, c, m)
		return
	if c.room == "" or not rooms.has(c.room):
		_error(c, "not_joined", "Join a room first.")
		return
	var room = rooms[c.room]
	if not room.players.has(c.player): return
	var p = room.players[c.player]
	if p.connection != cid: return
	if kind == "role":
		var role = m.get("role", "")
		if role != "hero" and role != "god":
			_error(c, "invalid_role", "Choose hero or god.")
		elif _now() - p.roleAt < 2.0:
			_error(c, "cooldown", "Wait before changing role.")
		else:
			var was_hero = p.role == "hero"
			p.role = role
			p.roleAt = _now()
			p.move = Vector2.ZERO
			if role == "hero" and not was_hero:
				p.position = _spawn_position(room, p.id)
				p.vy = 0.0
		return
	if kind not in ["input", "action", "cast"]:
		_error(c, "unknown_message", "Unknown message type.")
		return
	var seq = m.get("seq", null)
	if not _number(seq) or seq < 1 or seq > 9007199254740991.0 or seq != floor(seq):
		_error(c, "invalid_sequence", "Sequence must be a positive safe integer.")
		return
	if seq <= p.seq:
		_error(c, "duplicate_sequence", "Sequence already consumed.")
		return
	p.seq = seq
	if kind == "input": _apply_input(c, p, m)
	elif kind == "action": _strike(c, room, p, m)
	elif kind == "cast": _cast(c, room, p, m)

func _join(cid, c, m):
	if c.room != "":
		_error(c, "already_joined", "This socket already joined a room.")
		return
	var role = m.get("role", "hero")
	if role not in ["hero", "god"]:
		_error(c, "invalid_role", "Choose hero or god.")
		return
	var code = m.get("room", "")
	if m.type == "create":
		if rooms.size() >= MAX_ROOMS:
			_error(c, "server_full", "All rooms are in use. Try again later.")
			return
		code = _random(8)
		rooms[code] = _new_room(code)
		_save_worlds()
	if not code is String or not rooms.has(code):
		_error(c, "room_not_found", "This room does not exist or has expired.")
		return
	var room = rooms[code]
	var token = m.get("token", "")
	var p = null
	if token != "":
		if not token is String or token.length() != 64:
			_error(c, "invalid_token", "Reconnect token is invalid or expired.")
			return
		for candidate in room.players.values():
			if candidate.token == token: p = candidate
		if p == null:
			_error(c, "invalid_token", "Reconnect token is invalid or expired.")
			return
		if connections.has(p.connection): connections[p.connection].peer.close(4001, "session_replaced")
	else:
		if room.players.size() >= MAX_PLAYERS:
			_error(c, "room_full", "This room is full.")
			return
		var display_name = m.get("name", "Guest")
		if not display_name is String: display_name = "Guest"
		display_name = display_name.strip_edges().substr(0, 24).replace("\n", " ").replace("\r", " ")
		if display_name.is_empty(): display_name = "Guest"
		var spawn = _spawn_position(room) if role == "hero" else Vector3(0, _height(room, 0, 8), 8)
		p = {"id": _random(8), "token": _random(32), "name": display_name, "role": role, "position": spawn, "yaw": 0.0, "hp": 100.0, "mana": 100.0, "move": Vector2.ZERO, "vy": 0.0, "inputAt": -100.0, "attackAt": -100.0, "castAt": -100.0, "roleAt": -100.0, "seq": 0, "connection": cid, "disconnected": 0.0}
		room.players[p.id] = p
	p.connection = cid
	p.disconnected = 0.0
	p.move = Vector2.ZERO
	c.room = code
	c.player = p.id
	room.idleAt = _now()
	_send(c, {"type": "welcome", "protocol": 1, "room": code, "playerId": p.id, "token": p.token, "nextSeq": p.seq + 1, "snapshot": _snapshot(room)})
	_event(room, "join", p.position, p.id)
	_log("joined", {"players": room.players.size(), "rooms": rooms.size()})

func _new_room(code):
	return {"code": code, "players": {}, "enemies": {}, "edits": [], "groves": [], "idleAt": _now()}

func _spawn_position(room, ignored_id: String = "") -> Vector3:
	# Bounded golden-angle candidates spread arrivals around the authored clearing.
	# First guest retains the original [0,height,8] spawn when it is unoccupied.
	var best = Vector2(0, 8)
	var best_clearance = -1.0
	for i in range(128):
		var angle = i * 2.3999632297
		var candidate = Vector2(cos(angle), sin(angle)) * (2.8 * sqrt(float(i))) + Vector2(0, 8)
		var clearance = 10000.0
		for p in room.players.values():
			if p.role == "god" or p.id == ignored_id: continue
			clearance = minf(clearance, candidate.distance_to(Vector2(p.position.x, p.position.z)))
		for e in room.enemies.values():
			clearance = minf(clearance, candidate.distance_to(Vector2(e.position.x, e.position.z)))
		if clearance > best_clearance:
			best = candidate
			best_clearance = clearance
		if clearance >= 2.5: break
	return Vector3(best.x, _height(room, best.x, best.y), best.y)

func _disconnect(cid):
	var c = connections[cid]
	if rooms.has(c.room) and rooms[c.room].players.has(c.player):
		var p = rooms[c.room].players[c.player]
		if p.connection == cid:
			p.connection = -1
			p.disconnected = _now()
			p.move = Vector2.ZERO
			_event(rooms[c.room], "leave", p.position, p.id)
	connections.erase(cid)

func _number(n) -> bool: return (n is float or n is int) and is_finite(float(n))
func _vector(a, limit: float):
	if not a is Array or a.size() != 3: return null
	for n in a:
		if not _number(n) or absf(n) > limit: return null
	return Vector3(a[0], a[1], a[2])
func _pose(value):
	if not value is Dictionary: return null
	var pos = _vector(value.get("position"), 2.5)
	var q = value.get("quaternion")
	if pos == null or pos.length() > 2.5 or not q is Array or q.size() != 4: return null
	for n in q:
		if not _number(n) or absf(n) > 1.01: return null
	var quat = Quaternion(q[0], q[1], q[2], q[3])
	if quat.length_squared() < 0.5 or quat.length_squared() > 1.5: return null
	quat = quat.normalized()
	return {"position": _array(pos), "quaternion": [quat.x, quat.y, quat.z, quat.w]}

func _apply_input(c, p, m):
	var move = m.get("move", {})
	var yaw = m.get("yaw", 0)
	if not move is Dictionary or not _number(move.get("x")) or not _number(move.get("z")) or not _number(yaw) or absf(yaw) > 100000:
		_error(c, "invalid_input", "Movement and yaw must be finite numbers.")
		return
	p.move = Vector2(clampf(move.x, -1, 1), clampf(move.z, -1, 1)).limit_length(1.0)
	p.yaw = wrapf(yaw, -PI, PI)
	p.inputAt = _now()
	if m.get("jump", false) == true and p.role == "hero" and p.vy == 0.0: p.vy = 5.5
	if m.has("head"):
		var pose = _pose(m.head)
		if pose != null: p.head = pose
	if m.has("hands") and m.hands is Array and m.hands.size() <= 2:
		var hands = []
		for h in m.hands:
			var pose = _pose(h)
			if pose != null: hands.append(pose)
		p.hands = hands

func _strike(c, room, p, m):
	if m.get("action") != "strike" or p.role != "hero":
		_error(c, "invalid_action", "Only heroes can strike.")
		return
	if _now() - p.attackAt < 0.45:
		_error(c, "cooldown", "Strike is cooling down.")
		return
	p.attackAt = _now()
	var forward = Vector3(-sin(p.yaw), 0, -cos(p.yaw))
	var selected = null
	var distance = 2.8
	for enemy in room.enemies.values():
		var offset = enemy.position - p.position
		var length = offset.length()
		if length <= distance and (length < 0.5 or forward.dot(offset.normalized()) >= 0.45):
			selected = enemy
			distance = length
	if selected != null: _damage_enemy(room, selected, 34.0)

func _cast(c, room, p, m):
	if p.role != "god":
		_error(c, "role_required", "Switch to god to cast spells.")
		return
	var spell = m.get("spell", "")
	# Client Y is discarded; tall accumulated terrain must remain targetable.
	var point = _vector(m.get("point"), 1000.0)
	if not spell is String or not COSTS.has(spell) or point == null or absf(point.x) > BOUND or absf(point.z) > BOUND:
		_error(c, "invalid_cast", "Choose a spell and a point inside the world.")
		return
	if _now() - p.castAt < 0.75:
		_error(c, "cooldown", "Spell is cooling down.")
		return
	if p.mana < COSTS[spell]:
		_error(c, "insufficient_mana", "Not enough mana.")
		return
	if (spell == "skeleton" and room.enemies.size() >= 64) or (spell == "grove" and room.groves.size() >= 64) or (spell in ["raise", "starfall"] and room.edits.size() >= 64):
		_error(c, "world_limit", "This room reached the limit for that spell.")
		return
	p.mana -= COSTS[spell]
	p.castAt = _now()
	var id = _random(8)
	point.y = _height(room, point.x, point.z)
	if spell == "skeleton":
		room.enemies[id] = {"id": id, "position": point, "yaw": 0.0, "hp": 100.0, "attackAt": -100.0}
	elif spell == "grove": room.groves.append({"id": id, "x": point.x, "z": point.z})
	else:
		room.edits.append({"id": id, "kind": spell, "x": point.x, "z": point.z, "radius": 6.0 if spell == "raise" else 5.0, "height": 2.0 if spell == "raise" else -1.0})
		if spell == "starfall":
			for enemy in room.enemies.values():
				if enemy.position.distance_to(point) <= 6.0: _damage_enemy(room, enemy, 90.0)
		for actor in room.players.values() + room.enemies.values():
			actor.position.y = maxf(actor.position.y, _height(room, actor.position.x, actor.position.z))
	if spell != "skeleton": _save_worlds()
	_event(room, "cast", point, id)

func _damage_enemy(room, enemy, amount):
	enemy.hp -= amount
	_event(room, "hit", enemy.position, enemy.id)
	if enemy.hp <= 0:
		_event(room, "death", enemy.position, enemy.id)
		room.enemies.erase(enemy.id)

func _physics_process(delta):
	tick += 1
	if tick % 1800 == 0:
		_log("health", {"rooms": rooms.size(), "connections": connections.size(), "tick": tick})
	for code in rooms.keys():
		var room = rooms[code]
		var connected = false
		for id in room.players.keys():
			var p = room.players[id]
			if p.connection == -1:
				if _now() - p.disconnected > 60.0: room.players.erase(id)
				continue
			connected = true
			p.mana = minf(100.0, p.mana + delta * 3.0)
			if _now() - p.inputAt > 0.3: p.move = Vector2.ZERO
			p.position.x = clampf(p.position.x + p.move.x * 5.0 * delta, -BOUND, BOUND)
			p.position.z = clampf(p.position.z + p.move.y * 5.0 * delta, -BOUND, BOUND)
			var floor_y = _height(room, p.position.x, p.position.z)
			p.vy -= 15.0 * delta
			p.position.y += p.vy * delta
			if p.position.y <= floor_y:
				p.position.y = floor_y
				p.vy = 0.0
		if connected:
			room.idleAt = _now()
			_simulate_enemies(room, delta)
		elif _now() - room.idleAt > 1800.0:
			rooms.erase(code)
			_save_worlds()
			_log("room_expired", {"rooms": rooms.size()})
			continue
		if tick % 3 == 0 and connected: _broadcast(room, {"type": "state", "snapshot": _snapshot(room)})

func _simulate_enemies(room, delta):
	for enemy in room.enemies.values():
		var target = null
		var nearest = 100000.0
		for p in room.players.values():
			if p.role != "hero" or p.connection == -1: continue
			var distance = enemy.position.distance_to(p.position)
			if distance < nearest:
				target = p
				nearest = distance
		if target == null: continue
		var direction = target.position - enemy.position
		direction.y = 0.0
		direction = direction.normalized()
		enemy.yaw = atan2(-direction.x, -direction.z)
		if nearest > 1.5: enemy.position += direction * minf(2.0 * delta, nearest - 1.5)
		_separate_enemy(room, enemy)
		enemy.position.y = _height(room, enemy.position.x, enemy.position.z)
		if nearest < 1.8 and _now() - enemy.attackAt > 1.0:
			enemy.attackAt = _now()
			target.hp -= 10.0
			_event(room, "hit", target.position, target.id)
			if target.hp <= 0:
				_event(room, "death", target.position, target.id)
				target.hp = 100.0
				target.position = _spawn_position(room, target.id)
				target.vy = 0.0

func _separate_enemy(room, enemy):
	# Cosmetic bodies must not engulf a hero camera, even when cast at the hero.
	# Two bounded passes resolve common crowded cases without a physics engine.
	for _pass in range(2):
		for p in room.players.values():
			if p.role != "hero" or p.connection == -1 or absf(enemy.position.y - p.position.y) > 2.5: continue
			var root = Vector2(p.position.x, p.position.z)
			var point = Vector2(enemy.position.x, enemy.position.z)
			var offset = point - root
			if offset.length_squared() >= 1.0: continue
			var direction = offset.normalized() if offset.length_squared() > 0.0001 else Vector2(1, 0)
			point = root + direction
			point = point.clamp(Vector2(-BOUND, -BOUND), Vector2(BOUND, BOUND))
			if point.distance_squared_to(root) < 0.99:
				direction = -root.normalized() if root.length_squared() > 0.01 else Vector2(1, 0)
				point = root + direction
			enemy.position.x = point.x
			enemy.position.z = point.y

func _height(room, x: float, z: float) -> float:
	var height = 0.45 * sin(x * 0.09) * cos(z * 0.07)
	for edit in room.edits:
		var t = clampf(1.0 - Vector2(x - edit.x, z - edit.z).length() / edit.radius, 0.0, 1.0)
		height += edit.height * t * t * (3.0 - 2.0 * t)
	return height
func _array(v: Vector3) -> Array: return [v.x, v.y, v.z]
func _snapshot(room):
	var players = []
	for p in room.players.values():
		var item = {"id": p.id, "name": p.name, "role": p.role, "position": _array(p.position), "yaw": p.yaw, "hp": p.hp, "mana": p.mana}
		if p.has("head"): item.head = p.head
		if p.has("hands"): item.hands = p.hands
		players.append(item)
	var enemies = []
	for e in room.enemies.values(): enemies.append({"id": e.id, "position": _array(e.position), "yaw": e.yaw, "hp": e.hp})
	return {"tick": tick, "time": _now(), "seed": 41, "room": room.code, "players": players, "enemies": enemies, "edits": room.edits, "groves": room.groves, "maxPlayers": MAX_PLAYERS}
func _broadcast(room, message):
	for p in room.players.values():
		if connections.has(p.connection): _send(connections[p.connection], message)
func _event(room, kind, position, id): _broadcast(room, {"type": "event", "kind": kind, "position": _array(position), "id": id})

func _save_worlds():
	var saved = []
	for room in rooms.values(): saved.append({"code": room.code, "edits": room.edits, "groves": room.groves})
	var path = data_dir.path_join("worlds.json")
	var file = FileAccess.open(path + ".tmp", FileAccess.WRITE)
	if file == null:
		_log("persistence_failed", {"stage": "open", "error": FileAccess.get_open_error()})
		return
	file.store_string(JSON.stringify({"version": 1, "rooms": saved}))
	file.close()
	var result = DirAccess.rename_absolute(path + ".tmp", path)
	if result != OK: _log("persistence_failed", {"stage": "rename", "error": result})

func _load_worlds():
	var path = data_dir.path_join("worlds.json")
	if not FileAccess.file_exists(path): return
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null or file.get_length() > 2097152:
		_log("persistence_invalid")
		return
	var saved = JSON.parse_string(file.get_as_text())
	if not saved is Dictionary or saved.get("version") != 1 or not saved.get("rooms") is Array:
		_log("persistence_invalid")
		return
	for item in saved.rooms.slice(0, MAX_ROOMS):
		if not item is Dictionary or not item.get("code") is String or item.code.length() != 16: continue
		if not item.get("edits") is Array or not item.get("groves") is Array: continue
		var room = _new_room(item.code)
		for edit in item.edits.slice(0, 64):
			if edit is Dictionary and edit.get("kind") in ["raise", "starfall"] and edit.get("id") is String and _number(edit.get("x")) and _number(edit.get("z")) and absf(edit.x) <= BOUND and absf(edit.z) <= BOUND and edit.get("radius") in [5.0, 6.0] and edit.get("height") in [-1.0, 2.0]: room.edits.append(edit)
		for grove in item.groves.slice(0, 64):
			if grove is Dictionary and grove.get("id") is String and _number(grove.get("x")) and _number(grove.get("z")) and absf(grove.x) <= BOUND and absf(grove.z) <= BOUND: room.groves.append(grove)
		rooms[item.code] = room
	_log("worlds_loaded", {"rooms": rooms.size()})
