const assert = require('node:assert/strict');
const {boot,storage} = require('./smore.cjs');
function start(mode,duo=false) {
  const T=boot(),g=T.Game;
  g.uiTap({action:'start'});
  assert.equal(g.uiTap({action:'mode',value:mode}),true);
  if(duo){g.uiTap({action:'join',player:1});g.uiTap({action:'ready',player:1});}
  g.uiTap({action:'ready',player:0});g.update(T.C.FIXED_DT);g.update(3);
  assert.equal(g.state,'play');assert.equal(g.board.challenge,mode);
  return T;
}
for(const duo of [false,true])for(const mode of ['backrooms','defend','survival']) {
  const T=start(mode,duo);assert.equal(T.Game.board.ships.length,duo?2:1);
}
{
  const T=start('defend'),b=T.Game.board;
  const bomb=()=>{const shot=T.Entities.makeBomb(10,T.C.PLAY_BOTTOM-1,0);shot.alive=true;shot.vy=100;shot.w=8;shot.h=16;b.bombs.push(shot);};
  bomb();T.Game.update(T.C.FIXED_DT);assert.equal(b.baseHealth,11);
  b.clearT=0.001;T.Game.update(T.C.FIXED_DT);assert.equal(b.baseHealth,12,'wave repairs base');
  T.Game.update(3);
  const enemy=b.enemies[0];enemy.x=20;enemy.y=T.C.BUNKER_Y+40;
  T.Game.update(T.C.FIXED_DT);assert.equal(b.baseHealth,9,'breach damages base');assert.equal(enemy.alive,false);
  b.baseHealth=1;bomb();T.Game.update(T.C.FIXED_DT);assert.equal(b.over,true,'destroyed base loses run');
}
{
  const T=start('survival'),b=T.Game.board;
  let repairs=0;T.Entities.resetBunker=()=>{repairs++;};
  b.clearT=0.001;T.Game.update(T.C.FIXED_DT);
  assert.equal(b.wave,2);assert.equal(T.Game.state,'play');assert.equal(repairs,0);
  assert.equal(T.Modes.rules(b).march,0.75);assert.equal(T.Modes.rules(b).fire,0.6);
}
{
  storage.clear();const T=start('backrooms'),b=T.Game.board,B=T.Backrooms;
  // Every generated objective and monster is reachable, even far into a run.
  for(let wave=1;wave<=100;wave++) {
    b.wave=wave;B.enter(b);const r=b.maze,d=B.distances(r,r.start);
    assert.ok(d[r.exit]>0);assert.ok(d[r.terminal]>0);
    for(const fuse of r.fuses)assert.ok(d[fuse.at]>0);
    for(const monster of r.monsters)assert.ok(d[B.tile(monster.x,monster.y)]>0);
    assert.ok(r.monsters.length>=r.goal);
  }
  b.wave=1;B.enter(b);
  const ship=b.ships[0];let r=b.maze;
  Object.assign(ship,B.center(r.exit));T.Game.update(T.C.FIXED_DT);
  assert.equal(b.wave,1,'exit locked before receiving task');
  Object.assign(ship,B.center(r.terminal));T.Game.update(T.C.FIXED_DT);
  assert.equal(r.accepted,true);
  for(const fuse of r.fuses){Object.assign(ship,B.center(fuse.at));T.Game.update(T.C.FIXED_DT);}
  assert.equal(r.collected,3);assert.equal(B.ready(r),false,'kills also required');
  // Fire two real bullets into a monster on an adjacent reachable corridor tile.
  const at=r.start;Object.assign(ship,B.center(at));
  const neighbors=[at+1,at-1,at+B.COLS,at-B.COLS].filter(n=>r.cells[n]===0);
  const destination=B.center(neighbors[0]);const delta={x:Math.sign(destination.x-ship.x),y:Math.sign(destination.y-ship.y)};
  for(const m of r.monsters)m.alive=false;
  const monster=r.monsters[0];Object.assign(monster,destination,{alive:true,hp:2,target:null});
  ship.mazeAim=delta;T.Input={get:()=>({fire:true,axisX:0,axisY:0}),consume(){},anyPressed(){return false;}};
  for(let i=0;i<65;i++)T.Game.update(T.C.FIXED_DT);
  assert.equal(monster.alive,false);assert.equal(r.kills,1);assert.ok(ship.score>=125);
  // Full objective completion moves to a fresh room and grants wave unlocks.
  T.Input=null;
  for(let wave=1;wave<8;wave++) {
    r=b.maze;r.accepted=true;r.collected=r.fuses.length;r.kills=r.goal;
    Object.assign(ship,B.center(r.exit));T.Game.update(T.C.FIXED_DT);
    assert.equal(b.wave,wave+1);assert.equal(b.maze.accepted,false);
    if(b.wave===7)assert.equal(T.Util.isUnlocked('smore'),true);
  }
  // Contact damage and last-life game over are real, not merely visual.
  r=b.maze;ship.lives=1;ship.spawnInvuln=0;
  for(const m of r.monsters)m.alive=false;
  Object.assign(r.monsters[0],{x:ship.x,y:ship.y,alive:true,target:null});
  T.Game.update(T.C.FIXED_DT);assert.equal(ship.dead,true);
  for(let i=0;i<110;i++)T.Game.update(T.C.FIXED_DT);
  assert.equal(b.over,true);
}
console.log('Modes passed: solo/duo startup, base damage/repair/loss, survival rules, 100 reachable mazes, tasks, shooting, room progression, unlocks and death.');

