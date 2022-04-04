// setup the websocket
const socket = io("https://zingvideochat.herokuapp.com", {
	cors: {
		withCredentials: true,
	},
});
// the audio and video streams for the user's input
const inputStreams = {
	video: undefined,
	audio: undefined,
};
// the usernames of this user and the one they're talking to
const names = {
	self: "",
	remote: "",
};

let remoteStream; // the media stream for the remote video
let initiatior; // did this user create the room?
let room; // the room ID for this call
let connection; // the webRTC connection
let inactivityTimer; // timer for Heroku inactivity timeout

// start a new call
function createRoom() {
	initiatior = true;
	// get a unique room ID
	$.get("https://zingvideochat.herokuapp.com/roomId", (res) => {
		room = res;
		socket.emit("create", room);
		console.log("creating room: " + room);

		showRoomInfo(); // transition to room info screen
		startTimer(); // start inactivity timer
		updateURL(); // add the room code to the URL
	});
}

// join an existing call
function joinRoom() {
	initiatior = false;
	socket.emit("join", room);
	console.log("joining room: " + room);

	$("#remote-room-info-wrap").hide(); // hide the room info screen
	startTimer(); // start inactivity timer
	updateURL(); // add the room code to the URL
}

// triggers when two clients have connected
socket.on("ready", () => {
	// setup camera + microphone if you haven't already
	if (!initiatior) {
		setupCall();
	}

	createPeerConnection(); // create the webRTC connection object

	$("#remote-room-info-wrap").hide(); // hide room info screen
	$("#start-audio")[0].play(); // play start sound effect

	// add audio + video tracks if they exist
	if (inputStreams.audio) {
		console.log("adding audio track");
		inputStreams.audio.getTracks().forEach((track) => {
			connection.addTrack(track);
		});
	}
	if (inputStreams.video) {
		console.log("adding video track");
		connection.addTrack(inputStreams.video.getTracks()[0]);
	}

	// start ICE negotiation if user created this room
	if (initiatior) {
		handleNegotiation();
	}
	startTimer(); // restart inactivity timer
	sendUpdateMessage(); // update other user about audio and video state
});

// triggers when the other user sends a message
socket.on("message", (message) => {
	console.log("client received message:", message);

	if (message.type === "offer") {
		// received an offer
		console.log("received offer");
		connection
			.setRemoteDescription(new RTCSessionDescription(message))
			.then(() => {
				// create an answer
				connection
					.createAnswer()
					.then(setLocalAndSendMessage)
					.catch((e) => {
						console.log("failed to create answer:", e);
					});
			})
			.catch((e) => {
				console.log("failed to set remote description:", e);
			});
	} else if (message.type === "answer") {
		// received an answer
		console.log("received answer");
		connection.setRemoteDescription(new RTCSessionDescription(message)).then(sendUpdateMessage);
	} else if (message.type === "candidate") {
		// received an ice candidate
		console.log("received candidate");
		connection.addIceCandidate(new RTCIceCandidate(message.candidate));
	} else if (message.type === "statusUpdate") {
		updateRemoteTracks(message); // received an update about audio/video status or username
	}

	startTimer(); // restart inactivity timer
});

// triggers when other user ends the call or disconnects
socket.on("end", endCall);

// triggers when trying to join a room that doesn't exist
socket.on("empty", () => {
	showHomeScreen();
	alert("Sorry, that room does not exist.");
});

// triggers when trying to join a room that's already full
socket.on("full", () => {
	showHomeScreen();
	alert("Sorry, that room is already full.");
});

// triggers when the socket disconnects from the server
socket.on("disconnect", () => {
	endCall();
});

// set the local session description and send it to the other client
function setLocalAndSendMessage(sessionDescription) {
	// set the local session description for the connection
	connection
		.setLocalDescription(sessionDescription)
		.then(() => {
			socket.emit("message", sessionDescription); // send the description to the other user
			console.log("set local description and sent message");
			startTimer(); // restart the inactivity timer
		})
		.catch((e) => {
			console.log("failed to set local description:", e);
		});
}

// create the RTC peer connection object
function createPeerConnection() {
	connection = new RTCPeerConnection(connectionConfig);
	// setup event handlers
	connection.onicecandidate = handleIceCandidate;
	connection.ontrack = handleTrack;
	connection.onnegotiationneeded = handleNegotiation;
	console.log("Created RTCPeerConnnection");
}

