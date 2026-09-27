const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto((process.env.STASH_TEST_URL||'http://127.0.0.1:19997')+'/settings?tab=tools');
    const close=page.getByRole('button',{name:'Close',exact:true});
    try {await close.last().waitFor({timeout:3000});await close.last().click();} catch {}
    await page.getByText('Open Marker Compilations',{exact:true}).first().click();
    await page.getByRole('heading',{name:'Marker compilations',exact:true}).waitFor();
    await page.getByRole('button',{name:'Add Long interval',exact:true}).click();
    await page.getByRole('button',{name:'Add Closing clip',exact:true}).click();
    await page.getByLabel(/Compilation name/).fill('Browser integration');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.getByText('Compilation saved.',{exact:true}).waitFor();
    const savedID=await page.getByLabel('Saved compilations').inputValue();
    await page.reload();
    await page.getByRole('heading',{name:'Marker compilations',exact:true}).waitFor();
    await page.getByLabel('Saved compilations').selectOption(savedID);
    await page.getByLabel('Topic / tag').selectOption({label:'Test topic'});
    await page.getByLabel('Search markers').fill('Long interval');
    await page.waitForFunction(()=>document.querySelectorAll('.mc-marker').length===1);
    await page.getByLabel('Search markers').fill('');
    await page.waitForFunction(()=>document.querySelectorAll('.mc-marker').length===2);
    assert.equal(await page.locator('.mc-sequence>li').count(),2);
    await page.getByRole('button',{name:'Move clip 2 up',exact:true}).click();
    assert.match(await page.locator('.mc-sequence>li').first().innerText(),/Closing clip/);
    await page.getByRole('button',{name:'Move clip 1 down',exact:true}).click();
    await page.getByRole('button',{name:'Play sources',exact:true}).click();
    await page.locator('video').waitFor();
    await page.waitForFunction(()=>{let v=document.querySelector('video');return v&&v.currentTime>1&&!v.paused;});
    await page.locator('video').evaluate(v=>{v.currentTime=26.8;});
    await page.waitForFunction(()=>document.querySelector('.mc-player strong').textContent.includes('2 / 2'));
    await page.waitForFunction(()=>{let v=document.querySelector('video');return v&&v.currentTime>=28;});
    await page.getByRole('button',{name:'Close player',exact:true}).click();
    await page.getByText('Full-duration clip cache',{exact:true}).click();
    await page.getByRole('button',{name:'Generate clips',exact:true}).click();
    await page.getByText('Full-duration clips are ready.',{exact:true}).waitFor({timeout:30000});
    await page.getByRole('button',{name:'Play cached clips',exact:true}).click();
    await page.waitForFunction(()=>{let v=document.querySelector('video');return v&&v.currentTime>0&&!v.paused;});
    const duration=await page.locator('video').evaluate(v=>v.duration);
    assert.ok(Math.abs(duration-26)<.15,'Full 26-second interval must survive');
    await page.getByRole('button',{name:'Close player',exact:true}).click();
    await page.getByLabel('End (seconds)',{exact:true}).first().fill('2');
    await page.getByRole('button',{name:'3 normal / 2 slow / 3 normal',exact:true}).first().click();
    await page.getByRole('button',{name:'Generate clips',exact:true}).click();
    await page.getByText('Full-duration clips are ready.',{exact:true}).waitFor({timeout:30000});
    for(const mode of ['Play cached clips','Play sources']) {
      await page.getByRole('button',{name:mode,exact:true}).click();
      const observed=[];
      for(let pass=1;pass<=9;pass++) {
        await page.waitForFunction(n=>document.querySelector('.mc-player strong')?.textContent.startsWith(n+' / 9'),pass,{timeout:5000});
        await page.waitForTimeout(80);
        observed.push(await page.locator('video').evaluate(v=>v.playbackRate));
      }
      assert.deepEqual(observed,[1,1,1,.5,.5,1,1,1,1],mode+' should execute every repetition at the selected speed');
      await page.getByRole('button',{name:'Close player',exact:true}).click();
    }
    await page.getByLabel('Clip 1 phase 1 repeats').fill('2');
    await page.getByLabel('Clip 1 phase 2 speed').selectOption('0.75');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.getByText('Compilation saved.',{exact:true}).waitFor();
    await page.reload();
    await page.getByLabel('Saved compilations').selectOption(savedID);
    assert.equal(await page.getByLabel('Clip 1 phase 1 repeats').inputValue(),'2');
    assert.equal(await page.getByLabel('Clip 1 phase 2 speed').inputValue(),'0.75');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:'.test-runtime/editor.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile page should not overflow');
    await page.screenshot({path:'.test-runtime/mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: actual Stash page, add/save/reorder, source playback/end transition, generation, full-duration cached playback, mobile layout, all repeat/speed phases in both playback modes, custom pattern persistence');
  } catch(e) {
    await page.screenshot({path:'.test-runtime/failure.png',fullPage:true});
    console.error((await page.locator('body').innerText()).slice(-3500));throw e;
  } finally {await browser.close();}
})();
