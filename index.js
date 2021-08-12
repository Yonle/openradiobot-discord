// Link ffmpeg-static if there's. This is used for eris.
try {
	let ffmpegPath = require("ffmpeg-static").split("/");
	ffmpegPath = ffmpegPath.slice(0, ffmpegPath.length-1).join("/");
	process.env["PATH"] = ffmpegPath + ":" + process.env["PATH"];
} catch (error) {}

const openradio = require("openradio");
const eris = require("eris");
const { Server } = require("http");
const miniget = require("miniget");
const ytdl = require("ytdl-core");
const ytsr = require("ytsr");
const ytpl = require("ytpl");
const ms = require("ms");
const { PassThrough } = require("stream");
require("dotenv").config();

const bot = new eris(process.env.BOT_TOKEN);
const server = new Server();
const radios = new Map();

const listener = server.listen(process.env.PORT || 3000, () => {
	console.log("Server is now on port", listener.address().port);
});

server.on('request', (req, res) => {
	let id = req.url.slice(1);
	if (isNaN(Number(id)) || !radios.has(id)) {
		res.writeHead(400);
		res.end("Invalid Request");
	} else {
		let ply = Math.random();
		res.setHeader("content-type", "audio/mp3");
		radios.get(id).metadata.listener.set(ply, res);
		radios.get(id).metadata.totalListener++;

		req.on('close', () => {
			if (!radios.get(id)) return;
			radios.get(id).metadata.listener.delete(ply);
		});
	}
});

// Used for Validating URL
function validateURL(str) {

  let pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol

    '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name

    '((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address

    '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path

    '(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string

    '(\\#[-a-z\\d_]*)?$','i'); // fragment locator

  return !!pattern.test(str);

}