// send the ICE candidate to the other user
async function handleIceCandidate(e) {
	if (e.candidate) {
		socket.emit("message", {
			type: "candidate",
			candidate: e.candidate,
		});
		startTimer(); // restart inactivity timer
	}
}

// renegotiate the webRTC connection
async function handleNegotiation() {
	connection
		.createOffer()
		.then(setLocalAndSendMessage)
		.catch((e) => {
			console.log("create offer error:", e);
		});
}

// add a new track received from the other user
async function handleTrack(e) {
	console.log("Received track:", e);

	if (e.track.kind === "video") {
		$("#remote-video").show();
		$("#remote-name-wrap").hide();
		// get rid of old video tracks
		remoteStream.getVideoTracks().forEach((track) => {
			remoteStream.removeTrack(track);
		});
	} else if (e.track.kind === "audio") {
		$("#remote-muted-image-wrap").hide();
		if (remoteStream.getAudioTracks().length === 0) {
			$("#unmute-audio")[0].play(); // play the sound effect
		}
	}

	// add to the video element
	remoteStream.addTrack(e.track);
	$("#remote-video")[0].load();
}

// rescale a video to fill a 4:3 box
function rescaleVideo(e) {
	// find the dimensions of the video
	const videoElement = $(this);
	const width = videoElement[0].videoWidth;
	const height = videoElement[0].videoHeight;

	if (height > width) {
		// video is taller than it is wide
		videoElement.addClass("tall-video");
		videoElement.removeClass("wide-video");
	} else {
		// video is wider than it is tall
		videoElement.addClass("wide-video");
		videoElement.removeClass("tall-video");
	}
}

// update the remote tracks when a status update is removed
function updateRemoteTracks(updateData) {
	// update remote name
	names.remote = updateData.name;
	$("#remote-name").text(names.remote);

	// if there's no audio
	if (!updateData.audio) {
		// if audio has just been muted
		if (remoteStream.getAudioTracks().length > 0) {
			$("#mute-audio")[0].play(); // play mute sound effect
			// remove audio tracks
			remoteStream.getAudioTracks().forEach((track) => {
				remoteStream.removeTrack(track);
			});
		}
		$("#remote-muted-image-wrap").show();
	}

	// if there is video
	if (updateData.video) {
		// make sure the video is displayed
		$("#remote-video").show();
		$("#remote-name-wrap").hide();
	} else {
		// remove video tracks
		remoteStream.getVideoTracks().forEach((track) => {
			remoteStream.removeTrack(track);
		});
		// show the remote name
		$("#remote-video").hide();
		$("#remote-name-wrap").show();

		if (names.remote.length > 0) {
			// show remote name
			$("#remote-camera-off").hide();
			$("#remote-name").show();
		} else {
			// show camera off icon
			$("#remote-camera-off").show();
			$("#remote-name").hide();
		}
	}
}

// update the other user about the audio/video status
function sendUpdateMessage() {
	socket.emit("message", {
		type: "statusUpdate",
		audio: inputStreams.audio !== undefined,
		video: inputStreams.video !== undefined,
		name: names.self,
	});
	startTimer(); // restart inactivity timer
}

// setup the user's display DOM for a new call
function setupCall() {
	// show the call div
	$("#setup-wrap").hide();
	$("#call-wrap").show();
	$("#remote-video").hide();

	// create MediaStream for remote tracks
	remoteStream = new MediaStream();
	$("#remote-video")[0].srcObject = remoteStream;

	setupCamera(true); // activate the camera and microphone
}

// end the call for both users
function endCall() {
	socket.emit("end");
	// play end audio if applicable
	if (connection || initiatior) {
		$("#end-audio")[0].play();
	}
	// close webRTC connection if applicable
	if (connection) {
		connection.close();
		connection = undefined;
	}
	showHomeScreen(); // return to home screen
}

// show the home screen
function showHomeScreen() {
	names.remote = "";
	room = undefined;

	$("#setup-wrap").show();
	$("#call-wrap").hide();
	$("#room-code-input").val("");

	cancelTimer(); // stop the inactivity timer
	updateURL(); // remove the room code from the URL
	// stop the camera and microphone
	stopCamera();
	stopMicrophone();
}

