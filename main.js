(() => {
  const COLORS = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0x9b59b6, 0xecf0f1];
  const SIZE_OPTIONS = [8, 10, 15, 20];

  const root = document.getElementById("root");
  const app = new PIXI.Application({
    backgroundColor: 0x0b1020,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    resizeTo: root,
  });
  root.appendChild(app.view);

  const board = new PIXI.Container();
  const boardChrome = new PIXI.Container();
  const boardPanel = new PIXI.Container();
  board.addChild(boardChrome);
  board.addChild(boardPanel);
  app.stage.addChild(board);

  const hud = new PIXI.Container();
  app.stage.addChild(hud);

  const modal = new PIXI.Container();
  modal.visible = false;
  app.stage.addChild(modal);

  const fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";

  const title = new PIXI.Text("Star Removal", { fontFamily, fontSize: 22, fill: 0xe8ecff, letterSpacing: 1 });
  title.anchor.set(0.5, 0);
  hud.addChild(title);

  const hint = new PIXI.Text("Tap once to select a group, tap again to remove.", {
    fontFamily,
    fontSize: 14,
    fill: 0xaab3d6,
  });
  hint.anchor.set(0.5, 0);
  hud.addChild(hint);

  const scoreText = new PIXI.Text("", { fontFamily, fontSize: 16, fill: 0xe8ecff });
  scoreText.anchor.set(0, 0);
  hud.addChild(scoreText);

  const sizePanel = new PIXI.Container();
  hud.addChild(sizePanel);

  const helpButton = new PIXI.Container();
  helpButton.eventMode = "static";
  helpButton.cursor = "pointer";
  hud.addChild(helpButton);

  const toastLayer = new PIXI.Container();
  hud.addChild(toastLayer);

  let nextId = 1;
  const makeId = () => nextId++;

  const state = {
    config: {
      w: 15,
      h: 15,
      cell: 28,
      gap: 2,
      pad: 18,
      gridPixelW: 0,
      gridPixelH: 0,
    },
    textures: null,
    outlineTex: null,
    grid: [],
    sprites: new Map(),
    selected: new Set(),
    removing: false,
    score: 0,
    removedCount: 0,
    initialCount: 0,
    gameOver: false,
    toast: null,
  };

  const toKey = (c, r) => `${c},${r}`;

  function destroyTextures() {
    if (state.textures) {
      for (const t of state.textures) t.destroy(true);
      state.textures = null;
    }
    if (state.outlineTex) {
      state.outlineTex.destroy(true);
      state.outlineTex = null;
    }
  }

  function createTextures() {
    destroyTextures();
    const { cell } = state.config;
    const r = Math.max(4, Math.floor(cell * 0.2));
    state.textures = COLORS.map((c) => {
      const g = new PIXI.Graphics();
      g.beginFill(c);
      g.drawRoundedRect(0, 0, cell, cell, r);
      g.endFill();
      g.lineStyle(Math.max(1, Math.floor(cell * 0.07)), 0xffffff, 0.12);
      g.drawRoundedRect(1, 1, cell - 2, cell - 2, Math.max(2, r - 1));
      return app.renderer.generateTexture(g);
    });

    const outline = new PIXI.Graphics();
    outline.lineStyle(Math.max(2, Math.floor(cell * 0.12)), 0xffffff, 0.8);
    outline.drawRoundedRect(2, 2, cell - 4, cell - 4, Math.max(2, r - 2));
    state.outlineTex = app.renderer.generateTexture(outline);
  }

  function layoutBoardMetrics() {
    const { w, h } = state.config;
    const gap = 2;
    const margin = 20;
    const topUiSpace = 110;
    const maxW = Math.max(240, app.renderer.width - margin * 2);
    const maxH = Math.max(240, app.renderer.height - margin * 2 - topUiSpace);
    const minCell = 16;
    const maxCell = 40;

    let cell = Math.floor(Math.min((maxW - gap * (w - 1)) / w, (maxH - gap * (h - 1)) / h));
    cell = Math.max(minCell, Math.min(maxCell, cell));
    const pad = Math.max(12, Math.floor(cell * 0.6));

    state.config.cell = cell;
    state.config.gap = gap;
    state.config.pad = pad;
    state.config.gridPixelW = w * cell + (w - 1) * gap + pad * 2;
    state.config.gridPixelH = h * cell + (h - 1) * gap + pad * 2;
  }

  function gridToWorld(c, r) {
    const { cell, gap, pad } = state.config;
    return { x: pad + c * (cell + gap), y: pad + r * (cell + gap) };
  }

  function isInside(c, r) {
    const { w, h } = state.config;
    return c >= 0 && c < w && r >= 0 && r < h;
  }

  function clearSelection() {
    for (const k of state.selected) {
      const [cStr, rStr] = k.split(",");
      const c = Number(cStr);
      const r = Number(rStr);
      const cell = state.grid[c]?.[r];
      if (!cell) continue;
      const s = state.sprites.get(cell.id);
      if (!s) continue;
      s.outline.visible = false;
      s.alpha = 1;
      s.scale.set(1);
    }
    state.selected.clear();
  }

  function floodGroup(startC, startR) {
    if (!isInside(startC, startR)) return { colorIndex: null, cells: [] };
    const start = state.grid[startC][startR];
    if (!start) return { colorIndex: null, cells: [] };
    const colorIndex = start.colorIndex;
    const visited = new Set();
    const queue = [{ c: startC, r: startR }];
    visited.add(toKey(startC, startR));
    const cells = [];
    while (queue.length) {
      const { c, r } = queue.shift();
      const cur = state.grid[c]?.[r];
      if (!cur || cur.colorIndex !== colorIndex) continue;
      cells.push({ c, r });
      const n = [
        { c: c + 1, r },
        { c: c - 1, r },
        { c, r: r + 1 },
        { c, r: r - 1 },
      ];
      for (const p of n) {
        if (!isInside(p.c, p.r)) continue;
        const k = toKey(p.c, p.r);
        if (visited.has(k)) continue;
        const next = state.grid[p.c]?.[p.r];
        if (!next || next.colorIndex !== colorIndex) continue;
        visited.add(k);
        queue.push(p);
      }
    }
    return { colorIndex, cells };
  }

  function applySelection(group) {
    clearSelection();
    if (!group || group.cells.length < 2) return;
    for (const p of group.cells) {
      const k = toKey(p.c, p.r);
      state.selected.add(k);
      const cell = state.grid[p.c]?.[p.r];
      if (!cell) continue;
      const s = state.sprites.get(cell.id);
      if (!s) continue;
      s.outline.visible = true;
      s.alpha = 0.86;
      s.scale.set(1.06);
    }
  }

  function hasAnyMoves() {
    const { w, h } = state.config;
    for (let c = 0; c < w; c++) {
      for (let r = 0; r < h; r++) {
        const cell = state.grid[c][r];
        if (!cell) continue;
        const right = c + 1 < w ? state.grid[c + 1][r] : null;
        const down = r + 1 < h ? state.grid[c][r + 1] : null;
        if (right && right.colorIndex === cell.colorIndex) return true;
        if (down && down.colorIndex === cell.colorIndex) return true;
      }
    }
    return false;
  }

  function ratingFor(percentRemoved) {
    if (percentRemoved >= 80) return "Excellent";
    if (percentRemoved >= 60) return "Good";
    if (percentRemoved >= 40) return "Not bad";
    if (percentRemoved >= 20) return "Train Hard";
    return "Keep Trying";
  }

  function showToast(message) {
    if (state.toast) {
      state.toast.container.removeFromParent();
      state.toast = null;
    }

    const c = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.beginFill(0x121a33, 0.92);
    bg.drawRoundedRect(0, 0, 220, 44, 14);
    bg.endFill();
    bg.lineStyle(2, 0xffffff, 0.1);
    bg.drawRoundedRect(1, 1, 218, 42, 14);
    c.addChild(bg);

    const t = new PIXI.Text(message, { fontFamily, fontSize: 18, fill: 0xe8ecff, letterSpacing: 1 });
    t.anchor.set(0.5);
    t.x = 110;
    t.y = 22;
    c.addChild(t);

    c.alpha = 0;
    c.scale.set(0.98);
    toastLayer.addChild(c);
    state.toast = { container: c, t: 0 };
    layoutToast();
  }

  function layoutToast() {
    if (!state.toast) return;
    const w = app.renderer.width;
    state.toast.container.x = Math.floor(w / 2 - state.toast.container.width / 2);
    state.toast.container.y = 62;
  }

  function showGameOver() {
    state.gameOver = true;
    clearSelection();

    const percent = state.initialCount > 0 ? (state.removedCount / state.initialCount) * 100 : 0;
    const rating = ratingFor(percent);

    modal.removeAllListeners();
    modal.removeChildren();
    modal.visible = true;
    modal.eventMode = "static";
    modal.hitArea = app.screen;

    const dim = new PIXI.Graphics();
    dim.beginFill(0x000000, 0.6);
    dim.drawRect(0, 0, app.renderer.width, app.renderer.height);
    dim.endFill();
    modal.addChild(dim);

    const cardW = Math.min(520, app.renderer.width - 36);
    const cardH = 220;
    const card = new PIXI.Graphics();
    card.beginFill(0x121a33, 0.95);
    card.drawRoundedRect(0, 0, cardW, cardH, 16);
    card.endFill();
    card.lineStyle(2, 0xffffff, 0.1);
    card.drawRoundedRect(1, 1, cardW - 2, cardH - 2, 16);
    card.x = Math.floor((app.renderer.width - cardW) / 2);
    card.y = Math.floor((app.renderer.height - cardH) / 2);
    modal.addChild(card);

    const header = new PIXI.Text("Game Over", { fontFamily, fontSize: 20, fill: 0xe8ecff });
    header.anchor.set(0.5, 0);
    header.x = card.x + Math.floor(cardW / 2);
    header.y = card.y + 16;
    modal.addChild(header);

    const body = new PIXI.Text(`Score: ${state.score}\nRemoved: ${Math.round(percent)}%\n${rating}`, {
      fontFamily,
      fontSize: 18,
      fill: 0xaab3d6,
      align: "center",
    });
    body.anchor.set(0.5, 0);
    body.x = header.x;
    body.y = header.y + 48;
    modal.addChild(body);

    const restart = makeButton("Restart", () => startNewGame(state.config.w, { closeModal: true }));
    restart.x = header.x - restart.width / 2;
    restart.y = card.y + cardH - 72;
    modal.addChild(restart);

    const sub = new PIXI.Text("Tap Restart to play again.", {
      fontFamily,
      fontSize: 14,
      fill: 0x7f8bb8,
      align: "center",
    });
    sub.anchor.set(0.5, 0);
    sub.x = header.x;
    sub.y = restart.y + restart.height + 8;
    modal.addChild(sub);
  }

  function hideModal() {
    modal.removeAllListeners();
    modal.visible = false;
    modal.removeChildren();
  }

  function updateScoreText() {
    scoreText.text = `Score: ${state.score}`;
  }

  function settleGrid() {
    const { w, h } = state.config;
    for (let c = 0; c < w; c++) {
      const stack = [];
      for (let r = h - 1; r >= 0; r--) {
        const cell = state.grid[c][r];
        if (cell) stack.push(cell);
      }
      for (let r = h - 1, i = 0; r >= 0; r--, i++) {
        state.grid[c][r] = stack[i] || null;
      }
    }

    const nonEmptyCols = [];
    for (let c = 0; c < w; c++) {
      let any = false;
      for (let r = 0; r < h; r++) {
        if (state.grid[c][r]) {
          any = true;
          break;
        }
      }
      if (any) nonEmptyCols.push(state.grid[c]);
    }

    while (nonEmptyCols.length < w) nonEmptyCols.push(Array(h).fill(null));
    state.grid = nonEmptyCols;
  }

  function recalcTargets() {
    const { w, h } = state.config;
    for (let c = 0; c < w; c++) {
      for (let r = 0; r < h; r++) {
        const cell = state.grid[c][r];
        if (!cell) continue;
        const s = state.sprites.get(cell.id);
        if (!s) continue;
        const { x, y } = gridToWorld(c, r);
        s.targetX = x;
        s.targetY = y;
        s.gridCol = c;
        s.gridRow = r;
      }
    }
  }

  function clearBoardSprites() {
    boardPanel.removeChildren();
    state.sprites.clear();
  }

  function createSprites() {
    clearBoardSprites();
    const { w, h } = state.config;
    for (let c = 0; c < w; c++) {
      for (let r = 0; r < h; r++) {
        const cell = state.grid[c][r];
        if (!cell) continue;
        const s = new PIXI.Sprite(state.textures[cell.colorIndex]);
        s.anchor.set(0);
        s.eventMode = "none";
        const { x, y } = gridToWorld(c, r);
        s.x = x;
        s.y = y;
        s.targetX = x;
        s.targetY = y;
        s.alpha = 1;
        s.scale.set(1);
        s.gridCol = c;
        s.gridRow = r;
        s.outline = new PIXI.Sprite(state.outlineTex);
        s.outline.visible = false;
        s.addChild(s.outline);
        boardPanel.addChild(s);
        state.sprites.set(cell.id, s);
      }
    }
  }

  function drawBoardChrome() {
    boardChrome.removeChildren();

    const { w, h, cell, gap, pad, gridPixelW, gridPixelH } = state.config;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x121a33, 0.85);
    bg.drawRoundedRect(0, 0, gridPixelW, gridPixelH, 16);
    bg.endFill();
    bg.lineStyle(2, 0xffffff, 0.08);
    bg.drawRoundedRect(1, 1, gridPixelW - 2, gridPixelH - 2, 16);
    boardChrome.addChild(bg);

    const gridLines = new PIXI.Graphics();
    gridLines.lineStyle(1, 0xffffff, 0.05);
    const x0 = pad - gap / 2;
    const y0 = pad - gap / 2;
    const step = cell + gap;
    for (let c = 0; c <= w; c++) {
      const x = x0 + c * step;
      gridLines.moveTo(x, y0);
      gridLines.lineTo(x, y0 + h * step - gap);
    }
    for (let r = 0; r <= h; r++) {
      const y = y0 + r * step;
      gridLines.moveTo(x0, y);
      gridLines.lineTo(x0 + w * step - gap, y);
    }
    boardChrome.addChild(gridLines);
  }

  function buildGrid() {
    const { w, h } = state.config;
    state.grid = Array.from({ length: w }, () => Array(h).fill(null));
    for (let c = 0; c < w; c++) {
      for (let r = 0; r < h; r++) {
        const colorIndex = Math.floor(Math.random() * COLORS.length);
        state.grid[c][r] = { id: makeId(), colorIndex };
      }
    }
    state.initialCount = w * h;
    state.removedCount = 0;
  }

  function removeSelection() {
    if (state.removing) return;
    if (state.gameOver) return;
    if (state.selected.size < 2) return;
    state.removing = true;

    const removedIds = [];
    for (const k of state.selected) {
      const [cStr, rStr] = k.split(",");
      const c = Number(cStr);
      const r = Number(rStr);
      const cell = state.grid[c]?.[r];
      if (!cell) continue;
      removedIds.push(cell.id);
      state.grid[c][r] = null;
    }

    const n = removedIds.length;
    state.score += n * n;
    state.removedCount += n;
    updateScoreText();
    clearSelection();

    const threshold = state.config.w;
    const awesomeThreshold = threshold + Math.floor(threshold / 2);
    if (n >= awesomeThreshold) showToast("Awesome!");
    else if (n >= threshold) showToast("Great!");

    for (const id of removedIds) {
      const s = state.sprites.get(id);
      if (!s) continue;
      s.outline.visible = false;
      s.fading = true;
      s.fadeT = 0;
    }

    settleGrid();
    recalcTargets();
  }

  function onCellTap(c, r) {
    if (state.removing || state.gameOver || modal.visible) return;
    if (!isInside(c, r)) return;
    const cell = state.grid[c][r];
    if (!cell) return;

    const k = toKey(c, r);
    if (state.selected.has(k)) {
      removeSelection();
      return;
    }
    applySelection(floodGroup(c, r));
  }

  function centerLayout() {
    const { gridPixelW, gridPixelH } = state.config;
    const w = app.renderer.width;
    const h = app.renderer.height;
    const topUiSpace = 110;
    board.x = Math.floor((w - gridPixelW) / 2);
    board.y = Math.floor((h - gridPixelH) / 2 + topUiSpace / 2);
    title.x = Math.floor(w / 2);
    title.y = 10;
    hint.x = Math.floor(w / 2);
    hint.y = title.y + 28;

    scoreText.x = 16;
    scoreText.y = hint.y + 30;

    const rightMargin = 16;
    sizePanel.x = w - rightMargin;
    sizePanel.y = scoreText.y;

    helpButton.x = w - rightMargin - helpButton.width;
    helpButton.y = 16;

    layoutToast();

    if (modal.visible) {
      showHelpOrGameOverModal(state.gameOver ? "gameOver" : "help");
    }
  }

  function buildSizePanel() {
    sizePanel.removeChildren();
    const buttons = [];
    for (const s of SIZE_OPTIONS) {
      const b = makeButton(`${s}×${s}`, () => startNewGame(s, { closeModal: true }));
      sizePanel.addChild(b);
      buttons.push(b);
    }
    const spacing = 10;
    let y = 0;
    for (const b of buttons) {
      b.x = -b.width;
      b.y = y;
      y += b.height + spacing;
    }
  }

  function drawHelpButton() {
    helpButton.removeChildren();
    const bg = new PIXI.Graphics();
    bg.beginFill(0x121a33, 0.95);
    bg.drawRoundedRect(0, 0, 38, 38, 12);
    bg.endFill();
    bg.lineStyle(2, 0xffffff, 0.1);
    bg.drawRoundedRect(1, 1, 36, 36, 12);
    helpButton.addChild(bg);
    const t = new PIXI.Text("?", { fontFamily, fontSize: 22, fill: 0xe8ecff });
    t.anchor.set(0.5);
    t.x = 19;
    t.y = 19;
    helpButton.addChild(t);

    helpButton.on("pointertap", (e) => {
      e.stopPropagation();
      if (modal.visible && !state.gameOver) {
        hideModal();
      } else {
        showHelpOrGameOverModal("help");
      }
    });
  }

  function makeButton(label, onClick) {
    const c = new PIXI.Container();
    c.eventMode = "static";
    c.cursor = "pointer";

    const bg = new PIXI.Graphics();
    bg.beginFill(0x121a33, 0.95);
    bg.drawRoundedRect(0, 0, 96, 32, 10);
    bg.endFill();
    bg.lineStyle(2, 0xffffff, 0.1);
    bg.drawRoundedRect(1, 1, 94, 30, 10);
    c.addChild(bg);

    const t = new PIXI.Text(label, { fontFamily, fontSize: 14, fill: 0xe8ecff });
    t.anchor.set(0.5);
    t.x = 48;
    t.y = 16;
    c.addChild(t);

    c.on("pointertap", (e) => {
      e.stopPropagation();
      onClick();
    });
    return c;
  }

  function showHelpOrGameOverModal(kind) {
    if (kind === "gameOver") {
      showGameOver();
      return;
    }

    modal.removeAllListeners();
    modal.removeChildren();
    modal.visible = true;
    modal.eventMode = "static";
    modal.hitArea = app.screen;

    modal.on("pointertap", () => {
      hideModal();
    });

    const dim = new PIXI.Graphics();
    dim.beginFill(0x000000, 0.6);
    dim.drawRect(0, 0, app.renderer.width, app.renderer.height);
    dim.endFill();
    modal.addChild(dim);

    const cardW = Math.min(620, app.renderer.width - 36);
    const cardH = kind === "help" ? 320 : 240;
    const card = new PIXI.Graphics();
    card.beginFill(0x121a33, 0.95);
    card.drawRoundedRect(0, 0, cardW, cardH, 16);
    card.endFill();
    card.lineStyle(2, 0xffffff, 0.1);
    card.drawRoundedRect(1, 1, cardW - 2, cardH - 2, 16);
    card.x = Math.floor((app.renderer.width - cardW) / 2);
    card.y = Math.floor((app.renderer.height - cardH) / 2);
    modal.addChild(card);

    if (kind === "help") {
      const header = new PIXI.Text("How to play", { fontFamily, fontSize: 20, fill: 0xe8ecff });
      header.anchor.set(0.5, 0);
      header.x = card.x + Math.floor(cardW / 2);
      header.y = card.y + 16;
      modal.addChild(header);

      const body = new PIXI.Text(
        `- Tap a star group (2+ adjacent same color) to select\n- Tap the same selected group again to remove\n- Stars drop down, then columns slide right-to-left\n\nScore rule:\n- Remove N stars => +N² points\n\nEnd rating (removed %):\n- 80%+ Excellent\n- 60%+ Good\n- 40%+ Not bad\n- 20%+ Train Hard`,
        { fontFamily, fontSize: 14, fill: 0xaab3d6, lineHeight: 20 }
      );
      body.anchor.set(0, 0);
      body.x = card.x + 18;
      body.y = header.y + 44;
      modal.addChild(body);
      return;
    }
  }

  function startNewGame(size, opts = {}) {
    if (opts.closeModal) hideModal();
    state.gameOver = false;
    state.removing = false;
    clearSelection();

    state.config.w = size;
    state.config.h = size;
    state.score = 0;
    updateScoreText();

    layoutBoardMetrics();
    createTextures();
    buildGrid();
    drawBoardChrome();
    createSprites();
    recalcTargets();
    centerLayout();
    updateBoardHitArea();
  }

  function updateBoardHitArea() {
    const { gridPixelW, gridPixelH } = state.config;
    board.eventMode = "static";
    board.hitArea = new PIXI.Rectangle(0, 0, gridPixelW, gridPixelH);
  }

  function onBoardTap(e) {
    if (state.removing || modal.visible || state.gameOver) return;
    const p = e.global;
    const local = board.toLocal(p);
    const { pad, cell, gap } = state.config;
    const gx = local.x - pad;
    const gy = local.y - pad;
    if (gx < 0 || gy < 0) {
      clearSelection();
      return;
    }
    const step = cell + gap;
    const c = Math.floor(gx / step);
    const r = Math.floor(gy / step);
    if (!isInside(c, r)) {
      clearSelection();
      return;
    }
    const rx = gx - c * step;
    const ry = gy - r * step;
    if (rx > cell || ry > cell) {
      clearSelection();
      return;
    }
    onCellTap(c, r);
  }

  function tick(dt) {
    let anyFade = false;
    let anyMove = false;

    if (state.toast) {
      state.toast.t += dt / 60;
      const t = state.toast.t;
      const appear = Math.min(1, t / 0.12);
      const life = 1.2;
      const fade = t > life ? Math.max(0, 1 - (t - life) / 0.25) : 1;
      state.toast.container.alpha = appear * fade;
      state.toast.container.scale.set(0.98 + appear * 0.04);
      state.toast.container.y = 62 - appear * 6;
      if (fade <= 0.001) {
        state.toast.container.removeFromParent();
        state.toast = null;
      }
    }

    for (const [id, s] of state.sprites.entries()) {
      if (s.fading) {
        anyFade = true;
        s.fadeT += dt / 12;
        const t = Math.min(1, s.fadeT);
        s.alpha = 1 - t;
        const sc = 1 - t * 0.35;
        s.scale.set(sc);
        if (t >= 1) {
          s.fading = false;
          s.removeFromParent();
          state.sprites.delete(id);
        }
      }
    }

    for (const s of boardPanel.children) {
      const dx = s.targetX - s.x;
      const dy = s.targetY - s.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > 0.5) {
        anyMove = true;
        const speed = 0.22;
        s.x += dx * speed;
        s.y += dy * speed;
      } else {
        s.x = s.targetX;
        s.y = s.targetY;
      }
    }

    if (state.removing && !anyFade && !anyMove) {
      state.removing = false;
      if (!hasAnyMoves()) showGameOver();
    }
  }

  function init() {
    updateScoreText();
    buildSizePanel();
    drawHelpButton();
    startNewGame(state.config.w, { closeModal: true });
    updateBoardHitArea();
    board.on("pointertap", onBoardTap);

    app.ticker.add(tick);
    window.addEventListener("resize", () => {
      clearSelection();
      layoutBoardMetrics();
      createTextures();
      drawBoardChrome();
      createSprites();
      recalcTargets();
      centerLayout();
      updateBoardHitArea();
    });
  }

  init();
})();
