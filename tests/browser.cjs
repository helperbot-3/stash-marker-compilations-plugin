// Run only against a disposable Stash with the seeded sample markers.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const button=name=>page.getByRole('button',{name,exact:true});
  const combo=name=>page.getByRole('combobox',{name,exact:true});
  try {
    await page.goto((process.env.STASH_TEST_URL||'http://127.0.0.1:19997')+'/marker-compilations');
    const close=button('Close');
    try {await close.last().waitFor({timeout:1500});await close.last().click();} catch {}
    await button('+ Add markers').first().click();
    await combo('Topic / tag').selectOption({label:'Test topic'});
    await page.getByRole('searchbox',{name:'Search markers',exact:true}).fill('Long interval');
    await page.waitForFunction(()=>document.querySelectorAll('.mc-marker').length===1);
    await button('Add Long interval').click();
    await page.getByRole('searchbox',{name:'Search markers',exact:true}).fill('');
    await button('Add Closing clip').click();
    await button('Done').click();
    await page.getByRole('textbox',{name:'Compilation name',exact:true}).fill('Browser integration');
    const clips=page.locator('.mc-timeline-clip');
    await clips.first().click();
    await page.getByRole('textbox',{name:'End (m:ss)',exact:true}).fill('0:02');
    await combo('Apply a preset').selectOption('3-2-3');
    await clips.first().press('Alt+ArrowRight');
    assert.match(await clips.first().innerText(),/Closing clip/);
    await button('← Earlier').click();
    assert.match(await clips.first().innerText(),/Long interval/);
    await button('Use this pattern for all clips').click();
    await clips.nth(1).click();
    assert.equal(await page.getByRole('spinbutton',{name:'Phase 1 repeats',exact:true}).inputValue(),'3');
    await combo('Apply a preset').selectOption('once');
    await button('Save').click();
    await page.getByText('Compilation saved.',{exact:true}).waitFor();
    await button('Compilations').click();
    const savedID=await combo('Saved compilations').inputValue();
    await button('Done').click();
    await button('Clip cache').click();
    await button('Generate clips').click();
    await page.getByText('Full-duration clips are ready.',{exact:true}).last().waitFor({timeout:30000});
    await button('Done').click();
    for(const mode of ['cache','source']) {
      await combo('Playback mode').selectOption(mode);
      await button('Play compilation').click();
      const observed=[];
      for(let pass=1;pass<=9;pass++) {
        await page.getByText(new RegExp('^Pass '+pass+' / 9 ·')).waitFor({timeout:6000});
        observed.push(await page.locator('video').evaluate(v=>v.playbackRate));
      }
      assert.deepEqual(observed,[1,1,1,.5,.5,1,1,1,1]);
      await button('Stop').click();
    }
    await clips.first().click();
    await page.getByRole('spinbutton',{name:'Phase 1 repeats',exact:true}).fill('2');
    await combo('Phase 2 speed').selectOption('0.75');
    await button('Save').click();
    await page.getByText('Compilation saved.',{exact:true}).waitFor();
    await page.reload();
    await button('Compilations').click();
    await combo('Saved compilations').selectOption(savedID);
    await clips.first().click();
    assert.equal(await page.getByRole('spinbutton',{name:'Phase 1 repeats',exact:true}).inputValue(),'2');
    assert.equal(await combo('Phase 2 speed').inputValue(),'0.75');
    await page.screenshot({path:'.test-runtime/editor.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile page should not overflow');
    assert.ok(await page.evaluate(()=>document.querySelector('.mc-timeline').getBoundingClientRect().top<document.querySelector('.mc-inspector').getBoundingClientRect().top),'Timeline precedes inspector on mobile');
    await page.screenshot({path:'.test-runtime/mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: marker filters, timeline, inspector, reorder, pattern copying, cached/source repeats, persistence and mobile layout');
  } catch(e) {
    await page.screenshot({path:'.test-runtime/failure.png',fullPage:true});throw e;
  } finally {await browser.close();}
})();
