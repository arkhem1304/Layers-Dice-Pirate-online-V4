const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'rooms-data.json');
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const faces = ['J', '2', '3', '4', '5', '6'];
// In normal rounds, bids can change freely: quantity and face value do not determine bid order.
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code; do { code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join(''); } while (rooms.has(code));
  return code;
}
function rollDie() { return faces[crypto.randomInt(faces.length)]; }
function activePlayers(room) { return [...room.players.values()].filter(p => p.diceCount > 0); }
function playerByToken(room, token) { return [...room.players.values()].find(p => p.token === token); }
function saveRooms() {
  try {
    const serial = [...rooms.values()].map(r => ({ ...r, players: [...r.players.values()] }));
    fs.writeFileSync(DATA_FILE, JSON.stringify(serial, null, 2));
  } catch (e) { console.error('Speichern fehlgeschlagen:', e.message); }
}
function loadRooms() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const serial = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const raw of serial) {
      const players = new Map((raw.players || []).map(p => [p.id, { ...p, socketId: null, connected: false }]));
      const room = { ...raw, startDiceCount: Math.max(1, Math.min(15, Number(raw.startDiceCount) || 5)), players };
      for (const p of players.values()) if (!Number.isInteger(p.diceCount)) p.diceCount = room.startDiceCount;
      // A server restart cannot safely resume a live reveal timer. Keep the saved game and let it continue.
      rooms.set(room.code, room);
    }
    console.log(`Gespeicherte Räume geladen: ${rooms.size}`);
  } catch (e) { console.error('Gespeicherte Räume konnten nicht geladen werden:', e.message); }
}
function roomView(room, viewerId) {
  return {
    code: room.code, hostId: room.hostId, status: room.status, round: room.round, startDiceCount: room.startDiceCount || 5,
    currentTurnId: room.currentTurnId, currentBid: room.currentBid, message: room.message,
    winnerId: room.winnerId, oneDieRound: !!room.oneDieRound, lockedFace: room.lockedFace || null,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, diceCount: p.diceCount,
      connected: !!p.connected, isHost: p.id === room.hostId,
      dice: p.id === viewerId && room.status === 'playing' ? p.dice : undefined })),
    meId: viewerId, canStart: viewerId === room.hostId && room.status === 'lobby' && room.players.size >= 2,
    canAct: room.status === 'playing' && room.currentTurnId === viewerId
  };
}
function broadcast(room) {
  saveRooms();
  for (const p of room.players.values()) if (p.connected && p.socketId) io.to(p.socketId).emit('state', roomView(room, p.id));
}
function startRound(room, firstPlayerId) {
  const active = activePlayers(room);
  if (active.length <= 1) {
    room.status = 'finished'; room.winnerId = active[0]?.id || null;
    room.message = active[0] ? `${active[0].name} gewinnt das Spiel!` : 'Das Spiel ist beendet.';
    room.currentTurnId = null; room.currentBid = null; room.oneDieRound = false; room.lockedFace = null;
    broadcast(room); return;
  }
  room.round += 1; room.status = 'playing'; room.currentBid = null; room.lockedFace = null;
  const oneDiePlayers = active.filter(p => p.diceCount === 1 && !p.oneDieSpecialUsed);
  room.oneDieRound = oneDiePlayers.length > 0;
  // Each player can trigger/receive the one-die special round only once per game.
  if (room.oneDieRound) for (const p of oneDiePlayers) p.oneDieSpecialUsed = true;
  // If the previous loser now has one die, they open the round. Otherwise the first one-die player does.
  let starter = active.find(p => p.id === firstPlayerId);
  if (oneDiePlayers.length) starter = oneDiePlayers.find(p => p.id === firstPlayerId) || oneDiePlayers[0];
  for (const p of active) p.dice = Array.from({ length: p.diceCount }, rollDie);
  room.currentTurnId = (starter || active[0]).id;
  room.message = room.oneDieRound
    ? `Runde ${room.round}: Sonderrunde! ${room.currentTurnId === starter.id ? starter.name : ''} eröffnet. Der erste Zahlenwert wird festgelegt; Joker zählen nicht.`
    : `Runde ${room.round}: Alle Würfel wurden neu geworfen.`;
  broadcast(room);
}
function nextPlayer(room, currentId) {
  const all = [...room.players.values()];
  const start = all.findIndex(p => p.id === currentId);
  for (let i = 1; i <= all.length; i++) {
    const p = all[(start + i + all.length) % all.length];
    if (p && p.diceCount > 0) return p.id;
  }
  return null;
}
function emitError(socket, message) { socket.emit('notice', { type: 'error', message }); }
function attachPlayer(socket, room, player) {
  if (player.socketId && player.socketId !== socket.id) {
    const old = io.sockets.sockets.get(player.socketId);
    if (old) old.leave(room.code);
  }
  player.socketId = socket.id; player.connected = true;
  socket.join(room.code); socket.data.roomCode = room.code; socket.data.playerId = player.id; socket.data.token = player.token;
  socket.emit('joined', { code: room.code, playerId: player.id, token: player.token, resumed: true });
  room.message = `${player.name} ist wieder verbunden.`;
  broadcast(room);
}
loadRooms();

