/* Endless top-down maze rooms. Generation uses the game's seeded RNG. */
(function (T) {
  'use strict';
  const C = T.C, U = T.Util;
  const COLS = 61, ROWS = 37, CELL = 40, LEFT = 60, TOP = 130;
  const SPEED = C.BACKROOMS_PLAYER_SPEED, RADIUS = 12;
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
  function cellIndex(x,y) { return y * COLS + x; }
  function center(index) { return { x: LEFT + (index % COLS + 0.5) * CELL, y: TOP + (Math.floor(index / COLS) + 0.5) * CELL }; }
  function tile(x,y) { return cellIndex(Math.floor((x-LEFT)/CELL),Math.floor((y-TOP)/CELL)); }
  function walkable(room,x,y) {
    const tx=Math.floor((x-LEFT)/CELL),ty=Math.floor((y-TOP)/CELL);
    return tx>=0 && tx<COLS && ty>=0 && ty<ROWS && room.cells[cellIndex(tx,ty)]===0;
  }
  function canStand(room,x,y,r) {
    return walkable(room,x-r,y-r)&&walkable(room,x+r,y-r)&&walkable(room,x-r,y+r)&&walkable(room,x+r,y+r);
  }
  function move(room,body,dx,dy,r) {
    if(canStand(room,body.x+dx,body.y,r))body.x+=dx;
    if(canStand(room,body.x,body.y+dy,r))body.y+=dy;
  }
  function distances(room,from) {
    const d=new Int16Array(COLS*ROWS);d.fill(-1);d[from]=0;
    const queue=[from];
    for(let head=0;head<queue.length;head++) {
      const index=queue[head],x=index%COLS,y=Math.floor(index/COLS);
      for(const [dx,dy] of DIRS) {
        const nx=x+dx,ny=y+dy,n=cellIndex(nx,ny);
        if(nx<0||nx>=COLS||ny<0||ny>=ROWS||room.cells[n]||d[n]>=0)continue;
        d[n]=d[index]+1;queue.push(n);
      }
    }
    return d;
  }
  function playCue(name) {
    if (T.Audio && typeof T.Audio.play === 'function') T.Audio.play(name);
  }
  function monsterType(monster) {
    const base = C.BACKROOMS_MONSTERS.find(type => type.id === monster.variant) || C.BACKROOMS_MONSTERS[0];
    return monster.ecotype ? {...base, ...monster.ecotype, id: base.id} : base;
  }
  function hasSight(room, ax, ay, bx, by) {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 8);
    for (let i = 1; i < steps; i++) {
      if (!walkable(room, ax + (bx - ax) * i / steps, ay + (by - ay) * i / steps)) return false;
    }
    return true;
  }
  function visibility(room, ships, x, y) {
    let brightness = room.theme ? room.theme.ambient : 0.11;
    for (const ship of ships) {
      const dx = x - ship.x, dy = y - ship.y, distance = Math.hypot(dx, dy);
      // A little spill lights nearby walls; the longer beam cannot see through them.
      if (distance < 65) brightness = Math.max(brightness, 1 - distance / 100);
      if (distance > C.BACKROOMS_LIGHT_WIDTH || !hasSight(room, ship.x, ship.y, x, y)) continue;
      const aim = ship.mazeAim || { x: 0, y: 1 };
      const facing = distance ? (dx * aim.x + dy * aim.y) / distance : 1;
      const beam = facing > 0.65 ? 1 : 0.38;
      brightness = Math.max(brightness, (1 - distance / C.BACKROOMS_LIGHT_WIDTH) * beam);
    }
    return brightness;
  }
  function carveLevel(cells, theme) {
    function open(x, y, w, h) {
      for (let row = y; row < y + h; row++) {
        for (let col = x; col < x + w; col++) cells[cellIndex(col, row)] = 0;
      }
    }
    // Repeating architectural districts span the full map. Carving only removes walls.
    for(let oy=1;oy<ROWS-8;oy+=10)for(let ox=1;ox<COLS-10;ox+=12) {
      if(theme.layout==='pools') {
        open(ox,oy,9,7);
        // Even/even cells were walls in the original maze: preserve them as pillars.
        for(const dx of [3,7])cells[cellIndex(ox+dx,oy+3)]=1;
      } else if(theme.layout==='warehouse'||theme.layout==='garage') {
        open(ox,oy,11,7);
        for(const dx of [3,7])for(const dy of [3,5])cells[cellIndex(ox+dx,oy+dy)]=1;
      } else if(theme.layout==='party') {
        open(ox,oy,7,5);open(ox+4,oy+4,5,3);
      } else if(theme.layout==='cross') {
        open(ox,oy+2,11,1);open(ox+4,oy,5,5);
      } else if(theme.layout==='halls') {
        open(ox,oy+2,11,1);open(ox+6,oy,1,7);
      } else {
        open(ox,oy,3,3);
      }
    }
  }

  function enter(board) {
    const theme = C.BACKROOMS_LEVELS[(board.wave - 1) % C.BACKROOMS_LEVELS.length];
    const cells=new Uint8Array(COLS*ROWS);cells.fill(1);
    const stack=[[1,1]];cells[cellIndex(1,1)]=0;
    while(stack.length) {
      const [x,y]=stack[stack.length-1];
      const choices=DIRS.filter(([dx,dy])=>{
        const nx=x+dx*2,ny=y+dy*2;
        return nx>0&&nx<COLS-1&&ny>0&&ny<ROWS-1&&cells[cellIndex(nx,ny)];
      });
      if(!choices.length){stack.pop();continue;}
      const [dx,dy]=choices[U.randInt(0,choices.length-1)];
      cells[cellIndex(x+dx,y+dy)]=0;cells[cellIndex(x+dx*2,y+dy*2)]=0;
      stack.push([x+dx*2,y+dy*2]);
    }
    carveLevel(cells, theme);
    const room={theme,cells,start:cellIndex(1,1),bullets:[],monsters:[],fuses:[],accepted:false,kills:0,
      humT:2,heartT:0,threat:0,collected:0,goal:Math.min(3+Math.floor(board.wave/3),8),noticeT:0,time:0};
    const d=distances(room,room.start);
    const spaces=[];
    for(let i=0;i<cells.length;i++)if(!cells[i]&&d[i]>5)spaces.push(i);
    spaces.sort((a,b)=>d[b]-d[a]);
    room.exit=spaces.shift();
    room.terminal=cellIndex(3,1);
    // Pick a guaranteed reachable terminal near the entrance, regardless of carving.
    let nearest=Infinity;
    for(let i=0;i<cells.length;i++)if(d[i]>=2&&d[i]<nearest){nearest=d[i];room.terminal=i;}
    for(let i=0;i<theme.count;i++) {
      const at=spaces.splice(Math.floor(spaces.length*(i+1)/(theme.count+1)),1)[0];
      room.fuses.push({at,...center(at),taken:false});
    }
    for(let i=0;i<room.goal+12;i++) {
      const at=spaces.splice(U.randInt(0,spaces.length-1),1)[0];
      const ecology = C.BACKROOMS_ECOTYPES[theme.id];
      const ecotype = ecology[i % ecology.length];
      const type = C.BACKROOMS_MONSTERS.find(t => t.id === ecotype.base);
      room.monsters.push({...center(at),alive:true,hp:ecotype.hp,variant:type.id,ecotype,
        awake:type.id !== 'mimic',phase:i * 0.7,deathT:0,target:null});
    }
    board.maze=room;
    for(const ship of board.ships) {
      ship.mazeAim={x:0,y:1};ship.mazeFireT=0;
      const spawn=center(room.start);ship.x=spawn.x;ship.y=spawn.y;
    }
    board.bombs.length=0;
  }
  function ready(room) { return room.accepted&&room.collected===room.fuses.length&&room.kills>=room.goal; }
  function update(board,dt,hooks) {
    const room=board.maze;room.time+=dt;room.noticeT=Math.max(0,room.noticeT-dt);
    for(const ship of board.ships) {
      if(ship.dead) {
        ship.deathT+=dt;
        if(ship.deathT>=C.SHIP_RESPAWN_DELAY) {
          hooks.finishDeath(board,ship);
          if(ship.alive)Object.assign(ship,center(room.start));
        }
      }
      if(!ship.alive||ship.out||ship.down)continue;
      // Shared-heart revival uses the arcade spawn; place it back in the maze.
      if(!canStand(room,ship.x,ship.y,RADIUS))Object.assign(ship,center(room.start));
      ship.spawnInvuln=Math.max(0,(ship.spawnInvuln||0)-dt);
      ship.mazeFireT=Math.max(0,(ship.mazeFireT||0)-dt);
      const p=T.Input&&T.Input.get(ship.slot);
      if(p) {
        let dx=p.axisX||0,dy=p.axisY||0;
        const length=Math.hypot(dx,dy);
        if(length>1){dx/=length;dy/=length;}
        if(length>0.1)ship.mazeAim=Math.abs(dx)>Math.abs(dy)?{x:Math.sign(dx),y:0}:{x:0,y:Math.sign(dy)};
        move(room,ship,dx*SPEED*dt,dy*SPEED*dt,RADIUS);
        if((p.fire||p.firePressed)&&ship.mazeFireT===0) {
          const aim=ship.mazeAim;
          room.bullets.push({x:ship.x,y:ship.y,dx:aim.x,dy:aim.y,life:C.BACKROOMS_SHOT_LIFE,owner:ship});
          ship.mazeFireT=C.BACKROOMS_FIRE_DELAY;
          playCue('shootButter');
        }
      }
      const at=tile(ship.x,ship.y);
      if(!room.accepted&&at===room.terminal) { room.accepted=true;room.noticeT=3; }
      if (room.accepted) for (const item of room.fuses) {
        if (!item.taken && at === item.at) {
          item.taken = true;
          room.collected++;
          hooks.score(board, ship, 25, ship.x, ship.y);
        }
      }
      if (at === room.exit && ready(room)) { hooks.nextRoom(board); return; }
    }
    if (board.over) return;
    for (const bullet of room.bullets) {
      bullet.life -= dt;
      bullet.x += bullet.dx * C.BACKROOMS_SHOT_SPEED * dt;
      bullet.y += bullet.dy * C.BACKROOMS_SHOT_SPEED * dt;
      if (!walkable(room, bullet.x, bullet.y)) { bullet.life = 0; continue; }
      for (const monster of room.monsters) {
        if (!monster.alive || bullet.life <= 0) continue;
        if (Math.hypot(monster.x - bullet.x, monster.y - bullet.y) < 18) {
          bullet.life = 0;
          monster.hp--;
          if (!monster.awake) { monster.awake = true; playCue('mazeAwake'); }
          if (monster.hp <= 0) {
            monster.alive = false;
            monster.deathT = 2;
            room.kills++;
            hooks.score(board, bullet.owner, monsterType(monster).hp * 25, monster.x, monster.y);
          }
        }
      }
    }
    room.bullets = room.bullets.filter(b => b.life > 0);
    const alive = board.ships.filter(s => s.alive && !s.down && !s.out);
    // Share one BFS per player tile, instead of rebuilding it for every monster.
    const pathKey=alive.map(ship=>tile(ship.x,ship.y)).join(',');
    if(room.pathKey!==pathKey) {
      room.pathKey=pathKey;room.paths=alive.map(ship=>distances(room,tile(ship.x,ship.y)));
    }
    room.threat = 0;
    room.humT -= dt;
    room.heartT = Math.max(0, room.heartT - dt);
    if (room.humT <= 0 && alive.length) { playCue('mazeHum'); room.humT = 6; }
    for (const monster of room.monsters) {
      monster.deathT = Math.max(0, (monster.deathT || 0) - dt);
      if (!monster.alive || !alive.length) continue;
      const type = monsterType(monster);
      if (!monster.awake) {
        for (const ship of alive) {
          if (Math.hypot(ship.x - monster.x, ship.y - monster.y) < C.BACKROOMS_MIMIC_WAKE &&
              hasSight(room, ship.x, ship.y, monster.x, monster.y)) {
            monster.awake = true;
            playCue('mazeAwake');
            break;
          }
        }
        if (!monster.awake) continue;
      }
      for (const ship of alive) {
        const distance = Math.hypot(ship.x - monster.x, ship.y - monster.y);
        if (distance < C.BACKROOMS_THREAT_RADIUS && hasSight(room, ship.x, ship.y, monster.x, monster.y)) {
          room.threat = Math.max(room.threat, 1 - distance / C.BACKROOMS_THREAT_RADIUS);
        }
      }
      if (!monster.target) {
        let path = null, best = Infinity;
        const at = tile(monster.x, monster.y);
        for (const d of room.paths) {
          if (d[at] >= 0 && d[at] < best) { best = d[at]; path = d; }
        }
        if (path && best > 0) {
          const x = at % COLS, y = Math.floor(at / COLS);
          for (const [dx, dy] of DIRS) {
            const n = cellIndex(x + dx, y + dy);
            if (path[n] >= 0 && path[n] < best) { monster.target = center(n); break; }
          }
        }
      }
      const watched=type.anatomy==='watcher' && alive.some(ship=>{
        const dx=monster.x-ship.x,dy=monster.y-ship.y,d=Math.hypot(dx,dy);
        return d<200 && d>0 && (dx*ship.mazeAim.x+dy*ship.mazeAim.y)/d>.8 && hasSight(room,ship.x,ship.y,monster.x,monster.y);
      });
      if (monster.target && !watched) {
        const dx = monster.target.x - monster.x, dy = monster.target.y - monster.y;
        const distance = Math.hypot(dx, dy);
        const step = Math.min(distance, (C.BACKROOMS_MONSTER_SPEED + Math.min(board.wave, 30) * 2) * type.speed * dt);
        if (distance > 0) move(room, monster, dx / distance * step, dy / distance * step, 10);
        if (distance <= step + 0.1) monster.target = null;
      }
      for (const ship of alive) {
        if (ship.alive && Math.hypot(ship.x - monster.x, ship.y - monster.y) < 25 && ship.spawnInvuln <= 0) hooks.hit(board, ship);
      }
    }
    if (room.threat > 0 && room.heartT === 0) {
      playCue('mazeHeartbeat');
      room.heartT = 1.5 - room.threat * 0.65;
    }
  }
  function cameraViews(board) {
    const width=840/board.ships.length;
    const fallback=board.ships.find(s=>s.alive&&!s.down&&!s.out)||board.ships[0];
    return board.ships.map((ship,index)=>{
      const focus=ship.alive&&!ship.down&&!ship.out?ship:fallback;
      return {x:LEFT+index*width,w:width-(index?0:board.ships.length>1?2:0),ship:focus,
        left:U.clamp(focus.x-width/2,LEFT,LEFT+COLS*CELL-width),
        top:U.clamp(focus.y-260,TOP,TOP+ROWS*CELL-520)};
    });
  }
  function drawMap(ctx,board) {
    const room=board.maze,x=LEFT+840-COLS*2-8,y=TOP+520-ROWS*2-8;
    ctx.save();ctx.globalAlpha=.94;ctx.fillStyle='#0b171a';ctx.fillRect(x-4,y-17,COLS*2+8,ROWS*2+21);
    ctx.font='9px monospace';ctx.textAlign='left';ctx.fillStyle='#c6d6c8';ctx.fillText('MAP · YELLOW=TASK',x,y-6);
    ctx.fillStyle='#465954';
    for(let i=0;i<room.cells.length;i++)if(!room.cells[i])ctx.fillRect(x+i%COLS*2,y+Math.floor(i/COLS)*2,2,2);
    const dot=(at,color,size=3)=>{ctx.fillStyle=color;ctx.fillRect(x+(at%COLS)*2,y+Math.floor(at/COLS)*2,size,size);};
    dot(room.terminal,'#ffe46b');
    if(room.accepted)for(const item of room.fuses)if(!item.taken)dot(item.at,room.theme.item);
    dot(room.exit,ready(room)?'#80ffad':'#b18175');
    for(const ship of board.ships)if(ship.alive&&!ship.down&&!ship.out)dot(tile(ship.x,ship.y),ship.slot?'#ff98c2':'#93eaff',4);
    ctx.restore();
  }
  function drawCreature(ctx,monster,time) {
    const t=monsterType(monster),a=t.anatomy;
    const sleeping=!monster.awake;
    const breath=sleeping?0:Math.sin(time*2+monster.phase)*1.2;
    const stride=sleeping?0:Math.sin(time*5*t.speed+monster.phase)*3;
    const x=Math.round(monster.x),y=Math.round(monster.y+breath);
    const r=(color,dx,dy,w,h)=>{ctx.fillStyle=color;ctx.fillRect(Math.round(x+dx),Math.round(y+dy),w,h);};
    // A weighted shadow, shaded metal shell, slots and lever keep the appliance recognizable.
    r('#101817',-19,15,38,6);
    if(!sleeping) {
      if(['spider','crawler','hound','tentacles'].includes(a)) {
        for(const side of [-1,1])for(let n=0;n<3;n++){
          const reach=side*(19+n*3),bend=stride*(n%2?1:-1);
          r('#353f3b',Math.min(side*12,reach),-9+n*7,Math.abs(reach-side*12)+3,3);
          r(t.shell,reach,-9+n*7,3,12+bend);r('#b6b7a0',reach-2,2+n*7+bend,6,2);
        }
      } else {
        for(const side of [-1,1]) {
          const len=a==='longarms'?25:17;
          r('#454a3f',side<0?-22:18,-9,4,len);
          r(t.shell,side<0?-24:20,-5,3,len+stride*side);
          r('#b9b89e',side<0?-26:19,len-5+stride*side,8,3);
        }
        r('#555d50',-12,12,5,10+stride);r('#a6a892',7,12,4,10-stride);
      }
    }
    const wide=a==='furnace'||a==='cake'?36:30;
    r('#242d29',-wide/2-2,-16,wide+4,31);
    r(t.shell,-wide/2,-17,wide,29);
    r('#c1c4ae',-wide/2+2,-16,wide-5,2);
    r('#a7ad99',-wide/2+2,-13,3,21);
    r('#414b43',wide/2-5,-11,5,23);
    r('#202b26',-11,-14,21,3);r('#e0d5af',-9,-13,17,1);
    r('#2d3631',15,-3,5,3);r('#b8b59e',18,-7,3,8);
    if(sleeping){r('#393f37',-8,4,4,3);r('#babaa1',-7,4,1,1);return;}
    // Irregular seams and a slowly expanding mouth, rather than rapidly flashing frames.
    r('#535c4d',-4,-9,1,7);r('#535c4d',-4,-3,6,1);r('#535c4d',1,-3,1,8);
    const mouth=a==='jaw'||a==='cake'||a==='furnace'?10:6;
    r('#19211c',-10,2,21,mouth);r(t.glow,-8,4,17,2);
    for(let n=-8;n<=8;n+=5){r('#d2c9a8',n,2,2,3);r('#9a9c83',n+1,mouth,2,3);}
    if(a==='watcher'){r('#303b2d',-8,-9,16,9);r('#b8c9a3',-5,-8,10,7);r('#26362a',-1,-7,3,5);}
    else {r('#202b25',-11,-8,8,6);r('#202b25',4,-9,8,6);r(t.glow,-9,-7,4,3);r(t.glow,6,-8,3,3);}
    if(a==='party'||a==='cake') {
      r('#d27686',-11,-24,22,6);r('#d7b478',-7,-29,14,5);r('#89b7a4',-3,-33,6,5);
      r('#dabb9a',-1,-36,2,3);
      if(a==='party'){r('#928768',26,-29,1,32);r('#be7a85',21,-40,12,13);r('#e3b3b0',23,-39,3,5);}
      else {r('#cfa8a0',-18,-2,36,3);r('#c3b8a4',-18,-2,3,8);}
    } else if(a==='hound') {
      r('#566c67',-20,-3,7,15);r('#344a46',14,2,12,10);
      r('#ede4bb',-12,-8,8,5);r('#ede4bb',6,-8,8,5);r('#bbbcaa',17,5,7,2);
    } else if(a==='meter') {
      r('#475f57',-5,-34,10,17);r('#7d9a8b',-10,-41,20,13);r('#1e332d',-7,-38,14,6);r(t.glow,-4,-36,7,2);
    } else if(a==='antenna'||a==='spider') {
      r('#a4ab96',-9,-29,2,12);r('#777f6d',8,-25,2,8);r(t.glow,-11,-31,6,3);
    } else if(a==='furnace') {
      r('#40483d',-5,-26,10,9);r('#9e9175',-6,-26,12,2);r(t.glow,-6,7,13,4);
    } else if(a==='tentacles') {
      for(let n=0;n<3;n++){r('#486d62',-10+n*9,12,3,12+stride);r(t.shell,-10+n*9,23+stride,7,2);}
    }
  }
  function render(ctx, board) {
    const room = board.maze;
    ctx.save();
    ctx.fillStyle = room.theme.bg;
    ctx.fillRect(0, C.PLAY_TOP, C.W, C.H - C.PLAY_TOP);
    const alive = board.ships.filter(s => s.alive && !s.down && !s.out);
    const views = cameraViews(board);
    for(const view of views) {
    ctx.save();ctx.beginPath();ctx.rect(view.x,TOP,view.w,520);ctx.clip();
    ctx.translate(view.x-view.left,TOP-view.top);
    const observers=board.ships.length>1?[view.ship]:alive;
    function light(x, y) { return visibility(room, observers, x, y); }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const px = LEFT + x * CELL, py = TOP + y * CELL;
      if(px+CELL<view.left||px>view.left+view.w||py+CELL<view.top||py>view.top+520)continue;
      ctx.globalAlpha = light(px + 20, py + 20);
      const theme = room.theme;
      const wall = room.cells[cellIndex(x,y)];
      ctx.fillStyle = wall ? theme.wall : theme.floor;
      ctx.fillRect(px,py,CELL,CELL);
      // Stable tile-local details: rendering never consumes the maze RNG.
      const hash = (x * 37 + y * 19 + board.wave * 13) % 23;
      const rect = (color, dx, dy, w, h) => {
        ctx.fillStyle = color; ctx.fillRect(px+dx,py+dy,w,h);
      };
      if (wall) {
        if(theme.id==='fun') {
          rect('#9a573e',0,31,40,9);
          for(let n=4;n<36;n+=10){rect(n%3?'#cd7287':'#6da6b1',n,8,6,7);rect('#e0c18d',n+2,15,1,12);}
          if(hash<8){rect('#dfcc9c',6,19,28,9);rect('#d57480',8,19,24,3);}
        } else if(theme.id==='garage') {
          rect('#3d5553',3,3,34,34);rect('#788983',5,4,4,30);
          rect('#c0a758',0,26,40,6);
          for(let n=0;n<40;n+=10)rect('#273b3a',n,26,5,6);
          rect(hash%2?'#82bca2':'#779ec3',12,5,17,4);
        } else if (theme.id === 'lobby') {
          for(let stripe=5;stripe<38;stripe+=10) {
            rect(theme.detail,stripe,4,1,32);
            rect(theme.edge,stripe-2,10,5,2);rect(theme.edge,stripe-2,26,5,2);
          }
          if(hash<5){rect('#655530',13,12,12,16);rect('#8f7d48',17,9,10,14);}
          rect('#554932',0,35,40,5);rect(theme.edge,0,34,40,1);
        } else if (theme.id === 'warehouse') {
          rect('#626b65',3,3,34,34);rect('#a3aaa0',5,5,4,29);
          rect('#424943',28,7,7,28);rect('#d1b453',4,29,30,4);
          for(let n=5;n<32;n+=8)rect('#333b37',n,29,4,4);
          if(hash<5){rect('#323e3b',13,9,12,12);rect('#bbc8b0',16,12,6,2);}
        } else if (theme.id === 'boiler') {
          rect('#3d3934',2,2,36,36);
          for(const n of [6,23]) {
            rect('#8b7960',n,0,8,40);rect('#baa991',n+1,0,2,40);
            rect('#574d42',n-2,9,12,4);rect('#574d42',n-2,29,12,4);
          }
          if(hash<8){rect('#39433f',12,12,19,20);rect('#b5b69b',16,16,7,7);rect('#7b3426',22,25,5,4);}
        } else if (theme.id === 'electrical') {
          for(let row=0;row<4;row++) {
            rect(theme.detail,0,row*10,40,2);
            for(let col=(row%2)*10;col<40;col+=20)rect(theme.detail,col,row*10,2,10);
          }
          rect('#242a29',4,0,3,40);rect('#ac8755',9,0,2,40);
          if(hash<12){
            rect('#252e2d',15,6,21,29);rect('#738078',17,8,17,24);
            rect('#182a25',20,11,11,7);rect('#d2eaa1',22,13,5,2);
            for(let n=20;n<32;n+=5){rect('#303935',n,23,3,6);rect('#c8a657',n,24,3,2);}
          }
        } else if (theme.id === 'pools') {
          for(let n=0;n<40;n+=10){rect(theme.detail,n,0,1,40);rect(theme.detail,0,n,40,1);}
          rect('#f5fff7',2,2,36,2);rect('#88aaa8',0,36,40,4);
          if(hash<6){rect('#b5cccb',8,8,24,24);rect('#edf8ef',8,8,4,24);rect('#658d91',28,10,4,22);}
        }
        rect(theme.edge,0,0,40,2);
        rect('#242821',38,2,2,38);
        // Recessed light fixtures are attached to solid wall tiles.
        if(hash===8 || hash===19){rect('#41483d',8,4,25,7);rect(theme.id==='pools'?'#edfff8':'#e6dfad',10,5,21,3);}
      } else if(theme.id==='fun') {
        rect('#5f4343',0,0,40,1);
        for(let n=0;n<5;n++)rect(['#dba760','#c77e8f','#6caaa6'][n%3],(hash+n*13)%37,(hash+n*9)%37,3,2);
        if(room.cells[cellIndex(x,y-1)] && hash<12){rect('#ae8d7b',5,1,30,7);rect('#f0d0a7',7,2,26,3);}
      } else if(theme.id==='garage') {
        if(x%3===0){rect('#b5ac77',1,0,2,40);rect('#b5ac77',1,36,36,2);}
        if(y%5===0){rect('#a6b09d',18,7,4,25);rect('#a6b09d',12,13,16,4);}
        if(hash<4){rect('#253839',6,24,25,9);rect('#566765',10,25,12,1);}
      } else if (theme.id === 'pools') {
        for(let n=0;n<40;n+=10){rect('#477f84',n,0,1,40);rect('#477f84',0,n,40,1);}
        const shift=Math.floor(Math.sin(room.time*0.8+x+y)*3);
        rect('#83c6c5',4+shift,10,17,1);rect('#65b4bb',18-shift,29,16,2);
        if(room.cells[cellIndex(x,y-1)]){
          rect('#b6d4cc',0,0,40,3);rect('#8fbbb7',0,5,40,2);rect('#6b9eaa',0,10,40,2);
        }
      } else if (theme.id === 'lobby') {
        for(let n=0;n<8;n++)rect(n%2?'#796a46':'#534931',(n*13+hash)%38,(n*7+hash)%38,2,1);
        if(hash<5){rect('#4d472c',6,15,24,12);rect('#554d31',11,10,16,21);}
      } else {
        rect('#303935',0,0,40,1);rect('#303935',0,0,1,40);
        if(hash<6){rect('#303c3a',8,18,23,9);rect('#7c8b7e',11,20,12,1);}
        if(theme.id==='warehouse') {
          if(x%4===1)rect('#b4aa79',2,4,2,31);
          if(hash===10){rect('#d1c9a7',7,11,9,5);rect('#a09a84',10,17,7,3);}
        } else if(theme.id==='boiler') {
          if(hash<9){rect('#202c29',5,29,30,6);for(let n=7;n<35;n+=5)rect('#667167',n,29,1,6);}
          if(hash===12){rect('#a9a592',8,9,9,5);rect('#756f61',20,25,8,2);}
        } else if(hash<10){rect('#292e2b',3,4,2,16);rect('#292e2b',3,18,9,2);}
      }
    }
    ctx.globalAlpha = 1;
    const terminal = center(room.terminal), exit = center(room.exit);
    ctx.fillStyle = room.accepted ? '#709aa0' : '#ffe46b';
    ctx.fillRect(terminal.x-12,terminal.y-12,24,24);
    ctx.fillStyle = '#27292a';ctx.fillRect(terminal.x-8,terminal.y-8,16,10);
    ctx.fillStyle = ready(room) ? '#80ffad' : '#765e54';ctx.fillRect(exit.x-13,exit.y-16,26,32);
    ctx.fillStyle = '#1c2c24';ctx.fillRect(exit.x-8,exit.y-11,16,24);
      if (room.accepted) for (const item of room.fuses) if (!item.taken) {
      ctx.fillStyle=room.theme.item;
      if (room.theme.id === 'boiler') {
        ctx.fillRect(item.x-10,item.y-3,20,6);ctx.fillRect(item.x-3,item.y-10,6,20);
        ctx.fillStyle='#24414a';ctx.fillRect(item.x-2,item.y-2,4,4);
      } else if (room.theme.id === 'fun' || room.theme.id === 'garage') {
        ctx.fillRect(item.x-10,item.y-7,20,14);ctx.fillStyle='#30413b';
        ctx.fillRect(item.x-7,item.y-3,14,2);ctx.fillRect(item.x-7,item.y+1,8,2);
      } else if (room.theme.id === 'warehouse') {
        ctx.fillRect(item.x-12,item.y-7,24,14);ctx.fillStyle='#292330';
        ctx.fillRect(item.x-7,item.y-3,5,5);ctx.fillRect(item.x+3,item.y-3,5,5);
      } else {
        ctx.fillRect(item.x-5,item.y-10,10,20);ctx.fillStyle='#eefaff';ctx.fillRect(item.x-7,item.y-8,14,4);
      }
    }
    for (const monster of room.monsters) {
      if (!monster.alive) {
        if (monster.deathT > 0) {
          ctx.globalAlpha = monster.deathT / 2;
          ctx.fillStyle = '#a44e27';ctx.fillRect(monster.x-10,monster.y+8,20,5);
          ctx.fillStyle = '#352720';ctx.fillRect(monster.x-6,monster.y+4,14,8);
        }
        continue;
      }
      const type = monsterType(monster);
      const brightness = light(monster.x, monster.y);
      const frame = type.id === 'mimic' ? (monster.awake ? 1 : 0) :
        Math.floor(room.time * 3 + monster.phase) % 2;
      const sprite = T.Sprites.get(type.sprite + frame);
      if(monster.x<view.left-40||monster.x>view.left+view.w+40||monster.y<view.top-50||monster.y>view.top+570)continue;
      ctx.globalAlpha = Math.max(0.10, brightness);
      if(monster.ecotype)drawCreature(ctx,monster,room.time);
      else ctx.drawImage(sprite.canvas, Math.round(monster.x-20), Math.round(monster.y-18),40,36);
      if (brightness > 0.3 && monster.awake) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = type.id === 'furnace' ? '#ffb35c' : '#efb6a0';
        ctx.font = 'bold 9px monospace';ctx.textAlign = 'center';
        ctx.fillText(type.name,monster.x,monster.y-21);
      }
    }
    ctx.globalAlpha=1;ctx.fillStyle='#ffe59b';
    for(const b of room.bullets)ctx.fillRect(b.x-3,b.y-3,6,6);
    for(const ship of alive) {
      ctx.globalAlpha=ship.spawnInvuln>0?0.65:1;
      const row=C.BASE_WEAPONS[ship.kind];
      const name=row.ship+(ship.variant?'~'+ship.variant:'');
      const sprite=T.Sprites.get(name);
      ctx.drawImage(sprite.canvas,ship.x-15,ship.y-12,30,24);
      ctx.fillStyle=ship.slot?'#ff98c2':'#93eaff';
      ctx.fillRect(ship.x+ship.mazeAim.x*18-2,ship.y+ship.mazeAim.y*18-2,4,4);
    }
    ctx.restore();
    if(views.length>1){ctx.fillStyle='#9caa96';ctx.font='bold 11px monospace';ctx.textAlign='left';ctx.fillText('P'+(view.ship.slot+1),view.x+8,TOP+14);}
    }
    drawMap(ctx,board);
    ctx.globalAlpha=1;ctx.textAlign='center';ctx.font='bold 14px monospace';ctx.fillStyle='#fff0b0';
    const task=!room.accepted?room.theme.task+' — FIND THE YELLOW TERMINAL':
      ready(room)?'TASK COMPLETE — FIND THE GREEN EXIT':
      room.theme.collect+' '+room.collected+'/'+room.fuses.length+'  ·  KILL MONSTERS '+Math.min(room.kills,room.goal)+'/'+room.goal;
    ctx.font='bold 12px monospace';
    ctx.fillText('LEVEL '+room.theme.wikiLevel+' — '+room.theme.name+' · ROOM '+board.wave,C.W/2,105);
    ctx.fillText(task,C.W/2,123);
    ctx.font='12px monospace';ctx.fillStyle='#e0d8b7';
    ctx.fillText('MOVE: STICK / D-PAD / WASD   ·   FIRE: A / SPACE   ·   SHOOT IN THE DIRECTION YOU FACE',C.W/2,676);
    ctx.fillStyle = room.threat > 0.2 ? '#e6a28c' : '#a9a184';
    ctx.fillText(room.threat > 0.2 ? 'SOMETHING IS IN THE LIGHT. KEEP MOVING.' :
      room.theme.subtitle,C.W/2,699);
    ctx.restore();
  }
  T.Backrooms={enter,update,render,ready,distances,canStand,center,tile,hasSight,visibility,monsterType,cameraViews,drawCreature,COLS,ROWS};
})(window.T = window.T || {});
