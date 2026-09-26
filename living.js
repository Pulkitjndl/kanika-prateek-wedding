/* ============================================================
   LIVING ILLUSTRATIONS
   Turns a still illustration into a gently moving scene:
   - WebGL pass: the painting itself breathes — hanging flowers and
     drapes sway (displacement weighted by a hand-built motion mask),
     clouds drift across the sky only (sky mask), grass ripples in the
     wind, candle flames / fairy lights flicker, lanterns swing.
   - Canvas pass on top: birds that fly *behind* the arch / canopy
     (clipped to the sky mask), falling petals, butterflies, embers,
     flame halos, fireflies, floating motes.
   Falls back to the plain <img> if WebGL or the image can't be used.
   Markup:
     <div class="living" data-living="palace|mandap" data-mask="images/x-mask.png">
       <div class="living-stage">
         <img src="images/x.jpg" width=".." height="..">
         <canvas class="living-gl"></canvas>
         <canvas class="living-fx"></canvas>
       </div>
     </div>
   ============================================================ */
(function(){
  "use strict";
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- tiny helpers ---------- */
  function rand(a,b){ return a + Math.random()*(b-a); }
  function pick(arr){ return arr[(Math.random()*arr.length)|0]; }
  function hash1(n){ var s = Math.sin(n*127.1)*43758.5453; return s - Math.floor(s); }
  function noise1(x){ var i = Math.floor(x), f = x - i, u = f*f*(3-2*f); return hash1(i)*(1-u) + hash1(i+1)*u; }

  /* ---------- scene data (normalised 0..1 image coordinates) ---------- */
  var SCENES = {
    palace: {
      birds: { yMin:.26, yMax:.50, color:'58,46,44', alpha:.78, size:[.010,.017], every:[7,13] },
      lanterns: []
    },
    mandap: {
      birds: { yMin:.04, yMax:.30, color:'34,18,14', alpha:.88, size:[.011,.018], every:[6,11] },
      /* [x, y, anchorX, anchorY] — lantern body centre and the point its chain hangs from */
      lanterns: [
        [.305,.255,.305,.195],[.485,.272,.485,.205],[.660,.255,.660,.195],
        [.486,.370,.486,.300],[.402,.420,.402,.335],[.566,.418,.566,.335]
      ],
      /* candle flames detected from the illustration: [x, y, areaPx] */
      flames: [[.0301,.564,13],[.3125,.6012,9],[.663,.6031,8],[.7514,.6503,8],[.214,.6522,16],[.0075,.6615,8],[.8183,.6724,20],[.034,.7163,60],[.2446,.728,11],[.7614,.7584,19],[.784,.7708,14],[.083,.8518,34],[.0197,.8621,8],[.0263,.8708,57],[.9552,.8702,8],[.96,.8792,48],[.0261,.8828,14],[.9817,.8882,16],[.961,.8903,10],[.0006,.936,22],[.9981,.9404,12]]
    }
  };

  /* ---------- shaders ---------- */
  var VS = 'attribute vec2 p;varying vec2 vUv;void main(){vUv=vec2(p.x*.5+.5,1.-(p.y*.5+.5));gl_Position=vec4(p,0.,1.);}';

  var COMMON = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uImg; uniform sampler2D uMask;',
    'uniform float uT; uniform vec2 uImgPx;',
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x), u.y); }',
    'float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }',
    'float gust(float t){ return .62 + .28*sin(t*.31) + .18*sin(t*.83+1.3) + .1*sin(t*1.9+.4); }'
  ].join('\n');

  var FS = {
    palace: COMMON + [
      'void main(){',
      '  vec2 uv = vUv; float t = uT; float px = 1./uImgPx.x; float g = gust(t);',
      '  float sw = texture2D(uMask, uv).g;',
      /* hanging vines & blossoms: pendulum-like sway, longer strands swing more */
      '  float ph = t*1.15 + uv.y*8. + noise(uv*vec2(7.,3.) + t*.12)*3.2;',
      '  float dx = sw*(sin(ph)*2.6 + sin(ph*1.9 + uv.x*17.)*1.)*g*px;',
      '  float dy = sw*sin(ph*.7 + 2.)*.7*px;',
      '  uv += vec2(dx, dy);',
      '  vec3 col = texture2D(uImg, uv).rgb;',
      '  vec4 m = texture2D(uMask, uv);',
      /* lawn: wind waves rolling across the grass */
      '  float wv = sin((uv.x + uv.y*.35)*30. - t*1.7 + fbm(uv*vec2(7.,18.) + vec2(t*.12,0.))*4.5);',
      '  float grain = fbm(uv*vec2(46.,110.) + vec2(t*.7, 0.)) - .5;',
      '  col *= 1. + m.b*(.05*wv*g + .05*grain);',
      /* drifting clouds, only where the sky is */
      '  vec2 cp = vec2(uv.x*2. - t*.014, uv.y*4.6);',
      '  float c = fbm(cp*1.5) * .78 + fbm(cp*3.2 - vec2(t*.009, 0.) + 5.) * .38;',
      '  float cloud = smoothstep(.46, .78, c) * smoothstep(.12, .3, uv.y);',
      '  float lit = fbm(cp*1.5 - vec2(0., .06));',
      '  vec3 cc = mix(vec3(.84,.79,.79), vec3(1.,.985,.965), smoothstep(.35,.7,lit));',
      '  col = mix(col, cc, cloud*m.r*.72);',
      /* warm light breathing through the arch */
      '  vec2 sp = vec2(.70 + .04*sin(t*.07), .30);',
      '  float gl = exp(-length((uv - sp)*vec2(1.,1.7))*3.6);',
      '  col += vec3(.07,.05,.025)*gl*(.75 + .25*sin(t*.45));',
      /* soft moving light shafts */
      '  float ray = pow(max(0., sin((uv.x*1.2 + uv.y*.55)*9. + t*.12 + fbm(vec2(uv.x*3., t*.05))*2.)), 6.);',
      '  col += vec3(.035,.028,.018)*ray*m.r;',
      '  gl_FragColor = vec4(col, 1.);',
      '}'
    ].join('\n'),

    mandap: COMMON + [
      'uniform vec4 uL[6];',          /* lantern x,y,anchorX,anchorY */
      'void main(){',
      '  vec2 uv = vUv; float t = uT; float px = 1./uImgPx.x; float g = gust(t);',
      '  float asp = uImgPx.y/uImgPx.x;',
      '  float sw = texture2D(uMask, uv).g;',
      /* silk drapes billowing in the evening breeze */
      '  float ph = t*.85 + uv.y*6.5 + uv.x*2.5 + noise(uv*vec2(4.,2.) + t*.08)*2.5;',
      '  uv.x += sw*(sin(ph)*3.4 + sin(t*1.6 + uv.y*12.)*1.1)*g*px;',
      '  uv.y += sw*sin(ph*.6 + 1.)*.9*px;',
      /* lanterns swinging on their chains (rotation about the anchor) */
      '  for(int i=0;i<6;i++){',
      '    vec4 L = uL[i];',
      '    float th = (.045 + .015*sin(float(i)*2.1))*sin(t*(1.05 + float(i)*.07) + float(i)*1.7);',
      '    vec2 d = (uv - L.zw)*vec2(1., asp);',
      '    vec2 lb = (L.xy - L.zw)*vec2(1., asp);',
      '    float len = length(lb) + .05;',
      '    float along = clamp(dot(d, lb)/dot(lb,lb), 0., 1.3);',
      '    float perp = length(d - lb*min(along,1.));',
      '    float w = (1. - smoothstep(.022, .05, perp)) * step(-.01, dot(d, lb)) * (1. - smoothstep(len, len + .03, length(d)));',
      '    float c = cos(-th), s = sin(-th);',
      '    vec2 r = vec2(c*d.x - s*d.y, s*d.x + c*d.y);',
      '    vec2 nuv = L.zw + r/vec2(1., asp);',
      '    uv = mix(uv, nuv, w);',
      '  }',
      '  vec3 col = texture2D(uImg, uv).rgb;',
      '  vec4 m = texture2D(uMask, uv);',
      /* candle flames & fairy lights: each light flickers on its own */
      '  vec2 cell = floor(uv*uImgPx/9.);',
      '  float f = noise(vec2(hash(cell)*91., t*7.5)) * .65 + noise(vec2(hash(cell+3.)*37., t*17.)) * .35;',
      '  float fl = .7 + .6*f;',
      '  col *= 1. + m.b*(fl - 1.)*.75;',
      '  col += m.b*vec3(1.,.55,.2)*max(fl - 1., 0.)*.35;',
      /* lantern glow pulse */
      '  for(int i=0;i<6;i++){',
      '    vec2 q = (uv - uL[i].xy)*vec2(1., asp);',
      '    float pulse = .8 + .2*noise(vec2(float(i)*13., t*3.));',
      '    col += vec3(1.,.72,.38)*exp(-dot(q,q)/.0009)*.10*pulse;',
      '  }',
      /* warm clouds sliding across the sunset */
      '  vec2 cp = vec2(uv.x*2.4 - t*.018, uv.y*5.);',
      '  float c = fbm(cp*1.4)*.8 + fbm(cp*2.9 + vec2(t*.006, 0.) + 7.)*.35;',
      '  float cloud = smoothstep(.48, .8, c);',
      '  float lit = fbm(cp*1.4 + vec2(-.05, .07));',
      '  vec3 cc = mix(vec3(.55,.38,.36), vec3(1.,.78,.58), smoothstep(.3,.72,lit) * (1. - uv.x*.5));',
      '  col = mix(col, cc, cloud*m.r*.5);',
      /* the setting sun breathing behind the hedge */
      '  vec2 sq = (uv - vec2(.112, .392))*vec2(1., asp);',
      '  float sd = length(sq);',
      '  col += vec3(1.,.66,.32)*(exp(-sd*11.)*.16 + exp(-sd*38.)*.18)*(.85 + .15*sin(t*.7));',
      /* sunlight shafts shifting on the aisle */
      '  float fm = smoothstep(.6, .72, uv.y);',
      '  float band = sin((uv.x*.9 - uv.y*1.5)*34. + t*.3 + fbm(uv*5. + t*.04)*3.);',
      '  col *= 1. + fm*.035*band;',
      '  gl_FragColor = vec4(col, 1.);',
      '}'
    ].join('\n')
  };

  /* ============================================================ */
  function Living(el){
    var kind = el.getAttribute('data-living');
    var S = SCENES[kind]; if(!S) return;
    var img = el.querySelector('img');
    var glc = el.querySelector('.living-gl');
    var fx = el.querySelector('.living-fx');
    var ctx = fx.getContext('2d');
    var natW = +img.getAttribute('width'), natH = +img.getAttribute('height');
    var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var gl = null, prog = null, U = {}, glOK = false;
    var skyMask = null;
    var running = false, started = false, last = 0, raf = 0;

    /* ---------- particles ---------- */
    var birds = [], nextFlock = rand(1.5, 4);
    var petals = [], motes = [], butterflies = [], embers = [], flies = [];

    function spawnFlock(t){
      var B = S.birds, dir = Math.random() < .5 ? 1 : -1;
      var n = 2 + ((Math.random()*6)|0);
      var y0 = rand(B.yMin, B.yMax), sp = rand(.035, .06), sz = rand(B.size[0], B.size[1]);
      for(var i=0;i<n;i++){
        var row = Math.ceil(i/2), side = i%2 ? 1 : -1;
        birds.push({
          x: (dir > 0 ? -.06 : 1.06) - dir*row*rand(.035,.05),
          y: y0 + side*row*rand(.012,.02) + rand(-.006,.006),
          vx: dir*sp*rand(.94,1.06), s: sz*rand(.85,1.12),
          ph: rand(0, 6.28), fr: rand(7.5, 10.5), bob: rand(0, 6.28),
          glideAt: t + rand(1, 3), gliding: false
        });
      }
      nextFlock = t + rand(B.every[0], B.every[1]);
    }

    function petalColors(){
      return kind === 'palace' ? ['244,201,211','247,219,224','234,179,194','255,243,243','238,190,204']
                               : ['122,15,28','155,27,42','94,10,20','243,236,224','176,32,48'];
    }
    function spawnPetal(initial){
      var pal = petalColors();
      var p = {
        x: kind === 'palace' ? rand(.08,.92) : rand(.1,.9),
        y: initial ? rand(.1,.95) : (kind === 'palace' ? rand(.12,.38) : rand(.04,.16)),
        vy: rand(.018,.04), vx: rand(-.006,.006),
        rot: rand(0,6.28), vr: rand(-1.2,1.2), flip: rand(0,6.28), vf: rand(1.5,3.2),
        s: rand(.0065,.011), c: pick(pal), a: 0, sw: rand(0,6.28), swA: rand(.008,.02)
      };
      return p;
    }
    function seed(){
      petals = []; motes = []; butterflies = []; embers = []; flies = [];
      var np = kind === 'palace' ? 14 : 12;
      for(var i=0;i<np;i++) petals.push(spawnPetal(true));
      for(var j=0;j<(kind === 'palace' ? 22 : 16);j++){
        motes.push({ x:rand(.1,.9), y:rand(.15,.85), vx:rand(-.004,.004), vy:rand(-.006,-.001), s:rand(.6,1.6), tw:rand(0,6.28) });
      }
      if(kind === 'palace'){
        butterflies.push({ cx:.18, cy:.905, r:.06, ph:rand(0,9), c:'255,246,240', s:.012 });
        butterflies.push({ cx:.80, cy:.9, r:.06, ph:rand(0,9), c:'242,184,198', s:.011 });
        butterflies.push({ cx:.45, cy:.83, r:.12, ph:rand(0,9), c:'255,236,200', s:.0085 });
      } else {
        for(var k=0;k<9;k++){
          var left = k%2 === 0;
          flies.push({ bx: left ? rand(.01,.1) : rand(.9,.99), by: rand(.42,.57), ph: rand(0,50), s: rand(1,2.1) });
        }
      }
    }

    /* ---------- GL ---------- */
    function compile(type, src){
      var sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){ throw new Error(gl.getShaderInfoLog(sh)); }
      return sh;
    }
    function tex(unit, source){
      var t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      return t;
    }
    function setupGL(texImg, maskImg){
      try{
        gl = glc.getContext('webgl', { alpha:true, premultipliedAlpha:false, antialias:false, preserveDrawingBuffer:false });
        if(!gl) return false;
        prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS[kind]));
        gl.linkProgram(prog);
        if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        gl.useProgram(prog);
        var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        tex(0, texImg); tex(1, maskImg);   /* throws SecurityError if tainted (file://) */
        gl.uniform1i(gl.getUniformLocation(prog, 'uImg'), 0);
        gl.uniform1i(gl.getUniformLocation(prog, 'uMask'), 1);
        gl.uniform2f(gl.getUniformLocation(prog, 'uImgPx'), natW, natH);
        U.t = gl.getUniformLocation(prog, 'uT');
        if(S.lanterns.length){
          var arr = [];
          S.lanterns.forEach(function(l){ arr.push(l[0], l[1], l[2], l[3]); });
          gl.uniform4fv(gl.getUniformLocation(prog, 'uL[0]'), new Float32Array(arr));
        }
        return true;
      }catch(e){
        if(window.console) console.warn('[living] WebGL unavailable, using still image:', e.message);
        gl = null; return false;
      }
    }
    function buildSkyMask(maskImg){
      try{
        var c = document.createElement('canvas');
        c.width = maskImg.naturalWidth; c.height = maskImg.naturalHeight;
        var x = c.getContext('2d'); x.drawImage(maskImg, 0, 0);
        var d = x.getImageData(0, 0, c.width, c.height), a = d.data;
        for(var i=0;i<a.length;i+=4){ a[i+3] = a[i]; a[i] = a[i+1] = a[i+2] = 0; }
        x.putImageData(d, 0, 0);
        skyMask = c;
      }catch(e){ skyMask = null; }
    }

    function resize(){
      layout();
      var gd = Math.min(dpr, Math.max(.75, (natW*1.6)/W));
      glc.width = Math.round(W*gd); glc.height = Math.round(H*gd);
      /* keep the fx layer within a sane pixel budget on huge full-bleed stages */
      var fd = Math.min(dpr, Math.sqrt(4.5e6/(W*H)));
      fx.width = Math.round(W*fd); fx.height = Math.round(H*fd);
      ctx.setTransform(fd,0,0,fd,0,0);
      if(gl) gl.viewport(0, 0, glc.width, glc.height);
    }

    /* ---------- cover mode: size the stage to cover its box at the image's own
       aspect ratio (so masks & coordinates stay exact), anchored on a focus point ---------- */
    var stage = el.querySelector('.living-stage');
    var cover = el.classList.contains('cover');
    function focus(){
      var wide = el.offsetWidth > el.offsetHeight;
      var f = (wide && el.getAttribute('data-focus-wide')) || el.getAttribute('data-focus') || '0.5 0.5';
      f = f.split(/\s+/).map(parseFloat); return f;
    }
    function layout(){
      var cw = Math.max(1, el.offsetWidth), ch = Math.max(1, el.offsetHeight);
      if(!cover){ W = cw; H = ch; return; }
      var ar = natW/natH, sw, sh;
      if(cw/ch > ar){ sw = cw; sh = cw/ar; } else { sh = ch; sw = ch*ar; }
      var f = focus();
      stage.style.width = sw + 'px'; stage.style.height = sh + 'px';
      stage.style.left = ((cw - sw)*f[0]) + 'px'; stage.style.top = ((ch - sh)*f[1]) + 'px';
      W = sw; H = sh;
    }

    /* ---------- drawing the fx layer ---------- */
    function drawBird(b, t){
      var x = b.x*W, y = (b.y + Math.sin(t*.9 + b.bob)*.004)*H, s = b.s*W;
      var flap = b.gliding ? .18 + Math.sin(t*2 + b.bob)*.05 : Math.sin(b.ph);
      var ty = -flap*s*.72;
      var dir = b.vx > 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x - s*.5, y - s*.32 + ty*.55, x - s, y + ty);
      ctx.quadraticCurveTo(x - s*.45, y - s*.02 + ty*.4, x, y + s*.14);
      ctx.quadraticCurveTo(x + s*.45, y - s*.02 + ty*.4, x + s, y + ty);
      ctx.quadraticCurveTo(x + s*.5, y - s*.32 + ty*.55, x, y);
      ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + dir*s*.12, y + s*.05, s*.2, s*.08, 0, 0, 6.283); ctx.fill();
    }
    function drawPetal(p){
      var x = p.x*W, y = p.y*H, s = p.s*W;
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
      ctx.scale(1, .18 + .82*Math.abs(Math.cos(p.flip)));
      ctx.globalAlpha = p.a;
      ctx.fillStyle = 'rgba(' + p.c + ',1)';
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s*.9, -s*.6, s*.7, s*.7, 0, s);
      ctx.bezierCurveTo(-s*.7, s*.7, -s*.9, -s*.6, 0, -s);
      ctx.fill();
      ctx.globalAlpha = p.a*.35; ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.beginPath(); ctx.ellipse(-s*.15, -s*.2, s*.18, s*.45, .3, 0, 6.283); ctx.fill();
      ctx.restore();
    }
    function drawButterfly(b, t){
      var tt = t*.35 + b.ph;
      var x = (b.cx + Math.sin(tt*1.3)*b.r*.8 + (noise1(tt*1.7)-.5)*b.r)*W;
      var y = (b.cy + Math.sin(tt*2.1)*.018 + (noise1(tt*2.3+9)-.5)*.03)*H;
      var s = b.s*W, open = Math.abs(Math.sin(t*13 + b.ph));
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(tt*1.3+1.57)*.35);
      ctx.fillStyle = 'rgba(' + b.c + ',.92)';
      [-1,1].forEach(function(sd){
        ctx.save(); ctx.scale(sd*(.25 + .75*open), 1);
        ctx.beginPath(); ctx.ellipse(s*.55, -s*.25, s*.55, s*.42, -.5, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.ellipse(s*.42, s*.28, s*.36, s*.28, .5, 0, 6.283); ctx.fill();
        ctx.restore();
      });
      ctx.fillStyle = 'rgba(70,50,40,.8)';
      ctx.beginPath(); ctx.ellipse(0, 0, s*.07, s*.42, 0, 0, 6.283); ctx.fill();
      ctx.restore();
    }
    function glow(x, y, r, rgb, a){
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
      g.addColorStop(.4, 'rgba(' + rgb + ',' + (a*.35) + ')');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }

    function stepFx(t, dt){
      ctx.clearRect(0, 0, W, H);
      var k = W/natW;

      /* 1. birds — then clip them to the sky so they pass behind the arch/canopy */
      if(t > nextFlock) spawnFlock(t);
      var B = S.birds;
      ctx.fillStyle = 'rgba(' + B.color + ',' + B.alpha + ')';
      for(var i=birds.length-1;i>=0;i--){
        var b = birds[i];
        b.x += b.vx*dt;
        if(t > b.glideAt){ b.gliding = !b.gliding; b.glideAt = t + (b.gliding ? rand(.8,2) : rand(1.4,3.2)); }
        if(!b.gliding) b.ph += b.fr*dt;
        if(b.x < -.15 || b.x > 1.15){ birds.splice(i,1); continue; }
        drawBird(b, t);
      }
      if(skyMask && birds.length){
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(skyMask, 0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      } else if(!skyMask){ ctx.clearRect(0,0,W,H); }

      /* 2. lights (mandap): flame halos, lantern halos, embers, fireflies */
      if(kind === 'mandap'){
        ctx.globalCompositeOperation = 'lighter';
        S.flames.forEach(function(f, idx){
          var fl = .62 + .38*noise1(t*7 + idx*13.7) * (.8 + .2*noise1(t*19 + idx*3));
          var r = (7 + Math.sqrt(f[2])*1.7)*k;
          glow(f[0]*W, f[1]*H - r*.15, r*2.4, '255,164,72', .22*fl);
          glow(f[0]*W, f[1]*H, r*.8, '255,226,160', .28*fl);
          if(Math.random() < dt*.35){
            embers.push({ x:f[0] + rand(-.002,.002), y:f[1] - .006, vy:rand(-.05,-.028), vx:rand(-.004,.004), life:0, max:rand(1.6,3.2), s:rand(.7,1.5), w:rand(0,6) });
          }
        });
        S.lanterns.forEach(function(l, idx){
          var th = (.045 + .015*Math.sin(idx*2.1))*Math.sin(t*(1.05 + idx*.07) + idx*1.7);
          var asp = natH/natW;
          var dx = (l[0]-l[2]), dy = (l[1]-l[3])*asp;
          var rx = Math.cos(th)*dx - Math.sin(th)*dy, ry = Math.sin(th)*dx + Math.cos(th)*dy;
          var lx = (l[2] + rx)*W, ly = (l[3] + ry/asp)*H;
          var p = .8 + .2*noise1(t*3 + idx*13);
          glow(lx, ly, 34*k, '255,196,120', .2*p);
        });
        for(var e=embers.length-1;e>=0;e--){
          var m = embers[e]; m.life += dt;
          if(m.life > m.max){ embers.splice(e,1); continue; }
          m.y += m.vy*dt; m.x += (m.vx + Math.sin(m.life*4 + m.w)*.006)*dt;
          var al = Math.sin(Math.PI*m.life/m.max)*.9;
          glow(m.x*W, m.y*H, m.s*3*k + 1.5, '255,176,90', al);
        }
        flies.forEach(function(f){
          var tt = t*.25 + f.ph;
          var x = (f.bx + (noise1(tt)-.5)*.08)*W, y = (f.by + (noise1(tt*1.3+40)-.5)*.07)*H;
          var a = Math.max(0, Math.sin(t*1.3 + f.ph*3))*.85;
          glow(x, y, f.s*5*k + 2, '255,214,130', a);
        });
        ctx.globalCompositeOperation = 'source-over';
      }

      /* 3. falling petals */
      petals.forEach(function(p, idx){
        p.sw += dt*.9;
        p.y += p.vy*dt; p.x += (p.vx + Math.sin(p.sw)*p.swA)*dt;
        p.rot += p.vr*dt; p.flip += p.vf*dt;
        var fadeIn = Math.min(1, p.a + dt*.6);
        var floor = kind === 'palace' ? .98 : .93;
        p.a = p.y > floor - .05 ? Math.max(0, p.a - dt*.8) : fadeIn*.9;
        if(p.y > floor || p.x < -.05 || p.x > 1.05){ petals[idx] = spawnPetal(false); return; }
        drawPetal(p);
      });
      ctx.globalAlpha = 1;

      /* 4. butterflies (palace) */
      butterflies.forEach(function(b){ drawButterfly(b, t); });

      /* 5. floating motes catching the light */
      ctx.globalCompositeOperation = 'lighter';
      motes.forEach(function(m){
        m.x += m.vx*dt; m.y += m.vy*dt; m.tw += dt*1.6;
        if(m.y < .08){ m.y = .9; m.x = rand(.1,.9); }
        if(m.x < 0) m.x = 1; if(m.x > 1) m.x = 0;
        var a = (.25 + .45*Math.max(0, Math.sin(m.tw)))*(kind === 'palace' ? .7 : .9);
        glow(m.x*W, m.y*H, m.s*3*k + 1, kind === 'palace' ? '255,248,228' : '255,214,150', a);
      });
      ctx.globalCompositeOperation = 'source-over';
    }

    function frame(now){
      if(!running) return;
      var t = now/1000, dt = Math.min(.05, last ? t - last : .016); last = t;
      if(gl){ gl.uniform1f(U.t, t); gl.drawArrays(gl.TRIANGLES, 0, 6); }
      stepFx(t, dt);
      raf = requestAnimationFrame(frame);
    }
    function start(){ if(running || reduce) return; running = true; last = 0; raf = requestAnimationFrame(frame); }
    function stop(){ running = false; cancelAnimationFrame(raf); }

    function load(){
      if(started) return; started = true;
      var texImg = new Image(), maskImg = new Image(), n = 0;
      function done(){
        if(++n < 2) return;
        resize();
        buildSkyMask(maskImg);
        if(setupGL(texImg, maskImg)){
          glOK = true;
          gl.uniform1f(U.t, performance.now()/1000); gl.drawArrays(gl.TRIANGLES, 0, 6);
          el.classList.add('gl-on');
        }
        seed();
        if(visible) start();
      }
      texImg.onload = maskImg.onload = done;
      texImg.onerror = maskImg.onerror = function(){ n = -99; };
      texImg.src = img.currentSrc || img.src;
      maskImg.src = el.getAttribute('data-mask');
    }

    var visible = false;
    layout();
    window.addEventListener('resize', layout);
    if('ResizeObserver' in window){ new ResizeObserver(function(){ if(started) resize(); else layout(); }).observe(el); }
    if(reduce) return; /* still image stays as-is */
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting) load();
      });
    }, { rootMargin:'600px 0px' });
    io.observe(el);
    var io2 = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        visible = en.isIntersecting;
        if(visible && (glOK || n2())) start(); else if(!visible) stop();
      });
    }, { threshold:0 });
    function n2(){ return started && W > 0; }
    io2.observe(el);
    document.addEventListener('visibilitychange', function(){ if(document.hidden) stop(); else if(visible && started) start(); });
    var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(function(){ if(started) resize(); }, 120); });
  }

  function boot(){ Array.prototype.forEach.call(document.querySelectorAll('.living'), Living); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