io.on('connection', socket => {
  socket.on('resumeSession', ({ code, token }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || !token) return;
    const player = playerByToken(room, String(token));
    if (!player) return;
    attachPlayer(socket, room, player);
  });
  socket.on('createRoom', ({ name, token }) => {
    name = String(name || '').trim().slice(0, 18); token = String(token || '').slice(0, 100);
    if (!name) return emitError(socket, 'Bitte gib einen Spielernamen ein.');
    if (!token) return emitError(socket, 'Bitte lade die Seite neu und versuche es erneut.');
    const code = makeCode(); const id = crypto.randomUUID();
    const startDiceCount = 5;
    const player = { id, token, socketId: socket.id, name, diceCount: startDiceCount, dice: [], connected: true, oneDieSpecialUsed: false };
    const room = { code, hostId: id, players: new Map([[id, player]]), status: 'lobby', startDiceCount, round: 0,
      currentTurnId: null, currentBid: null, oneDieRound: false, lockedFace: null, message: 'Warte auf Freunde. Teile den Raumcode.', winnerId: null, createdAt: Date.now() };
    rooms.set(code, room); socket.join(code); socket.data.roomCode = code; socket.data.playerId = id; socket.data.token = token;
    socket.emit('joined', { code, playerId: id, token, resumed: false }); broadcast(room);
  });
  socket.on('joinRoom', ({ name, code, token }) => {
    name = String(name || '').trim().slice(0, 18); code = String(code || '').trim().toUpperCase(); token = String(token || '').slice(0, 100);
    if (!name) return emitError(socket, 'Bitte gib einen Spielernamen ein.');
    if (!token) return emitError(socket, 'Bitte lade die Seite neu und versuche es erneut.');
    const room = rooms.get(code);
    if (!room) return emitError(socket, 'Raum nicht gefunden. Prüfe den Einladungscode.');
    const existing = playerByToken(room, token);
    if (existing) return attachPlayer(socket, room, existing);
    if (room.status !== 'lobby') return emitError(socket, 'Diese Partie läuft bereits. Nutze auf diesem Gerät die gespeicherte Sitzung zum Wiedereinsteigen.');
    if (room.players.size >= 10) return emitError(socket, 'Dieser Raum ist voll (maximal 10 Spieler).');
    const id = crypto.randomUUID(); const player = { id, token, socketId: socket.id, name, diceCount: room.startDiceCount || 5, dice: [], connected: true, oneDieSpecialUsed: false };
    room.players.set(id, player); socket.join(code); socket.data.roomCode = code; socket.data.playerId = id; socket.data.token = token;
    socket.emit('joined', { code, playerId: id, token, resumed: false }); room.message = `${name} ist beigetreten.`; broadcast(room);
  });
  socket.on('setStartDiceCount', ({ count }) => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    if (socket.data.playerId !== room.hostId) return emitError(socket, 'Nur der Gastgeber kann die Start-Würfelzahl ändern.');
    if (room.status !== 'lobby') return emitError(socket, 'Die Start-Würfelzahl kann nur vor Spielbeginn geändert werden.');
    count = Number(count);
    if (!Number.isInteger(count) || count < 1 || count > 15) return emitError(socket, 'Wähle zwischen 1 und 15 Würfeln pro Spieler.');
    room.startDiceCount = count;
    for (const p of room.players.values()) { p.diceCount = count; p.dice = []; }
    room.message = `Start-Würfelzahl auf ${count} pro Spieler gesetzt.`;
    broadcast(room);
  });
  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    if (socket.data.playerId !== room.hostId) return emitError(socket, 'Nur der Gastgeber kann starten.');
    if (room.players.size < 2) return emitError(socket, 'Mindestens 2 Spieler werden benötigt.');
    const startingDice = Math.max(1, Math.min(15, Number(room.startDiceCount) || 5));
    for (const p of room.players.values()) { p.diceCount = startingDice; p.dice = []; p.oneDieSpecialUsed = false; }
    startRound(room, room.hostId);
  });
  socket.on('endGame', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    if (room.status === 'finished') {
      socket.emit('gameEnded', { message: 'Diese Partie ist bereits beendet. Du bist zurück im Hauptmenü.' });
      return;
    }
    const player = room.players.get(socket.data.playerId);
    const name = player?.name || 'Ein Spieler';
    room.status = 'finished';
    room.currentTurnId = null;
    room.currentBid = null;
    room.oneDieRound = false;
    room.lockedFace = null;
    room.message = `${name} hat die Partie beendet.`;
    broadcast(room);
    io.to(room.code).emit('gameEnded', { message: `${name} hat die Partie beendet. Alle Spieler kehren zum Hauptmenü zurück.` });
    for (const p of room.players.values()) {
      if (p.socketId) {
        const connectedSocket = io.sockets.sockets.get(p.socketId);
        if (connectedSocket) {
          connectedSocket.leave(room.code);
          connectedSocket.data.roomCode = null;
          connectedSocket.data.playerId = null;
        }
      }
      p.connected = false;
      p.socketId = null;
    }
    saveRooms();
  });
  socket.on('bid', ({ quantity, face }) => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.status !== 'playing') return;
    const playerId = socket.data.playerId; if (room.currentTurnId !== playerId) return emitError(socket, 'Du bist gerade nicht am Zug.');
    quantity = Number(quantity); face = String(face);
    const total = activePlayers(room).reduce((n, p) => n + p.diceCount, 0);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > total) return emitError(socket, 'Die Anzahl muss zwischen 1 und der Gesamtzahl aller aktiven Würfel liegen.');
    if (!faces.includes(face)) return emitError(socket, 'Ungültiger Würfelwert.');
    if (room.oneDieRound && room.currentBid === null && room.lockedFace === null && room.players.get(playerId).diceCount !== 1)
      return emitError(socket, 'In dieser Sonderrunde eröffnet der Spieler mit einem Würfel.');
    if (room.oneDieRound && room.lockedFace && face !== room.lockedFace)
      return emitError(socket, `Sonderrunde: Es dürfen nur ${room.lockedFace === 'J' ? 'Joker' : 'die ' + room.lockedFace + 'er'} geboten werden.`);
    if (room.oneDieRound && !room.currentBid && room.lockedFace === null) {
      if (face === 'J') return emitError(socket, 'In der Ein-Würfel-Sonderrunde ist Joker kein Zahlenwert. Wähle eine Zahl von 2 bis 6.');
      room.lockedFace = face;
    }
    if (room.currentBid && room.oneDieRound) {
      // The one-die special round keeps its own rule: same face, strictly increasing quantity.
      const higher = face === room.currentBid.face && quantity > room.currentBid.quantity;
      if (!higher) return emitError(socket, 'Sonderrunde: Du musst die Anzahl derselben Zahl erhöhen.');
    }
    const p = room.players.get(playerId); room.currentBid = { quantity, face, playerId, playerName: p.name };
    room.message = room.oneDieRound ? `${p.name} bietet ${quantity} × ${face} (Sonderrunde: Joker zählen nicht).` : `${p.name} bietet ${quantity} × ${face === 'J' ? 'Joker' : face}; normale Gebote dürfen frei geändert werden.`;
    room.currentTurnId = nextPlayer(room, playerId); broadcast(room);
  });
  socket.on('challenge', () => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.status !== 'playing') return;
    const challengerId = socket.data.playerId;
    if (room.currentTurnId !== challengerId) return emitError(socket, 'Du bist gerade nicht am Zug.');
    if (!room.currentBid) return emitError(socket, 'Es gibt noch kein Gebot, das du anzweifeln kannst.');
    const bid = room.currentBid; const allDice = activePlayers(room).flatMap(p => p.dice);
    const count = room.oneDieRound
      ? allDice.filter(d => d === bid.face).length
      : (bid.face === 'J' ? allDice.filter(d => d === 'J').length : allDice.filter(d => d === bid.face || d === 'J').length);
    const isTrue = count >= bid.quantity; const loserId = isTrue ? challengerId : bid.playerId;
    const loser = room.players.get(loserId); const challenger = room.players.get(challengerId); const bidder = room.players.get(bid.playerId);
    loser.diceCount = Math.max(0, loser.diceCount - 1); loser.dice = [];
    room.message = `${challenger.name} zweifelt ${bidder.name}s Gebot an. Gezählt: ${count}${room.oneDieRound ? ' (Joker zählen nicht)' : ''}. ${isTrue ? 'Das Gebot stimmt – ' + challenger.name : 'Das Gebot stimmt nicht – ' + bidder.name} verliert einen Würfel.`;
    room.currentBid = null; room.currentTurnId = null; broadcast(room);
    setTimeout(() => { if (rooms.has(room.code)) startRound(room, loserId); }, 3200);
  });
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const player = room.players.get(socket.data.playerId);
    if (player && player.socketId === socket.id) { player.connected = false; player.socketId = null; room.message = `${player.name} hat die Verbindung verloren. Die Sitzung bleibt gespeichert.`; broadcast(room); }
    if ([...room.players.values()].every(p => !p.connected)) saveRooms();
  });
});
server.listen(PORT, () => console.log(`Layers Dice läuft auf Port ${PORT}`));
