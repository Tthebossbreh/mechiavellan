// Entry point: grab the canvas, build the game, go.

import { Game } from './game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
game.start();

// Handy for poking at the game from the devtools console.
window.mechiavellan = game;