// Repeated firing must use the real audio API and survive unavailable sound.
for (const audioState of ['locked', 'muted', 'unavailable', 'missing']) {
  const T=start('backrooms');
  if(audioState==='muted')T.Audio.setMuted(true);
  if(audioState==='unavailable')T.Audio.unlock(); // No AudioContext in this environment.
  if(audioState==='missing')T.Audio=null;
  let calls=0;
  if(T.Audio) {
    const play=T.Audio.play;
    T.Audio.play=(name,...args)=>{if(name==='shootButter')calls++;return play(name,...args);};
  }
  T.Input={get:()=>({fire:true,axisX:0,axisY:0}),anyPressed:()=>false,consume(){}};
  const room=T.Game.board.maze;
  room.monsters.forEach(m=>{m.alive=false;});
  for(let i=0;i<120;i++)T.Game.update(T.C.FIXED_DT);
  assert.equal(T.Game.state,'play',audioState);
  if(T.Audio)assert.ok(calls>=7,`${audioState}: actual play API reached repeatedly`);
}
console.log('Backrooms audio passed: repeated firing with real audio module locked, muted, unavailable, or absent.');

// Horror variants have distinct art/stats and the mimic really ambushes.
{
  const T=start('backrooms'),B=T.Backrooms,b=T.Game.board,r=b.maze;
  assert.deepEqual([...new Set(r.monsters.map(m=>m.ecotype.id))].sort(),['peeler','wallflower']);
  const artwork=[];
  for(const type of T.C.BACKROOMS_MONSTERS) {
    for(const frame of [0,1]) {
      const sprite=T.Sprites.get(type.sprite+frame);
      assert.equal(sprite.w,40);assert.equal(sprite.h,36);
      artwork.push(JSON.stringify(sprite.canvas.rects));
    }
  }
  assert.equal(new Set(artwork).size,6);
  // An isolated straight hallway gives exact movement/visibility expectations.
  r.cells.fill(1);
  for(let x=1;x<=10;x++)r.cells[B.COLS+x]=0;
  const ship=b.ships[0];Object.assign(ship,B.center(B.COLS+1));ship.mazeAim={x:1,y:0};
  const hooks={hit(){},finishDeath(){},score(){},nextRoom(){}};
  const movements={};
  for(const type of T.C.BACKROOMS_MONSTERS) {
    const monster={...B.center(B.COLS+6),variant:type.id,alive:true,awake:type.id!=='mimic',hp:type.hp,target:null,phase:0};
    r.monsters=[monster];const startX=monster.x;B.update(b,0.1,hooks);
    movements[type.id]=startX-monster.x;
    if(type.id==='mimic') {
      assert.equal(monster.awake,false);assert.equal(monster.x,startX);
      Object.assign(ship,B.center(B.COLS+4));B.update(b,0.1,hooks);
      assert.equal(monster.awake,true);assert.ok(monster.x<startX);
    }
  }
  assert.ok(movements.stalker>movements.furnace);
  Object.assign(ship,B.center(B.COLS+1));
  const target=B.center(B.COLS+5);
  assert.equal(B.hasSight(r,ship.x,ship.y,target.x,target.y),true);
  const lit=B.visibility(r,[ship],target.x,target.y);
  r.cells[B.COLS+3]=1;
  assert.equal(B.hasSight(r,ship.x,ship.y,target.x,target.y),false);
  assert.ok(B.visibility(r,[ship],target.x,target.y)<lit);
  for(const cue of ['mazeHum','mazeHeartbeat','mazeAwake']) {
    assert.equal(T.Audio.has(cue),true);assert.doesNotThrow(()=>T.Audio.play(cue));
  }
}
console.log('Horror variants passed: six sprite poses, distinct speeds/health, dormant mimic activation, wall-blocked flashlight, and audio cue registration.');

