// Tracks keyboard and mouse state.
//
// Besides raw "is held down" queries we expose edge-triggered lookups
// (pressed/clicked) so gameplay code never has to diff against the previous
// frame. Call endFrame() once per frame to clear those edges.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.justPressed = new Set();
    this.mouse = { x: 0, y: 0, down: false, rightDown: false, clicked: false };

    const scrollKeys = new Set([
      'Space',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]);

    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.justPressed.add(e.code);
      this.down.add(e.code);
      if (scrollKeys.has(e.code)) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => this.down.delete(e.code));

    // Losing focus should not leave keys "stuck" down.
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouse.down = false;
      this.mouse.rightDown = false;
    });

    // Mouse coordinates are kept in CSS pixels to match the render space.
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouse.down = true;
        this.mouse.clicked = true;
      } else if (e.button === 2) {
        // Right button drives the second weapon bank, so it must not open a
        // context menu.
        this.mouse.rightDown = true;
        e.preventDefault();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(code) {
    return this.down.has(code);
  }

  pressed(code) {
    return this.justPressed.has(code);
  }

  anyDown(...codes) {
    return codes.some((code) => this.down.has(code));
  }

  anyPressed(...codes) {
    return codes.some((code) => this.justPressed.has(code));
  }

  /** Clear per-frame edge events. Call at the very end of each frame. */
  endFrame() {
    this.justPressed.clear();
    this.mouse.clicked = false;
  }
}