bot.sendChatAction = Function();
bot.on("ready", () => console.log("Logged as", bot.user.username));
bot.on("error", console.error);
bot.on("messageCreate", async message => {
	if (message.author.bot) return;
	if (!message.channel.guild) message.guildID = message.author.id;
	message.reply = async (text, replyToId) => {
		if (!text || typeof text != "string") return Promise.resolve();
		if (text.length > 2000) {
			try {
				await bot.createMessage(message.channel.id, text.slice(0, 2000));
				return await message.reply(text.slice(2000));
			} catch (error) {
				message.reply("An error occured: " + error.toString());
			}
		} else {
			if (!text.length) return Promise.resolve();
			try {
				await bot.createMessage(message.channel.id, text);
				return Promise.resolve();
			} catch (error) {
				message.reply("An error occured: " + error.toString());
			}
		}
	};
	if (!message.content || !message.content.startsWith("*") || message.content.length < 3) return;
	let radio = radios.get(message.guildID);
	switch (message.content.split(" ")[0].slice(1)) {
		case "new": 
			if (radio) return message.reply("You already created your radio. To manage it, Type /manage. To destroy it, Type /destroy");
			radios.set(message.guildID, {
				player: new openradio().on('error', (err) => message.reply(err.toString())),
				queue: [],
				metadata: {
					listener: new Map(),
					totalListener: 0,
					starttime: Date.now(),
					curSong: null,
					autoplay: false,
					loopType: "none"
				},
				play: function () {
					if (!radio) radio = radios.get(message.guildID);
					if (!radio) return console.log("There's no radio. Aborting...");
					radio.queue = radio.queue.filter(song => song);
					if (radio.metadata.loopType == "queue" && typeof(radio.metadata.curSong) === "object") radio.queue.push(radio.metadata.curSong);
					if (radio.metadata.loopType == "single" && typeof(radio.metadata.curSong) === "object") radio.queue.unshift(radio.metadata.curSong);
					let nextSong = radio.queue.shift();
					radio.metadata.curSong = null;
					if (!nextSong) return false;
					bot.sendChatAction(message.guildID, 'typing');
					if (nextSong.type === "raw") {
						let stream = miniget(nextSong.url);
						stream.on('response', () => {
							radio.player.play(stream).then(radio.play);
							if (nextSong.isAttachment) {
								radio.metadata.curSong = nextSong;
								return message.reply(`▶️Playing Voice/Audio Message....`);
							}
							radio.metadata.curSong = nextSong;
							message.reply(`▶️Now Playing: **__Raw Stream__**`);
						});

						stream.on('request', () => {
							bot.sendChatAction(message.guildID, 'typing');
						});

						stream.on('error', (err) => message.reply(err.toString()));
					} else {
					
						bot.sendChatAction(message.guildID, 'typing');
						let stream = ytdl(nextSong.id || nextSong.videoDetails.videoId, { filter: "audioonly", quality: "highestaudio" });

						stream.on('info', (info) => {
							bot.sendChatAction(message.guildID, 'typing');
							radio.metadata.curSong = info;
							radio.player.play(stream).then(radio.play);
							if (radio.metadata.autoplay) {
								radio.queue.push(info.related_videos[0]);
							}
							message.reply(`▶️Now playing: **__${radio.metadata.curSong.videoDetails.title}__**`);
						});

						stream.on('error', err => message.reply(err.toString()));
					}
					return true;
				}
			});
			radios.get(message.guildID).player.on('data', data => radios.get(message.guildID).metadata.listener.forEach((res, id) => res.write(data, err => {
					if (err) {
						radios.get(message.guildID).metadata.listener.delete(id);
						console.error(err);
					}
			})));
			message.reply("✔️Radio Created");
			break;
		case "destroy": 
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			radio.player.destroy();
			radios.delete(message.guildID);
			message.reply("✔️Radio destroyed.");
			break;
		case "manage": 
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			(() => {
				let text = "**Your radio status**";
				text += `\nListener: \`${radio.metadata.listener.size}\``;
				text += `\nTotal Listener: \`${radio.metadata.totalListener}\``;
				text += `\nLoop Type: \`${radio.metadata.loopType}\``;
				text += `\nCreated Since: \`${ms(Date.now() - radio.metadata.starttime)}\``;
				if (radio.metadata.curSong && !radio.metadata.curSong.isAttachment) text += 
				`\nNow Playing: ${radio.metadata.curSong.url || radio.metadata.curSong.videoDetails.video_url}`;
				if (radio.metadata.curSong && radio.metadata.curSong.isAttachment) text += "\nNow Playing: Voice/Audio Message";
				text += `\nAutoplay Enabled?: \`${radio.metadata.autoplay ? "Yes" : "No"}\``;
				text += `\nTotal Queue: \`${radio.queue.length}\``;
				text += `\nLive on: ${process.env.SERVER_HOST||"http://localhost:3000"}/${message.guildID}`;
				text += `\n\nTo check song queue, Type /queue`;
				message.reply(text);
			})();
			break;
		case "queue":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radio.queue.length) return message.reply("🏜️Nothing is in queue....");
			let method = message.content.split(" ").slice(1)[0];
			if (!method) return (() => {
				let text = "**Radio Queue**";
				radio.queue.slice(0, 20).forEach((song, songNum) => {
					songNum++;
					if (song.isAttachment) {
						text += `\n${songNum}. Voice/Audio Message`;
					} else if (song.type === 'raw'){
						text += `\n${songNum}. **__${song.url}__**`;
					} else {
						text += `\n${songNum}. **__${song.title}__**\nhttps://youtu.be/${song.id}`;
					}
				});
				text += "\n\n⚠️Some song is hidden due to a lot of request value. We'll improve this soon.\n\nYou may also manage these queue. For more information, Do `/queue help`";
				message.reply(text);
			})();
			
			if (method === "help") {
				let text = "**Queue Managing**";
				text += "\nUsage: `/queue [method] [argument]`";
				text += "\n\nAvailable Method:";
				text += "\n  remove  - Remove a song in a queue";
				text += "\n  move    - Move a song in a queue";
				text += "\n  shuffle - Sort queue into random order";
				text += "\n  random  - Alias of `shuffle`";
				message.reply(text);
			} else if (method === "remove") {
				let args = message.content.split(" ").slice(2)[0];
				if (!args) return message.reply("Usage: `/queue remove [Order number of song in /queue]`");
				if (!radio.queue[Number(args)-1]) return message.reply("No song was found in Queue Order number " + args);
				delete radio.queue[Number(args)-1];
				// Re-create. Ignore the undefined ones
				radio.queue = radio.queue.filter(song => song);
				message.reply(`✔️Song number ${args} has been removed.`);
			} else if (method === "move") {
				let args = message.content.split(" ").slice(2)[0];
				let to = message.content.split(" ").slice(3)[0];
				if (!args || !to) return message.reply("Usage: `/queue move [Order number] [To Order number]`");
				if (!radio.queue[Number(args)-1] || !radio.queue[Number(to)-1]) return message.reply("Song not found or invalid value.");
				let fromOrder = radio.queue[Number(args)-1];
				let toOrder = radio.queue[Number(to)-1];
				radio.queue[Number(args)-1] = toOrder;
				radio.queue[Number(to)-1] = fromOrder;
				message.reply(`✔️*${fromOrder.title}* order moved to *${toOrder.title}* order.`);
			} else if (method === "shuffle" || method === "random") {
				radio.queue.sort(() => 0.5 - Math.random());
				message.reply("✔️Queue order has been sorted randomly.");
			}
			break;
		case "play":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			let str = message.content.split(" ").slice(1).join(" ");
			let audio = message.reply_to_message ? message.reply_to_message.audio||message.reply_to_message.voice||message.reply_to_message.document : null;
			if (!str.length && !audio) return message.reply("Usage: `/play [Song name|URL|Reply to Audio/Voice Message]`");
			if (str) message.reply(`Searching \`${str}\`...`);
			bot.sendChatAction(message.guildID, 'typing');

			if (message.member.voiceState.channelID) {
				bot.joinVoiceChannel(message.member.voiceState.channelID).catch(console.error).then(c => {
					if (c.playing) return;
					let ply = new PassThrough();
					radio.metadata.listener.set(message.guildID, ply);
					c.play(ply, { voiceDataTimeout: -1 });
					c.on('error', console.error);
				});
			}
			if (str.toLowerCase().includes("youtube.com/playlist?list=")) {
				ytpl(str, { limit: Infinity, page: Infinity }).then(res => {
					if (!res.items.length) return message.reply("🙅No Result.");
					if (!radio) return;
					message.reply(`✔️${res.items.length} Song has been added to queue`);
					if (!radio.queue.length && !radio.metadata.curSong) {
						radio.queue.push(res.items);
						radio.queue = radio.queue.flat(Infinity);
						message.reply("Preparing to play...");
						bot.sendChatAction(message.guildID, 'typing');
						radio.play();
					} else {
						radio.queue.push(res.items);
						radio.queue = radio.queue.flat(Infinity);
					}
				});
			} else if (validateURL(str) && !ytdl.validateURL(str)) {
				let newQueue = {
					type: 'raw',
					title: `Raw Stream`,
					url: str
				}
				if (!radio.queue.length && !radio.metadata.curSong) {
					radio.queue.push(newQueue);
					message.reply("Preparing to play...");
					bot.sendChatAction(message.guildID, 'typing');
					radio.play();
				} else {
					radio.queue.push(newQueue);
					bot.sendChatAction(message.guildID, 'typing');
					message.reply("✔️A stream URL has been added to queue.");
				}
			} else if (ytdl.validateURL(str)) {
				ytdl.getInfo(str).then(info => {
					info.formats = info.formats.filter(format => !format.hasVideo && format.hasAudio);
					if (!info.formats.length) return message.reply("❌Sorry. We can't Play this video due to our server region lock.");
					if (!radio.queue.length && !radio.metadata.curSong) {
						radio.queue.push(info);
						message.reply("Preparing to play...");
						bot.sendChatAction(message.guildID, 'typing');
						radio.play();
					} else {
						radio.queue.push(info);
						message.reply(`✔️**__${info.videoDetails.title}__** has been added to queue.`);
					}
				});
			} else {
				ytsr(str, { limit: 1 }).then(res => {
					bot.sendChatAction(message.guildID, 'typing');
					res.items = res.items.filter(video => video.type == "video");
					if (!res.items.length) return message.reply("🙅No Result.");
					if (!radio) return;
					if (!radio.queue.length && !radio.metadata.curSong) {
						radio.queue.push(res.items[0]);
						message.reply("Preparing to play...");
						bot.sendChatAction(message.guildID, 'typing');
						radio.play();
					} else {
						radio.queue.push(res.items[0]);
						message.reply(`✔️**__${res.items[0].title}__** has been added to queue.`);
					}
				}).catch(err => {
					message.reply(`An error occured: ${err.toString()}`);
				});
			}
			break;
		case "pause":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radio.player.stream) return message.reply("There's nothing playing. Glitched? Do /destroy");
			radio.player.pause();
			message.reply("⏸️Paused");
			break;
		case "resume":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radio.player.stream) return message.reply("There's nothing playing. Glitched? Do /destroy");
			radio.player.resume();
			message.reply("▶️Resumed");
			break;
		case "skip":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radio.player.stream) return message.reply("There's nothing playing. Glitched? Do /destroy");
			if (!radio.queue.length) return message.reply("There's nothing in queue!");
			radio.play();
			message.reply("⏩Skipping...");
			break;
		case "stop":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			if (!radio.player.stream) return message.reply("There's nothing playing. Glitched? Do /destroy");
			radio.player.stream.destroy();
			radio.queue = [];
			message.reply("⏹️Player Stopped");
			break;
		case "autoplay":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			let autoplay = radio.metadata.autoplay;
			if (radio.curSong.type == 'raw') return message.reply('Sorry. You can\'t use autoplay right now.');
			if (!autoplay) {
				radio.metadata.autoplay = true;
				let info = radio.metadata.curSong;
				radio.queue.push(info.related_videos[0]);
				message.reply("✔️Autoplay enabled");
			} else {
				radio.metadata.autoplay = false;
				message.reply("✔️Autoplay disabled");
			}
			break;
		case "loop":
			if (!radio) return message.reply("You didn't created radio yet. Did you mean /new ?");
			(() => {
				let loopType = message.content.split(" ").slice(1)[0];
				let availableLoopType = ["queue", "single", "none"];
				if (!loopType || !availableLoopType.includes(loopType)) return message.reply("Usage: `/loop [queue|single|none]`");
			
				radio.metadata.loopType = loopType.toLowerCase();
				message.reply(`✔️Loop Type has been set as \`${loopType.toLowerCase()}\``);
			})();
			break;
		default:
			//if (!message.content.startsWith("/start") || !message.content.startsWith("/help")) return;
			(() => {
				let text = "**OpenradioBot v0.0 Alpha**";
				text += "\n\n__Radio Managing__";
				text += "\n/new      - Create new radio";
				text += "\n/destroy  - Destroy current radio";
				text += "\n/manage   - Manage your radio";
				text += "\n\n__Player Managing__";
				text += "\n/play     - Play a song";
				text += "\n/pause    - Pause a player";
				text += "\n/resume   - Resume a player";
				text += "\n/skip     - Skip current song";
				text += "\n/stop     - Stop player";
				text += "\n/queue    - See & Manage queue list.";
				text += "\n/autoplay - Auto play next song from youtube **Related Videos** query.";
				text += "\n/loop     - Loop queue";
			
				message.reply(text);
			})();
			break;
	}
});

bot.connect();
process.on('unhandledRejection', err => console.log(err));
