import React, { useState, useEffect, useRef } from 'react';
import { Users, Plus, Play, Trophy, Zap, Crown, Copy, Check } from 'lucide-react';

const API_URL = 'https://game40-7qs5.onrender.com';
const WS_URL = 'ws://game40-7qs5.onrender.com';

// Card component
const Card = ({ card, onClick, disabled, selectable }) => {
  const getSuitSymbol = (suit) => {
    const symbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
    return symbols[suit] || '';
  };

  const getSuitColor = (suit) => {
    return suit === 'hearts' || suit === 'diamonds' ? '#ef4444' : '#000';
  };

  return (
    <div
      onClick={!disabled && selectable ? onClick : undefined}
      className={`relative w-20 h-28 rounded-lg border-2 flex flex-col items-center justify-center transition-all ${
        selectable && !disabled
          ? 'cursor-pointer hover:scale-110 hover:-translate-y-2 border-blue-400 shadow-lg shadow-blue-400/50'
          : 'border-gray-600'
      } ${card.rank === 'JOKER' ? 'bg-gradient-to-br from-purple-600 to-pink-600' : 'bg-white'}`}
      style={{
        boxShadow: selectable && !disabled ? '0 0 20px rgba(59, 130, 246, 0.5)' : '0 4px 6px rgba(0,0,0,0.3)'
      }}
    >
      {card.rank === 'JOKER' ? (
        <div className="text-white text-2xl font-bold">🃏</div>
      ) : (
        <>
          <div className="text-2xl font-bold" style={{ color: getSuitColor(card.suit) }}>
            {card.rank}
          </div>
          <div className="text-3xl" style={{ color: getSuitColor(card.suit) }}>
            {getSuitSymbol(card.suit)}
          </div>
          <div className="absolute bottom-1 right-1 text-xs font-bold text-gray-600">
            {card.value}
          </div>
        </>
      )}
    </div>
  );
};