// show the room code and link button
function showRoomInfo() {
	$("#remote-name-wrap").hide();
	$("#remote-muted-image-wrap").hide();
	$("#ping-wrap").hide();
	$("#remote-room-info-wrap").show();
	$("#room-info-code").text(room);
}

// add or remove the room code from the url
function updateURL() {
	let newURL = window.location.href.split("?")[0];
	if (room && room.length > 0) {
		newURL += "?code=" + room;
	}
	window.history.replaceState({}, document.title, newURL);
}

// start the user's camera
function setupCamera(setupMicrophoneAfter) {
	// try to fix the aspect ratio to 4:3
	const constraints = {
		video: {
			facingMode: "user",
			aspectRatio: {
				min: 1.3333333333333333,
				ideal: 1.3333333333333333,
				max: 1.3333333333333333,
			},
			height: {
				ideal: 1080,
			},
			width: {
				ideal: 1440,
			},
		},
		audio: false,
	};
	navigator.mediaDevices
		.getUserMedia(constraints)
		.then((stream) => {
			inputStreams.video = stream; // save the stream
			$("#preview-video")[0].srcObject = inputStreams.video; // play it in the preview video element
			const tracks = inputStreams.video.getTracks();
			// add track to connection if it exists
			if (tracks.length > 0 && connection) {
				connection.addTrack(tracks[0]);
			}
			toggleCameraUI(true); // update the camera button
			$("#preview-video")[0].load();
		})
		.catch((e) => {
			// something went wrong or the user disallowed permission
			console.log("failed to start camera:", e);
			inputStreams.video = undefined;
			toggleCameraUI(false); // update the camera button
			$("#preview-video")[0].load();
		})
		.finally(() => {
			if (connection) {
				sendUpdateMessage();
			}
			// chain to setup the microphone after camera is done being setup
			if (setupMicrophoneAfter) {
				setupMicrophone();
			}
		});
}

// stop using the camera
function stopCamera() {
	if (inputStreams.video) {
		// stop all tracks
		inputStreams.video.getTracks().forEach((track) => {
			track.stop();
		});
		inputStreams.video = undefined;
	}
	sendUpdateMessage(); // inform the other user
	toggleCameraUI(false); // update the camera button
}

// update the camera button to show whether it's activated
function toggleCameraUI(onState) {
	if (onState) {
		$("#camera-button").removeClass("toggled-off-button");
		$("#camera-button").addClass("toggled-on-button");
		$("#camera-button").children(".camera-off-image").hide();
		$("#camera-on-image").show();
		$("#preview-video").show();
		$("#preview-name-wrap").hide();
	} else {
		$("#camera-button").removeClass("toggled-on-button");
		$("#camera-button").addClass("toggled-off-button");
		$("#camera-button").children(".camera-off-image").show();
		$("#camera-on-image").hide();
		$("#preview-video").hide();
		$("#preview-name-wrap").show();

		if (names.self.length > 0) {
			// show the user's name
			$("#preview-name").text(names.self);
			$("#preview-name").show();
			$("#preview-camera-off").hide();
		} else {
			// show the camera off icon
			$("#preview-name").hide();
			$("#preview-camera-off").show();
		}
	}
}

// start the user's microphone
function setupMicrophone() {
	const constraints = { video: false, audio: { echoCancellation: true } };
	navigator.mediaDevices
		.getUserMedia(constraints)
		.then((stream) => {
			inputStreams.audio = stream; // save the stream
			// add all tracks to connection if it exists
			if (connection) {
				inputStreams.audio.getTracks().forEach((track) => {
					connection.addTrack(track);
				});
			}
			toggleMicrophoneUI(true); // update microphone button
			$("#unmute-audio")[0].play(); // play unmute sound effect
		})
		.catch((e) => {
			console.log("failed to start microphone:", e);
			inputStreams.audio = undefined;
			toggleMicrophoneUI(false); // update microphone button
		})
		.finally(() => {
			if (connection) {
				sendUpdateMessage();
			}
		});
}

// stop using the microphone
function stopMicrophone() {
	if (inputStreams.audio) {
		// stop all tracks
		inputStreams.audio.getTracks().forEach((track) => {
			track.stop();
		});
		inputStreams.audio = undefined;
	}
	sendUpdateMessage(); // inform the other user
	toggleMicrophoneUI(false); // update microphone button
}

