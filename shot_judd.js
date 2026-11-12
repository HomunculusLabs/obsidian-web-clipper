const puppeteer=require('puppeteer');
(async()=>{
  const b=await puppeteer.launch({executablePath:'/opt/homebrew/bin/chromium',headless:'new',args:['--no-sandbox']});
  const p=await b.newPage();
  await p.setViewport({width:1400,height:900,deviceScaleFactor:1});
  await p.goto('file:///Users/t3rpz/projects/excalibur-art/judd_stack.html',{waitUntil:'networkidle0'});
  await new Promise(r=>setTimeout(r,7000)); // let field assemble + rest
  await p.screenshot({path:'/Users/t3rpz/projects/excalibur-art/judd_stack_shot.png'});
  await b.close();
  console.log('saved');
})();
