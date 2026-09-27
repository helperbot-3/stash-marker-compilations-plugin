// Run only against a disposable Stash with the seeded sample markers.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const button=name=>page.getByRole('button',{name,exact:true});
  const combo=name=>page.getByRole('combobox',{name,exact:true});
  const field=name=>page.getByRole('textbox',{name,exact:true});
  const project='Editor integration '+Date.now();
  try {
    await page.goto((process.env.STASH_TEST_URL||'http://127.0.0.1:19997')+'/scenes');
    try {await button('Close').last().waitFor({timeout:1500});await button('Close').last().click();} catch {}
    await page.getByRole('link',{name:'Compilations',exact:true}).click();
    await page.getByRole('tab',{name:'Viewer',exact:true}).waitFor();
    await button('New compilation').click();
    assert.equal(await button('+ Add markers').count(),1);
    await button('+ Add markers').click();
    await combo('Topic / tag').selectOption({label:'Test topic'});
    await page.getByRole('searchbox',{name:'Search markers',exact:true}).fill('Long interval');
    await page.waitForFunction(()=>document.querySelectorAll('.mc-marker').length===1);
    await button('Add Long interval').click();
    await page.getByRole('searchbox',{name:'Search markers',exact:true}).fill('');
    await button('Add Closing clip').click();
    await button('Done').click();
    await field('Compilation name').fill(project);
    const clips=page.locator('.mc-timeline-clip');
    await clips.first().click();
    await field('End').fill('0:02');await field('End').press('Enter');
    await combo('Apply a preset').selectOption('3-2-3');
    await combo('Fine adjustment step').selectOption('0.01');
    await button('Step forward').click();await button('Set start here').click();
    assert.equal(await field('Start').inputValue(),'0:01.01');
    assert.equal(await page.getByRole('dialog').count(),0);
    await button('Jump to end').click();await button('Step backward').click();await button('Set end here').click();
    assert.equal(await field('End').inputValue(),'0:01.99');
    await button('Play range').click();
    await page.waitForFunction(()=>{const v=document.querySelector('.mc-trim-preview video');return v.paused&&Math.abs(v.currentTime-1.99)<.01;});
    await field('Start').fill('0:01');await field('End').fill('0:02');await field('End').press('Enter');
    await clips.first().press('Alt+ArrowRight');
    assert.match(await clips.first().innerText(),/Closing clip/);
    await button('Move clip earlier').click();
    await button('Apply to all clips').click();await clips.nth(1).click();
    assert.equal(await page.getByRole('spinbutton',{name:'Phase 1 repeats',exact:true}).inputValue(),'3');
    await combo('Apply a preset').selectOption('once');
    await button('Save').click();await page.getByText('Compilation saved.',{exact:true}).waitFor();
    await button('Clip cache').click();await button('Generate clips').click();
    await page.getByText('Full-duration clips are ready.',{exact:true}).last().waitFor({timeout:30000});
    await button('Done').click();
    for(const mode of ['cache','source']) {
      await combo('Playback mode').selectOption(mode);await button('Play compilation').click();
      const observed=[];
      for(let pass=1;pass<=9;pass++) {
        await page.getByText(new RegExp('^Pass '+pass+' / 9 ·')).waitFor({timeout:6000});
        observed.push(await page.locator('.mc-video-surface video').evaluate(v=>v.playbackRate));
      }
      assert.deepEqual(observed,[1,1,1,.5,.5,1,1,1,1]);await button('Stop').click();
    }
    await button('Play source preview').click();
    await page.locator('main.mc').press('Space');await button('Pause playback').waitFor();
    assert.equal(await page.locator('.mc-trim-preview video').evaluate(v=>v.paused),true);
    await clips.first().press('Space');assert.equal(await page.locator('.mc-video-surface video').evaluate(v=>v.paused),true);
    await field('Compilation name').press('Space');
    assert.equal(await page.locator('.mc-video-surface video').count(),0,'Typing may stop playback but must not start it');
    await field('Compilation name').fill(project);await button('Save').click();
    await field('Compilation name').fill('Unsaved rename');
    await page.getByRole('tab',{name:'Viewer',exact:true}).click();await button('Keep editing').click();
    assert.equal(await field('Compilation name').inputValue(),'Unsaved rename');
    await page.getByRole('tab',{name:'Viewer',exact:true}).click();await button('Discard edits').click();
    assert.equal(await page.locator('.mc-inspector').count(),0);
    await button(new RegExp('^'+project)).click();
    await page.locator('main.mc').press('Space');await button('Pause playback').waitFor();
    await page.locator('main.mc').press('Space');await button('Resume playback').waitFor();
    await page.reload();await button(new RegExp('^'+project)).click();await button('Edit compilation').click();
    assert.equal(await field('Start').inputValue(),'0:01');
    assert.equal(await combo('Phase 2 speed').inputValue(),'0.5');
    await page.screenshot({path:'.test-runtime/editor.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile page should not overflow');
    assert.equal(await button('+ Add markers').count(),1);
    await page.screenshot({path:'.test-runtime/mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: navigation, viewer, inline trim, timeline, Space shortcut, persistence, playback modes and mobile layout');
  } catch(e) {
    await page.screenshot({path:'.test-runtime/failure.png',fullPage:true});throw e;
  } finally {await browser.close();}
})();
