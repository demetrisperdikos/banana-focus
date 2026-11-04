#!/usr/bin/env node
// Real-browser check: the bundled MP3/WAV assets load and decode, and the
// layout holds at 320px, 390px and 1920px with no horizontal overflow.
const path=require('path'), fs=require('fs');
const puppeteer=require(path.join(__dirname,'..','qa','node_modules','puppeteer-core'));
const INDEX='file://'+path.join(__dirname,'..','pomodoro-timer','index.html');
const CHROMIUM=['/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));
let passed=0,failed=0;
const check=(n,c,x)=>{c?(passed++,console.log('  ok  - '+n)):(failed++,console.log('  FAIL- '+n+(x?'  '+x:'')));};
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROMIUM,headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files','--mute-audio']});
  const page=await b.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message||e)));
  await page.setViewport({width:390,height:844});
  await page.goto(INDEX,{waitUntil:'load'});
  await page.waitForSelector('#timer');

  // Audio: construct the real Audio elements and wait for metadata.
  const audio=await page.evaluate(async()=>{
    function load(src){return new Promise(res=>{
      const a=new Audio(src);
      const done=(ok)=>res({src:src,ok:ok,readyState:a.readyState,dur:a.duration});
      a.addEventListener('loadedmetadata',()=>done(true));
      a.addEventListener('error',()=>done(false));
      setTimeout(()=>done(a.readyState>0),4000);
      a.load();
    });}
    const mp3=await load('assets/sounds/alarm.mp3');
    const wav=await load('assets/sounds/alarm.wav');
    const click=await load('assets/sounds/click.mp3');
    return {mp3, wav, click, avail: typeof Audio!=='undefined'};
  });
  check('alarm.mp3 decodes with a real duration', audio.mp3.ok && (audio.mp3.dur>0), JSON.stringify(audio.mp3));
  check('alarm.wav (fallback) decodes', audio.wav.ok && (audio.wav.dur>0), JSON.stringify(audio.wav));
  check('click.mp3 decodes', audio.click.ok && (audio.click.dur>0), JSON.stringify(audio.click));

  // PomodoroAudio wires to real assets without throwing.
  const wired=await page.evaluate(async()=>{
    const app=window.BananaFocus;
    if(!app.audio) return {noAudio:true};
    app.audio.unlock();
    app.audio.playAlarm(); app.audio.playClick();
    await new Promise(r=>setTimeout(r,300));
    return {alarm: !!app.audio._alarm, click: !!app.audio._click,
            alarmSrc:(app.audio._alarm&&app.audio._alarm.src)||'', muted:app.audio.isMuted};
  });
  check('PomodoroAudio binds alarm + click elements', wired.alarm===true && wired.click===true, JSON.stringify(wired));
  check('alarm element points at a real file', /alarm\.(mp3|wav)$/.test(wired.alarmSrc), wired.alarmSrc);

  // Responsive: no horizontal overflow at three widths.
  for(const w of [320,390,1920]){
    await page.setViewport({width:w,height:900});
    await new Promise(r=>setTimeout(r,150));
    const m=await page.evaluate(()=>({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth}));
    check('no horizontal overflow at '+w+'px', m.sw<=m.cw+1, JSON.stringify(m));
  }
  // Timer is readable (>=40px) on a phone.
  await page.setViewport({width:320,height:900});
  const fs2=await page.$eval('#timer',e=>parseFloat(getComputedStyle(e).fontSize));
  check('timer font is large on mobile (>=40px)', fs2>=40, String(fs2));

  check('no page errors', errs.length===0, errs.join(' | '));
  await b.close();
  console.log('\n'+passed+' passed, '+failed+' failed');
  process.exit(failed===0?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
