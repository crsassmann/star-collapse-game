(() => {
  const GRID_W = 15;
  const GRID_H = 15;
  const CELL = 28;
  const GAP = 2;
  const PAD = 18;

  const COLORS = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0x9b59b6, 0xecf0f1];

  const root = document.getElementById("root");
  const app = new PIXI.Application({
    backgroundColor: 0x0b1020,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    resizeTo: root,
  });
  root.appendChild(app.view);

  const gridPixelW = GRID_W * CELL + (GRID_W - 1) * GAP + PAD * 2;
  const gridPixelH = GRID_H * CELL + (GRID_H - 1) * GAP + PAD * 2;

  const world = new PIXI.Container();
  app.stage.addChild(world);

  const panel = new PIXI.Container();
  world.addChild(panel);

  const ui = new PIXI.Container();
  world.addChild(ui);

  const title = new PIXI.Text("Star Removal", {
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    fontSize: 22,
    fill: 0xe8ecff,
    letterSpacing: 1,
  });
  title.anchor.set(0.5, 0);
  ui.addChild(title);

  const hint = new PIXI.Text("Tap once to select a group, tap again to remove.", {
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    fontSize: 14,
    fill: 0xaab3d6,
  });
  hint.anchor.set(0.5, 0);
  ui.addChild(hint);

  let nextId = 1;
  const makeId = () => nextId++;

  const textures = COLORS.map((c) => {
    const g = new PIXI.Graphics();
    const r = Math.max(4, Math.floor(CELL * 0.2));
    g.beginFill(c);
    g.drawRoundedRect(0, 0, CELL, CELL, r);
    g.endFill();
    g.lineStyle(2, 0xffffff, 0.12);
    g.drawRoundedRect(1, 1, CELL - 2, CELL - 2, r - 1);
    return app.renderer.generateTexture(g);
  });

  const outlineTex = (() => {
    const g = new PIXI.Graphics();
    const r = Math.max(4, Math.floor(CELL * 0.2));
    g.lineStyle(3, 0xffffff, 0.8);
    g.drawRoundedRect(2, 2, CELL - 4, CELL - 4, r - 2);
    return app.renderer.generateTexture(g);
  })();

  const toKey = (c, r) => `${c},${r}`;

  const state = {
    grid: [],
    sprites: new Map(),
    selected: new Set(),
    selectedColor: null,
    selectedSize: 0,
    removing: false,
  };

  function gridToWorld(c, r) {
    return {
      x: PAD + c * (CELL + GAP),
      y: PAD + r * (CELL + GAP),
    };
  }

  function centerWorld() {
    const w = app.renderer.width;
    const h = app.renderer.height;
    world.x = Math.floor((w - gridPixelW) / 2);
    world.y = Math.floor((h - gridPixelH) / 2);
    title.x = Math.floor(w / 2);
    title.y = Math.max(10, world.y - 48);
    hint.x = Math.floor(w / 2);
    hint.y = title.y + 28;
  }

  function buildGrid() {
    state.grid = Array.from({ length: GRID_W }, () => Array(GRID_H).fill(null));
    for (let c = 0; c < GRID_W; c++) {
      for (let r = 0; r < GRID_H; r++) {
        const colorIndex = Math.floor(Math.random() * COLORS.length);
        state.grid[c][r] = { id: makeId(), colorIndex };
      }
    }
  }

  function clearSprites() {
    panel.removeChildren();
    state.sprites.clear();
  }

  function createSprites() {
    clearSprites();
    for (let c = 0; c < GRID_W; c++) {
      for (let r = 0; r < GRID_H; r++) {
        const cell = state.grid[c][r];
        if (!cell) continue;
        const s = new PIXI.Sprite(textures[cell.colorIndex]);
        s.anchor.set(0);
        s.eventMode = "none";
        s.gridCol = c;
        s.gridRow = r;
        const { x, y } = gridToWorld(c, r);
        s.x = x;
        s.y = y;
        s.targetX = x;
        s.targetY = y;
        s.alpha = 1;
        s.scale.set(1);
        s.outline = new PIXI.Sprite(outlineTex);
        s.outline.visible = false;
        s.addChild(s.outline);
        panel.addChild(s);
        state.sprites.set(cell.id, s);
      }
    }
  }

  function isInside(c, r) {
    return c >= 0 && c < GRID_W && r >= 0 && r < GRID_H;
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
      const cur = state.grid[c][r];
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
        const next = state.grid[p.c][p.r];
        if (!next || next.colorIndex !== colorIndex) continue;
        visited.add(k);
        queue.push(p);
      }
    }
    return { colorIndex, cells };
  }

  function clearSelection() {
    for (const k of state.selected) {
      const [cStr, rStr] = k.split(",");
      const c = Number(cStr);
      const r = Number(rStr);
      const cell = state.grid[c][r];
      if (!cell) continue;
      const s = state.sprites.get(cell.id);
      if (!s) continue;
      s.outline.visible = false;
      s.alpha = 1;
      s.scale.set(1);
    }
    state.selected.clear();
    state.selectedColor = null;
    state.selectedSize = 0;
  }

  function applySelection(group) {
    clearSelection();
    if (!group || group.cells.length < 2) return;
    state.selectedColor = group.colorIndex;
    state.selectedSize = group.cells.length;
    for (const p of group.cells) {
      const k = toKey(p.c, p.r);
      state.selected.add(k);
      const cell = state.grid[p.c][p.r];
      if (!cell) continue;
      const s = state.sprites.get(cell.id);
      if (!s) continue;
      s.outline.visible = true;
      s.alpha = 0.86;
      s.scale.set(1.06);
    }
  }

  function removeSelection() {
    if (state.removing) return;
    if (state.selected.size < 2) return;
    state.removing = true;

    const removedIds = [];
    for (const k of state.selected) {
      const [cStr, rStr] = k.split(",");
      const c = Number(cStr);
      const r = Number(rStr);
      const cell = state.grid[c][r];
      if (!cell) continue;
      removedIds.push(cell.id);
      state.grid[c][r] = null;
    }
    state.selected.clear();
    state.selectedColor = null;
    state.selectedSize = 0;

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

  function settleGrid() {
    for (let c = 0; c < GRID_W; c++) {
      const stack = [];
      for (let r = GRID_H - 1; r >= 0; r--) {
        const cell = state.grid[c][r];
        if (cell) stack.push(cell);
      }
      for (let r = GRID_H - 1, i = 0; r >= 0; r--, i++) {
        state.grid[c][r] = stack[i] || null;
      }
    }

    const nonEmptyCols = [];
    for (let c = 0; c < GRID_W; c++) {
      let any = false;
      for (let r = 0; r < GRID_H; r++) {
        if (state.grid[c][r]) {
          any = true;
          break;
        }
      }
      if (any) nonEmptyCols.push(state.grid[c]);
    }
    while (nonEmptyCols.length < GRID_W) nonEmptyCols.push(Array(GRID_H).fill(null));
    state.grid = nonEmptyCols;
  }

  function recalcTargets() {
    for (let c = 0; c < GRID_W; c++) {
      for (let r = 0; r < GRID_H; r++) {
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

  function onCellTap(c, r) {
    if (state.removing) return;
    if (!isInside(c, r)) return;
    const cell = state.grid[c][r];
    if (!cell) return;

    const k = toKey(c, r);
    if (state.selected.has(k)) {
      removeSelection();
      return;
    }
    const group = floodGroup(c, r);
    applySelection(group);
  }

  function tick(dt) {
    let anyFade = false;
    let anyMove = false;

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

    for (const s of panel.children) {
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
    }
  }

  function drawBackdrop() {
    const bg = new PIXI.Graphics();
    bg.beginFill(0x121a33, 0.85);
    bg.drawRoundedRect(0, 0, gridPixelW, gridPixelH, 16);
    bg.endFill();
    bg.lineStyle(2, 0xffffff, 0.08);
    bg.drawRoundedRect(1, 1, gridPixelW - 2, gridPixelH - 2, 16);
    world.addChildAt(bg, 0);

    const gridLines = new PIXI.Graphics();
    gridLines.lineStyle(1, 0xffffff, 0.05);
    const x0 = PAD - GAP / 2;
    const y0 = PAD - GAP / 2;
    const step = CELL + GAP;
    for (let c = 0; c <= GRID_W; c++) {
      const x = x0 + c * step;
      gridLines.moveTo(x, y0);
      gridLines.lineTo(x, y0 + GRID_H * step - GAP);
    }
    for (let r = 0; r <= GRID_H; r++) {
      const y = y0 + r * step;
      gridLines.moveTo(x0, y);
      gridLines.lineTo(x0 + GRID_W * step - GAP, y);
    }
    world.addChildAt(gridLines, 1);
  }

  function start() {
    buildGrid();
    drawBackdrop();
    createSprites();
    recalcTargets();
    centerWorld();
    app.ticker.add(tick);
    window.addEventListener("resize", centerWorld);
    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.stage.on("pointerdown", (e) => {
      if (state.removing) return;
      const p = e.global;
      const local = world.toLocal(p);
      const gx = local.x - PAD;
      const gy = local.y - PAD;
      if (gx < 0 || gy < 0) {
        clearSelection();
        return;
      }
      const step = CELL + GAP;
      const c = Math.floor(gx / step);
      const r = Math.floor(gy / step);
      if (!isInside(c, r)) {
        clearSelection();
        return;
      }
      const rx = gx - c * step;
      const ry = gy - r * step;
      if (rx > CELL || ry > CELL) {
        clearSelection();
        return;
      }
      onCellTap(c, r);
    });
  }

  start();
})();