// Player selection modal for Joker
const JokerModal = ({ players, currentPlayer, onSelect, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-8 rounded-xl border-2 border-gray-600 max-w-md w-full">
        <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <Zap className="text-yellow-400" />
          Choose Next Player
        </h3>
        <div className="space-y-3">
          {players
            .filter(p => p.id !== currentPlayer && !p.eliminated)
            .map(player => (
              <button
                key={player.id}
                onClick={() => onSelect(player.id)}
                className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg font-semibold transition-all transform hover:scale-105"
              >
                {player.name}
              </button>
            ))}
        </div>
        <button
          onClick={onClose}
          className="mt-6 w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default function CardGame40() {
  const [gameState, setGameState] = useState('menu');
  const [players, setPlayers] = useState([]);
  const [playerName, setPlayerName] = useState('');
  const [gameCode, setGameCode] = useState('');
  const [gameId, setGameId] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [currentTotal, setCurrentTotal] = useState(0);
  const [currentPlayerId, setCurrentPlayerId] = useState(null);
  const [myCards, setMyCards] = useState([]);
  const [lastCard, setLastCard] = useState(null);
  const [showJokerModal, setShowJokerModal] = useState(false);
  const [pendingJokerCard, setPendingJokerCard] = useState(null);
  const [roundNumber, setRoundNumber] = useState(1);
  const [eliminatedThisRound, setEliminatedThisRound] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const ws = useRef(null);

  // WebSocket connection
  useEffect(() => {
    if (gameId && playerId) {
      ws.current = new WebSocket(`${WS_URL}?gameId=${gameId}&playerId=${playerId}`);
      
      ws.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Received:', data);
        
        switch(data.type) {
          case 'gameState':
            handleGameStateUpdate(data.payload);
            break;
          case 'playerJoined':
            setPlayers(data.payload.players);
            break;
          case 'gameStarted':
            handleGameStarted(data.payload);
            break;
          case 'cardPlayed':
            handleCardPlayed(data.payload);
            break;
          case 'roundEnd':
            handleRoundEnd(data.payload);
            break;
          case 'newRound':
            handleNewRound(data.payload);
            break;
          case 'gameOver':
            handleGameOver(data.payload);
            break;
          case 'error':
            setError(data.message);
            break;
        }
      };

      ws.current.onerror = () => {
        setError('Connection lost. Please refresh.');
      };

      return () => {
        if (ws.current) {
          ws.current.close();
        }
      };
    }
  }, [gameId, playerId]);

  const handleGameStateUpdate = (payload) => {
    setPlayers(payload.players);
    setCurrentTotal(payload.currentTotal);
    setCurrentPlayerId(payload.currentPlayerId);
    setRoundNumber(payload.roundNumber);
    if (payload.lastCard) setLastCard(payload.lastCard);
  };

  const handleGameStarted = (payload) => {
    console.log('Game started with hand:', payload.hand);
    setGameState('playing');
    setPlayers(payload.players);
    setMyCards(payload.hand || []);
    setCurrentTotal(0);
    setCurrentPlayerId(payload.currentPlayerId);
    setRoundNumber(1);
    setLastCard(null);
  };

  const handleCardPlayed = (payload) => {
    setCurrentTotal(payload.currentTotal);
    setCurrentPlayerId(payload.nextPlayerId);
    setLastCard(payload.card);
    
    // Update players (card counts)
    setPlayers(payload.players);
    
    // If I played the card, remove it from my hand
    if (payload.playerId === playerId) {
      setMyCards(prev => prev.filter(c => 
        !(c.rank === payload.card.rank && c.suit === payload.card.suit)
      ));
    }
  };

  const handleRoundEnd = (payload) => {
    console.log('Round ended:', payload);
    setPlayers(payload.players);
    setEliminatedThisRound(payload.eliminatedPlayer);
    setCurrentTotal(0);
    setMyCards([]);
    setGameState('roundEnd');
  };

  const handleNewRound = (payload) => {
    console.log('New round started with hand:', payload.hand);
    setPlayers(payload.players);
    setMyCards(payload.hand || []);
    setCurrentTotal(0);
    setCurrentPlayerId(payload.currentPlayerId);
    setRoundNumber(payload.roundNumber);
    setLastCard(null);
    setEliminatedThisRound(null);
    setGameState('playing');
  };

  const handleGameOver = (payload) => {
    setPlayers(payload.players);
    setGameState('gameOver');
  };

  const createGame = async () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/games/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: playerName.trim() })
      });

      const data = await response.json();
      
      if (data.success) {
        setGameId(data.gameId);
        setPlayerId(data.playerId);
        setGameCode(data.gameCode);
        setPlayers(data.players);
        setIsHost(true);
        setGameState('lobby');
        setError('');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to create game. Make sure the server is running.');
    }
  };

  const joinGame = async () => {
    if (!playerName.trim() || !gameCode.trim()) {
      setError('Please enter your name and game code');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/games/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          gameCode: gameCode.trim().toUpperCase(), 
          playerName: playerName.trim() 
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setGameId(data.gameId);
        setPlayerId(data.playerId);
        setPlayers(data.players);
        setGameState('lobby');
        setError('');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to join game. Check the code and try again.');
    }
  };

  const startGame = async () => {
    if (!isHost) return;
    
    if (players.length < 2) {
      setError('Need at least 2 players to start');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/games/${gameId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId })
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to start game');
    }
  };

  const playCard = async (card) => {
    if (gameState !== 'playing') return;
    if (currentPlayerId !== playerId) return;

    if (card.isJoker) {
      setPendingJokerCard(card);
      setShowJokerModal(true);
      return;
    }

    await executePlayCard(card);
  };

  const executePlayCard = async (card, targetPlayerId = null) => {
    try {
      const response = await fetch(`${API_URL}/api/games/${gameId}/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, card, targetPlayerId })
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to play card');
    }
  };

  const handleJokerSelect = async (targetPlayerId) => {
    setShowJokerModal(false);
    await executePlayCard(pendingJokerCard, targetPlayerId);
    setPendingJokerCard(null);
  };

  const startNewRound = async () => {
    try {
      const response = await fetch(`${API_URL}/api/games/${gameId}/next-round`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId })
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to start new round');
    }
  };

  const copyGameCode = () => {
    navigator.clipboard.writeText(gameCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentPlayer = players.find(p => p.id === currentPlayerId);
  const isMyTurn = currentPlayer && currentPlayer.id === playerId && gameState === 'playing';
  const activePlayers = players.filter(p => !p.eliminated);
  const winner = gameState === 'gameOver' ? activePlayers[0] : null;
  const myPlayer = players.find(p => p.id === playerId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-6xl font-bold mb-2 bg-gradient-to-r from-gray-300 via-white to-gray-300 bg-clip-text text-transparent">
            Card Game 40
          </h1>
          <p className="text-gray-400 text-lg">Don't exceed 40 or you're out!</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="max-w-2xl mx-auto mb-6 bg-red-900/50 border-2 border-red-600 rounded-lg p-4 text-center">
            {error}
          </div>
        )}

        {/* Menu */}
        {gameState === 'menu' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-8 border-2 border-gray-700 shadow-2xl">
              <h2 className="text-3xl font-bold mb-6 text-center">Welcome!</h2>
              
              <div className="mb-6">
                <label className="block text-gray-400 mb-2">Your Name</label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && createGame()}
                  placeholder="Enter your name"
                  className="w-full px-4 py-3 bg-gray-700 border-2 border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-400"
                  maxLength={20}
                />
              </div>

              <button
                onClick={createGame}
                className="w-full py-4 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 rounded-lg font-bold text-xl transition-all mb-4 flex items-center justify-center gap-2"
              >
                <Plus size={24} />
                Create New Game
              </button>

              <div className="flex items-center gap-4 my-6">
                <div className="flex-1 h-px bg-gray-700"></div>
                <span className="text-gray-500">OR</span>
                <div className="flex-1 h-px bg-gray-700"></div>
              </div>

              <div className="mb-4">
                <label className="block text-gray-400 mb-2">Game Code</label>
                <input
                  type="text"
                  value={gameCode}
                  onChange={(e) => setGameCode(e.target.value.toUpperCase())}
                  onKeyPress={(e) => e.key === 'Enter' && joinGame()}
                  placeholder="Enter 6-digit code"
                  className="w-full px-4 py-3 bg-gray-700 border-2 border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-400 uppercase"
                  maxLength={6}
                />
              </div>

              <button
                onClick={joinGame}
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-lg font-bold text-xl transition-all flex items-center justify-center gap-2"
              >
                <Users size={24} />
                Join Game
              </button>
            </div>
          </div>
        )}

        {/* Lobby */}
        {gameState === 'lobby' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-8 border-2 border-gray-700 shadow-2xl">
              <h2 className="text-3xl font-bold mb-6 flex items-center gap-2">
                <Users className="text-blue-400" />
                Game Lobby
              </h2>

              <div className="bg-gray-700 rounded-lg p-6 mb-6 text-center">
                <div className="text-gray-400 mb-2">Game Code</div>
                <div className="flex items-center justify-center gap-3">
                  <div className="text-4xl font-bold tracking-widest">{gameCode}</div>
                  <button
                    onClick={copyGameCode}
                    className="p-2 bg-gray-600 hover:bg-gray-500 rounded-lg transition-all"
                  >
                    {copied ? <Check size={20} /> : <Copy size={20} />}
                  </button>
                </div>
                <div className="text-gray-400 text-sm mt-2">Share this code with other players</div>
              </div>

              <div className="mb-6">
                <div className="text-gray-400 mb-3">
                  Players ({players.length}/13)
                  {isHost && <span className="ml-2 text-yellow-400">👑 You're the host</span>}
                </div>
                <div className="space-y-2">
                  {players.map((player, idx) => (
                    <div key={player.id} className="flex items-center gap-3 bg-gray-700 px-4 py-3 rounded-lg">
                      <div className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-600 rounded-full flex items-center justify-center font-bold">
                        {idx + 1}
                      </div>
                      <span className="flex-1 font-semibold">{player.name}</span>
                      {player.id === playerId && (
                        <span className="text-xs bg-blue-600 px-3 py-1 rounded-full">YOU</span>
                      )}
                      {idx === 0 && (
                        <span className="text-xs bg-yellow-600 px-3 py-1 rounded-full">HOST</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {isHost && (
                <button
                  onClick={startGame}
                  disabled={players.length < 2}
                  className="w-full py-4 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 rounded-lg font-bold text-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Play size={24} />
                  Start Game
                </button>
              )}

              {!isHost && (
                <div className="text-center text-gray-400 py-4">
                  Waiting for host to start the game...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Playing Phase */}
        {(gameState === 'playing' || gameState === 'roundEnd') && (
          <div className="space-y-6">
            {/* Game Info */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 border-2 border-gray-700 text-center">
                <div className="text-gray-400 text-sm mb-1">Round</div>
                <div className="text-4xl font-bold">{roundNumber}</div>
              </div>
              <div className="bg-gradient-to-br from-blue-900 to-blue-800 rounded-xl p-6 border-2 border-blue-600 text-center shadow-lg shadow-blue-900/50">
                <div className="text-blue-200 text-sm mb-1">Current Total</div>
                <div className="text-5xl font-bold">{currentTotal}</div>
                <div className="text-blue-300 text-xs mt-1">/ 40</div>
              </div>
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 border-2 border-gray-700 text-center">
                <div className="text-gray-400 text-sm mb-1">Players Left</div>
                <div className="text-4xl font-bold">{activePlayers.length}</div>
              </div>
            </div>

            {/* Current Turn */}
            {gameState === 'playing' && currentPlayer && (
              <div className={`text-center p-6 rounded-xl border-2 ${
                isMyTurn 
                  ? 'bg-gradient-to-r from-green-900 to-green-800 border-green-600' 
                  : 'bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700'
              }`}>
                <div className="text-2xl font-bold">
                  {isMyTurn ? "🎯 YOUR TURN!" : `⏳ ${currentPlayer.name}'s Turn`}
                </div>
                {lastCard && (
                  <div className="mt-2 text-gray-300">
                    Last card: {lastCard.rank} {lastCard.suit !== 'joker' && `(+${lastCard.value})`}
                  </div>
                )}
              </div>
            )}

            {/* Round End */}
            {gameState === 'roundEnd' && eliminatedThisRound && (
              <div className="bg-gradient-to-br from-red-900 to-red-800 border-2 border-red-600 rounded-xl p-8 text-center">
                <h2 className="text-3xl font-bold mb-4">Round {roundNumber} Complete!</h2>
                <p className="text-xl mb-6">
                  💥 <span className="font-bold">{eliminatedThisRound.name}</span> exceeded 40 and is eliminated!
                </p>
                <p className="text-gray-300 mb-6">{activePlayers.length} players remaining</p>
                {!myPlayer?.eliminated && (
                  <button
                    onClick={startNewRound}
                    className="px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-lg font-bold text-xl transition-all"
                  >
                    Start Next Round
                  </button>
                )}
              </div>
            )}

            {/* My Cards */}
            {!myPlayer?.eliminated && myCards.length > 0 && (
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 border-2 border-gray-700">
                <h3 className="text-xl font-bold mb-4 text-gray-300">Your Hand ({myCards.length} cards)</h3>
                <div className="flex gap-4 justify-center flex-wrap">
                  {myCards.map((card, idx) => (
                    <Card
                      key={`${card.rank}-${card.suit}-${idx}`}
                      card={card}
                      onClick={() => playCard(card)}
                      disabled={!isMyTurn}
                      selectable={isMyTurn}
                    />
                  ))}
                </div>
              </div>
            )}

            {myPlayer?.eliminated && (
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 border-2 border-red-600 text-center">
                <h3 className="text-2xl font-bold text-red-400 mb-2">You've been eliminated</h3>
                <p className="text-gray-400">Watch the remaining players compete!</p>
              </div>
            )}

            {/* Players Status */}
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 border-2 border-gray-700">
              <h3 className="text-xl font-bold mb-4 text-gray-300">Players</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {players.map((player) => (
                  <div
                    key={player.id}
                    className={`p-4 rounded-lg border-2 ${
                      player.eliminated
                        ? 'bg-gray-900 border-gray-700 opacity-50'
                        : currentPlayer?.id === player.id
                        ? 'bg-gradient-to-br from-blue-800 to-blue-700 border-blue-500 ring-2 ring-blue-400'
                        : 'bg-gray-700 border-gray-600'
                    }`}
                  >
                    <div className="font-bold">{player.name}</div>
                    <div className="text-sm text-gray-400">
                      {player.eliminated 
                        ? '❌ Eliminated' 
                        : player.id === playerId 
                        ? '👤 You' 
                        : '✓ Active'}
                    </div>
                    {!player.eliminated && player.cardCount !== undefined && (
                      <div className="text-xs text-gray-500 mt-1">
                        {player.cardCount} {player.cardCount === 1 ? 'card' : 'cards'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Game Over */}
        {gameState === 'gameOver' && winner && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-gradient-to-br from-yellow-900 via-yellow-800 to-yellow-900 rounded-xl p-12 border-2 border-yellow-600 text-center shadow-2xl">
              <Trophy size={80} className="mx-auto mb-6 text-yellow-400" />
              <h2 className="text-5xl font-bold mb-4">🎉 Winner! 🎉</h2>
              <p className="text-3xl mb-8 font-bold">{winner.name}</p>
              {winner.id === playerId && (
                <p className="text-xl mb-8 text-yellow-200">Congratulations! You won!</p>
              )}
              <button
                onClick={() => window.location.reload()}
                className="px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-lg font-bold text-xl transition-all"
              >
                Play Again
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Joker Modal */}
      {showJokerModal && (
        <JokerModal
          players={players}
          currentPlayer={playerId}
          onSelect={handleJokerSelect}
          onClose={() => {
            setShowJokerModal(false);
            setPendingJokerCard(null);
          }}
        />
      )}
    </div>
  );

}
