const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST||"localhost",
  user: process.env.DB_USER||'root',
  password: process.env.DB_PASSWORD||"",
  database: process.env.DB_NAME||"nidavellir_game40",
  waitForConnections: true,
  connectionLimit: process.env.DB_CONNECTION_LIMIT || 10,
  queueLimit: 0
});

// Store active WebSocket connections with player IDs
const connections = new Map(); // gameId -> Map of playerId -> ws client

// Helper functions
function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];

  suits.forEach(suit => {
    ranks.forEach(rank => {
      let value;
      if (rank === 'A') value = 1;
      else if (rank === 'J' || rank === 'Q' || rank === 'K') value = 0;
      else value = parseInt(rank);
      
      deck.push({ suit, rank, value, isJoker: false });
    });
  });

  deck.push({ rank: 'JOKER', suit: 'joker', value: 0, isJoker: true });
  deck.push({ rank: 'JOKER', suit: 'joker', value: 0, isJoker: true });

  return deck;
}

function shuffle(deck) {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
}

function dealCards(deck, playerCount) {
  const hands = Array(playerCount).fill(null).map(() => []);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < playerCount; j++) {
      if (deck.length > 0) {
        hands[j].push(deck.pop());
      }
    }
  }
  return hands;
}

async function broadcastToGame(gameId, message) {
  const clients = connections.get(gameId);
  if (clients) {
    const messageStr = JSON.stringify(message);
    clients.forEach((ws, playerId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }
}

async function sendToPlayer(gameId, playerId, message) {
  const clients = connections.get(gameId);
  if (clients) {
    const ws = clients.get(playerId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

async function getGameState(gameId) {
  const [games] = await pool.query('SELECT * FROM games WHERE id = ?', [gameId]);
  if (games.length === 0) return null;

  const [players] = await pool.query(
    'SELECT * FROM players WHERE game_id = ? ORDER BY join_order',
    [gameId]
  );

  return {
    game: games[0],
    players: players.map(p => ({
      id: p.id,
      name: p.name,
      eliminated: p.eliminated === 1,
      cards: p.cards ? JSON.parse(p.cards) : [],
      cardCount: p.cards ? JSON.parse(p.cards).length : 0
    }))
  };
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const gameId = parseInt(url.searchParams.get('gameId'));
  const playerId = parseInt(url.searchParams.get('playerId'));

  if (!gameId || !playerId) {
    ws.close();
    return;
  }

  // Add connection to game with player ID mapping
  if (!connections.has(gameId)) {
    connections.set(gameId, new Map());
  }
  connections.get(gameId).set(playerId, ws);

  console.log(`Player ${playerId} connected to game ${gameId}`);

  ws.on('close', () => {
    const clients = connections.get(gameId);
    if (clients) {
      clients.delete(playerId);
      if (clients.size === 0) {
        connections.delete(gameId);
      }
    }
    console.log(`Player ${playerId} disconnected from game ${gameId}`);
  });
});

// API Routes

// Create game
app.post('/api/games/create', async (req, res) => {
  try {
    const { playerName } = req.body;
    
    if (!playerName || playerName.trim().length === 0) {
      return res.json({ success: false, error: 'Player name is required' });
    }

    const gameCode = generateGameCode();
    
    const [result] = await pool.query(
      'INSERT INTO games (game_code, status, current_total, round_number) VALUES (?, ?, ?, ?)',
      [gameCode, 'lobby', 0, 1]
    );

    const gameId = result.insertId;

    const [playerResult] = await pool.query(
      'INSERT INTO players (game_id, name, eliminated, join_order, cards) VALUES (?, ?, ?, ?, ?)',
      [gameId, playerName.trim(), 0, 0, JSON.stringify([])]
    );

    const playerId = playerResult.insertId;

    const state = await getGameState(gameId);

    res.json({
      success: true,
      gameId,
      playerId,
      gameCode,
      players: state.players
    });
  } catch (error) {
    console.error('Create game error:', error);
    res.json({ success: false, error: 'Failed to create game' });
  }
});

// Join game
app.post('/api/games/join', async (req, res) => {
  try {
    const { gameCode, playerName } = req.body;

    if (!gameCode || !playerName) {
      return res.json({ success: false, error: 'Game code and name required' });
    }

    const [games] = await pool.query(
      'SELECT * FROM games WHERE game_code = ?',
      [gameCode.toUpperCase()]
    );

    if (games.length === 0) {
      return res.json({ success: false, error: 'Game not found' });
    }

    const game = games[0];

    if (game.status !== 'lobby') {
      return res.json({ success: false, error: 'Game already started' });
    }

    const [players] = await pool.query(
      'SELECT COUNT(*) as count FROM players WHERE game_id = ?',
      [game.id]
    );

    if (players[0].count >= 13) {
      return res.json({ success: false, error: 'Game is full' });
    }

    const [result] = await pool.query(
      'INSERT INTO players (game_id, name, eliminated, join_order, cards) VALUES (?, ?, ?, ?, ?)',
      [game.id, playerName.trim(), 0, players[0].count, JSON.stringify([])]
    );

    const playerId = result.insertId;

    const state = await getGameState(game.id);

    // Notify all players
    await broadcastToGame(game.id, {
      type: 'playerJoined',
      payload: { players: state.players }
    });

    res.json({
      success: true,
      gameId: game.id,
      playerId,
      players: state.players
    });
  } catch (error) {
    console.error('Join game error:', error);
    res.json({ success: false, error: 'Failed to join game' });
  }
});

// Start game
app.post('/api/games/:gameId/start', async (req, res) => {
  try {
    const { gameId } = req.params;
    const { playerId } = req.body;

    const state = await getGameState(parseInt(gameId));
    
    if (!state) {
      return res.json({ success: false, error: 'Game not found' });
    }

    if (state.players[0].id !== parseInt(playerId)) {
      return res.json({ success: false, error: 'Only host can start' });
    }

    if (state.players.length < 2) {
      return res.json({ success: false, error: 'Need at least 2 players' });
    }

    const deck = shuffle(createDeck());
    const hands = dealCards(deck, state.players.length);

    // Update players with cards
    for (let i = 0; i < state.players.length; i++) {
      await pool.query(
        'UPDATE players SET cards = ? WHERE id = ?',
        [JSON.stringify(hands[i]), state.players[i].id]
      );
    }

    await pool.query(
      'UPDATE games SET status = ?, current_player_id = ?, current_total = ? WHERE id = ?',
      ['playing', state.players[0].id, 0, gameId]
    );

    const newState = await getGameState(parseInt(gameId));

    // Send personalized hands to each player
    for (let i = 0; i < state.players.length; i++) {
      await sendToPlayer(parseInt(gameId), state.players[i].id, {
        type: 'gameStarted',
        payload: {
          players: newState.players.map(p => ({ ...p, cards: [] })), // Don't send other players' cards
          hand: hands[i],
          currentPlayerId: state.players[0].id
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Start game error:', error);
    res.json({ success: false, error: 'Failed to start game' });
  }
});

// Play card
app.post('/api/games/:gameId/play', async (req, res) => {
  try {
    const { gameId } = req.params;
    const { playerId, card, targetPlayerId } = req.body;

    const state = await getGameState(parseInt(gameId));
    
    if (!state || state.game.status !== 'playing') {
      return res.json({ success: false, error: 'Invalid game state' });
    }

    if (state.game.current_player_id !== parseInt(playerId)) {
      return res.json({ success: false, error: 'Not your turn' });
    }

    const player = state.players.find(p => p.id === parseInt(playerId));
    if (!player) {
      return res.json({ success: false, error: 'Player not found' });
    }

    // Remove card from player's hand
    const newCards = player.cards.filter(c => 
      !(c.rank === card.rank && c.suit === card.suit)
    );

    await pool.query(
      'UPDATE players SET cards = ? WHERE id = ?',
      [JSON.stringify(newCards), playerId]
    );

    // Calculate new total
    const newTotal = state.game.current_total + card.value;

    // Log the play
    await pool.query(
      'INSERT INTO game_log (game_id, player_id, card_rank, card_suit, card_value, total_after) VALUES (?, ?, ?, ?, ?, ?)',
      [gameId, playerId, card.rank, card.suit, card.value, newTotal]
    );

    // Check if player busted
    if (newTotal > 40) {
      await pool.query(
        'UPDATE players SET eliminated = 1, cards = ? WHERE id = ?',
        [JSON.stringify([]), playerId]
      );

      await pool.query(
        'UPDATE players SET cards = ? WHERE game_id = ?',
        [JSON.stringify([]), gameId]
      );

      await pool.query(
        'UPDATE games SET current_total = ?, status = ? WHERE id = ?',
        [0, 'roundEnd', gameId]
      );

      const updatedState = await getGameState(parseInt(gameId));
      const activePlayers = updatedState.players.filter(p => !p.eliminated);

      if (activePlayers.length === 1) {
        await pool.query(
          'UPDATE games SET status = ? WHERE id = ?',
          ['finished', gameId]
        );

        await broadcastToGame(parseInt(gameId), {
          type: 'gameOver',
          payload: { players: updatedState.players }
        });
      } else {
        await broadcastToGame(parseInt(gameId), {
          type: 'roundEnd',
          payload: {
            players: updatedState.players.map(p => ({ ...p, cards: [] })),
            eliminatedPlayer: player
          }
        });
      }

      return res.json({ success: true });
    }

    // Determine next player
    let nextPlayerId;
    if (card.isJoker && targetPlayerId) {
      nextPlayerId = parseInt(targetPlayerId);
    } else {
      const activePlayers = state.players.filter(p => !p.eliminated);
      const currentIndex = activePlayers.findIndex(p => p.id === parseInt(playerId));
      const nextIndex = (currentIndex + 1) % activePlayers.length;
      nextPlayerId = activePlayers[nextIndex].id;
    }

    await pool.query(
      'UPDATE games SET current_total = ?, current_player_id = ? WHERE id = ?',
      [newTotal, nextPlayerId, gameId]
    );

    const finalState = await getGameState(parseInt(gameId));

    await broadcastToGame(parseInt(gameId), {
      type: 'cardPlayed',
      payload: {
        playerId: parseInt(playerId),
        card,
        currentTotal: newTotal,
        nextPlayerId,
        players: finalState.players.map(p => ({ ...p, cards: [] })) // Don't send cards
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Play card error:', error);
    res.json({ success: false, error: 'Failed to play card' });
  }
});

// Start next round
app.post('/api/games/:gameId/next-round', async (req, res) => {
  try {
    const { gameId } = req.params;

    const state = await getGameState(parseInt(gameId));
    
    if (!state) {
      return res.json({ success: false, error: 'Game not found' });
    }

    const activePlayers = state.players.filter(p => !p.eliminated);
    
    if (activePlayers.length < 2) {
      return res.json({ success: false, error: 'Not enough players' });
    }

    const deck = shuffle(createDeck());
    const hands = dealCards(deck, activePlayers.length);

    for (let i = 0; i < activePlayers.length; i++) {
      await pool.query(
        'UPDATE players SET cards = ? WHERE id = ?',
        [JSON.stringify(hands[i]), activePlayers[i].id]
      );
    }

    const newRound = state.game.round_number + 1;

    await pool.query(
      'UPDATE games SET status = ?, current_total = ?, current_player_id = ?, round_number = ? WHERE id = ?',
      ['playing', 0, activePlayers[0].id, newRound, gameId]
    );

    const newState = await getGameState(parseInt(gameId));

    // Send personalized hands to each active player
    for (let i = 0; i < activePlayers.length; i++) {
      await sendToPlayer(parseInt(gameId), activePlayers[i].id, {
        type: 'newRound',
        payload: {
          players: newState.players.map(p => ({ ...p, cards: [] })),
          hand: hands[i],
          currentPlayerId: activePlayers[0].id,
          roundNumber: newRound
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Next round error:', error);
    res.json({ success: false, error: 'Failed to start next round' });
  }
});

// Initialize database
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id INT AUTO_INCREMENT PRIMARY KEY,
        game_code VARCHAR(6) UNIQUE NOT NULL,
        status ENUM('lobby', 'playing', 'roundEnd', 'finished') DEFAULT 'lobby',
        current_total INT DEFAULT 0,
        current_player_id INT,
        round_number INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id INT AUTO_INCREMENT PRIMARY KEY,
        game_id INT NOT NULL,
        name VARCHAR(50) NOT NULL,
        eliminated TINYINT DEFAULT 0,
        join_order INT,
        cards JSON,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        game_id INT NOT NULL,
        player_id INT NOT NULL,
        card_rank VARCHAR(10),
        card_suit VARCHAR(10),
        card_value INT,
        total_after INT,
        played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      )
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Start server
const PORT = 3001;
server.listen(PORT, async () => {
  await initDatabase();
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});