// Level themes change geometry and objectives; all tasks can still be completed.
{
  const T=start('backrooms'),b=T.Game.board,B=T.Backrooms;
  const signatures=new Set(),themes=new Set();
  const ctx={globalAlpha:1,beginPath(){},rect(){},clip(){},translate(){},save(){},restore(){},fillRect(){},fillText(){},drawImage(){}};
  const hooks={hit(){},finishDeath(){},score(){},nextRoom(){}};
  for(let level=1;level<=14;level++) {
    b.wave=level;B.enter(b);const r=b.maze;
    themes.add(r.theme.id);signatures.add([...r.cells].join(''));
    assert.equal(r.fuses.length,r.theme.count);
    assert.equal(new Set([r.start,r.terminal,r.exit,...r.fuses.map(f=>f.at)]).size,r.fuses.length+3);
    r.monsters.forEach(m=>{m.alive=false;});
    const ship=b.ships[0];Object.assign(ship,B.center(r.terminal));B.update(b,1/60,hooks);
    for(const item of r.fuses){Object.assign(ship,B.center(item.at));B.update(b,1/60,hooks);}
    assert.equal(r.collected,r.theme.count);r.kills=r.goal;assert.equal(B.ready(r),true);
    assert.doesNotThrow(()=>B.render(ctx,b),r.theme.id+' renderer');
  }
  assert.equal(themes.size,7);assert.equal(signatures.size,14);
}
console.log('Level themes passed: seven environments, fourteen distinct layouts, reachable unique objectives, dynamic task counts and all render paths.');

for (const duo of [false,true]) {
  const T=start('backrooms',duo),b=T.Game.board;
  b.heartsMax=5;
  for(let completed=1;completed<=6;completed++) {
    b.hearts=1;for(const ship of b.ships)ship.lives=1;
    const r=b.maze;r.accepted=true;r.collected=r.fuses.length;r.kills=r.goal;
    for(const m of r.monsters)m.alive=false;
    Object.assign(b.ships[0],T.Backrooms.center(r.exit));T.Game.update(T.C.FIXED_DT);
    assert.equal(b.hearts,completed%3===0?4:1,'restore exactly three hearts every third completed room');
    for(const ship of b.ships)assert.equal(ship.lives,b.hearts);
  }
  b.wave=9;b.hearts=4;for(const ship of b.ships)ship.lives=4;
  const r=b.maze;r.accepted=true;r.collected=r.fuses.length;r.kills=r.goal;
  for(const m of r.monsters)m.alive=false;
  Object.assign(b.ships[0],T.Backrooms.center(r.exit));T.Game.update(T.C.FIXED_DT);
  assert.equal(b.hearts,5,'healing is capped at full health');
}
console.log('Backrooms healing passed: solo and shared co-op, rooms 3/6, exact +3 and health cap.');

// Large maps and independent co-op cameras keep distant players on screen.
for(const duo of [false,true]) {
  const T=start('backrooms',duo),b=T.Game.board,B=T.Backrooms;
  assert.ok(B.COLS*B.ROWS>=21*13*8);
  const art=new Set();
  const ctx={globalAlpha:1,beginPath(){},rect(){},clip(){},translate(){},save(){},restore(){},fillRect(){},fillText(){},drawImage(){}};
  for(let level=1;level<=7;level++) {
    b.wave=level;B.enter(b);
    const r=b.maze,d=B.distances(r,r.start);
    for(let i=0;i<r.cells.length;i++)if(!r.cells[i])assert.ok(d[i]>=0,'all walkable tiles connected');
    assert.equal(new Set(r.monsters.map(m=>m.ecotype.id)).size,2);
    Object.assign(b.ships[b.ships.length-1],B.center(r.exit));
    const views=B.cameraViews(b);assert.equal(views.length,b.ships.length);
    for(let i=0;i<views.length;i++){
      const v=views[i],ship=b.ships[i];
      assert.ok(ship.x>=v.left&&ship.x<=v.left+v.w);
      assert.ok(ship.y>=v.top&&ship.y<=v.top+520);
    }
    assert.doesNotThrow(()=>B.render(ctx,b),'live monster rendering '+r.theme.id);
    for(const ecotype of T.C.BACKROOMS_ECOTYPES[r.theme.id]) {
      const ops=[];
      B.drawCreature({fillRect(...args){ops.push([this.fillStyle,...args]);}},
        {x:0,y:0,phase:0,awake:true,variant:ecotype.base,ecotype},.5);
      art.add(JSON.stringify(ops));
    }
  }
  assert.equal(art.size,14,'every level-specific creature has distinct artwork');
}
console.log('Expanded Backrooms passed: connected 61×37 maps, distant solo/co-op cameras and 14 unique creature designs.');
