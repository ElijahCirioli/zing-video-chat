const express = require("express");
const socketIO = require("socket.io");
const http = require("http");

const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);
// setup websocket
const io = socketIO(server, {
	cors: {
		origin: "https://elijahcirioli.com",
		methods: ["GET", "POST"],
		credentials: true,
	},
});

// setup HTTP cors
app.use((req, res, next) => {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Credentials", true);
	res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
	res.header(
		"Access-Control-Allow-Headers",
		"Origin,X-Requested-With,Content-Type,Accept,content-type,application/json"
	);
	next();
});
app.use(express.json());
app.use(express.static("public"));

// get a unique room ID
app.get("/roomId", (req, res) => {
	const charSet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	const idLength = 10;
	while (true) {
		let id = "";
		for (let i = 0; i < idLength; i++) {
			id += charSet.charAt(Math.floor(Math.random() * charSet.length));
		}
		if (io.sockets.adapter.rooms[id] === undefined) {
			res.send(id);
			return;
		}
	}
});

app.get("*", (req, res) => {
	res.status(404).send("<h1>404: Page not found.</h1>");
});

server.listen(port, () => {
	console.log("Server is listening on port", port);
});

io.sockets.on("connection", (socket) => {
	let socketRoom;

	// retransmit messages to everyone else in the room
	socket.on("message", (message) => {
		socket.to(socketRoom).emit("message", message);
	});

	// attempt to create a room
	socket.on("create", (room) => {
		const inRoom = io.sockets.adapter.rooms.get(room);
		const numClients = inRoom ? inRoom.size : 0;

		if (numClients === 0) {
			// room doesn't already exist
			socket.join(room);
			socketRoom = room;
			console.log("created room: " + room);
		} else {
			// room exists already
			socket.emit("full");
			console.log("attempted to join full room: " + room);
		}
	});

	// attempt to join an existing room
	socket.on("join", (room) => {
		const inRoom = io.sockets.adapter.rooms.get(room);
		const numClients = inRoom ? inRoom.size : 0;

		if (numClients === 0) {
			// room doesn't exist
			socket.emit("empty");
			console.log("attempted to join room that does not exist: " + room);
		} else if (numClients === 1) {
			// room has 1 other user
			socket.join(room);
			socketRoom = room;
			io.sockets.in(room).emit("ready"); // tell users to start the call
			console.log("joined room: " + room);
		} else {
			// room is already full
			socket.emit("full");
			console.log("attempted to join room that is full: " + room);
		}
	});

	// end a connection
	socket.on("end", () => {
		socket.to(socketRoom).emit("end"); // tell other users in room to end
		socket.leave(socketRoom);
		console.log("closing room: " + socketRoom);
		socketRoom = undefined;
	});

	// socket connection closes
	socket.conn.on("close", (reason) => {
		if (socketRoom) {
			// tel; other users to end
			socket.to(socketRoom).emit("end");
			console.log("connection closed: " + socketRoom);
		}
	});
});