// update the microphone button to show whether it's activated
function toggleMicrophoneUI(onState) {
	if (onState) {
		$("#microphone-button").removeClass("toggled-off-button");
		$("#microphone-button").addClass("toggled-on-button");
		$("#microphone-button").children(".muted-image").hide();
		$("#unmuted-image").show();
	} else {
		$("#microphone-button").removeClass("toggled-on-button");
		$("#microphone-button").addClass("toggled-off-button");
		$("#microphone-button").children(".muted-image").show();
		$("#unmuted-image").hide();
	}
}

// end the inactivity timer
function cancelTimer() {
	if (inactivityTimer) {
		clearTimeout(inactivityTimer);
	}
	$("#ping-wrap").hide();
}

// restart the inactivity timer
function startTimer() {
	cancelTimer();
	// set a 50 minute timer
	inactivityTimer = setTimeout(() => {
		$("#ping-wrap").show();
	}, 3000000);
}

$("#end-call-button").click(endCall);

$("#camera-button").click((e) => {
	if (inputStreams.video) {
		stopCamera();
	} else {
		setupCamera(false);
	}
});

$("#microphone-button").click((e) => {
	if (inputStreams.audio) {
		stopMicrophone();
		$("#mute-audio")[0].play(); // play unmute sound effect
	} else {
		setupMicrophone();
	}
});

$("#create-room-button").click((e) => {
	setupCall();
	createRoom();
});

$("#join-room-button").click((e) => {
	const code = $("#room-code-input").val();
	if (code.length > 0) {
		room = code;
		joinRoom();
	}
});

$("#username-input").on("focusout", (e) => {
	// update username when the user stops editing
	names.self = $("#username-input").val();
	// save the username to browser storage
	localStorage.setItem("zing video chat - name", names.self);
	// update the name preview
	toggleCameraUI(inputStreams.video !== undefined);
	if (connection) {
		sendUpdateMessage(); // update the other user
	}
});

$("#username-form").on("submit", (e) => {
	// lose focus on username form when user presses enter
	e.preventDefault();
	$("#username-input").blur();
});

$("#room-code-form").on("submit", (e) => {
	// join room when user presses enter
	e.preventDefault();
	$("#join-room-button").click();
});

$("#copy-link-button").click((e) => {
	// copy room code to clipboard
	if (navigator.clipboard) {
		navigator.clipboard
			.writeText(window.location.href)
			.then(() => {
				console.log("successfully copied link");
			})
			.catch((e) => {
				console.log("unable to copy link:", e);
			});
	}
});

$("#ping-wrap").click((e) => {
	// send a message on the websocket to stop the server from going to sleep
	$("#ping-wrap").hide();
	socket.emit("message", { type: "ping" });
	startTimer(); // restart inactivity timer
});

// scale the videos when they load
$("#preview-video").on("loadedmetadata", rescaleVideo);
$("#remote-video").on("loadedmetadata", rescaleVideo);

// run when page loads
$(document).ready(() => {
	// set SFX volume
	$("#mute-audio")[0].volume = 0.4;
	$("#unmute-audio")[0].volume = 0.4;

	// look for username in local storage
	const name = localStorage.getItem("zing video chat - name");
	if (name) {
		names.self = name;
		$("#username-input").val(name);
	}

	// look for room code in URL
	const paramsString = window.location.search;
	const params = new URLSearchParams(paramsString);
	const code = params.get("code");
	// attempt to join room if a code was found
	if (code) {
		room = code;
		joinRoom();
	}
});

// end call when closing the tab
$(window).on("beforeunload", (e) => {
	socket.emit("end");
});

// TURN/STUN servers
const connectionConfig = {
	iceServers: [
		{
			urls: "stun:openrelay.metered.ca:80",
		},
		{
			urls: "turn:openrelay.metered.ca:80",
			username: "openrelayproject",
			credential: "openrelayproject",
		},
		{
			urls: "turn:openrelay.metered.ca:443",
			username: "openrelayproject",
			credential: "openrelayproject",
		},
		{
			urls: "turn:openrelay.metered.ca:443?transport=tcp",
			username: "openrelayproject",
			credential: "openrelayproject",
		},
	],
};
